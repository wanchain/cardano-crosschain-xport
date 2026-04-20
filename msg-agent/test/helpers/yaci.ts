/**
 * Yaci DevKit management helpers for E2E testing.
 *
 * Yaci DevKit runs locally via Docker:
 *   - Port 8080: Blockfrost-compatible Store API
 *   - Port 10000: Admin API (devnet lifecycle)
 *
 * Key workaround: YaciProvider.submitTx sends the wrong content type,
 * so we use raw fetch to POST CBOR directly.
 */

export const YACI_STORE_URL = 'http://localhost:8080/api/v1';
export const YACI_ADMIN_URL = 'http://localhost:10000';

/**
 * Wait for the Yaci Store API to become ready by polling /epochs/latest.
 */
export async function waitForYaci(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${YACI_STORE_URL}/epochs/latest`);
            if (res.ok) return;
        } catch {
            // not ready yet
        }
        await sleep(2000);
    }
    throw new Error(`Yaci Store API not ready after ${timeoutMs}ms`);
}

/**
 * Create a new devnet if Yaci is in not_initialized state.
 * Waits for admin API first, then creates devnet with 1s block time.
 */
export async function createDevnet(timeoutMs = 30_000): Promise<void> {
    // Wait for admin API
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${YACI_ADMIN_URL}/local-cluster/api/admin/devnet/status`);
            if (res.ok) {
                const status = await res.text();
                if (status === 'initialized') return; // Already created
                break; // not_initialized — proceed to create
            }
        } catch { /* not ready */ }
        await sleep(2000);
    }

    const res = await fetch(`${YACI_ADMIN_URL}/local-cluster/api/admin/devnet/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockTime: '1', slotLength: '1', protocolMagic: '42' }),
    });
    if (!res.ok) {
        const body = await res.text();
        if (body.includes('already') || res.status === 409) return;
        throw new Error(`createDevnet failed (${res.status}): ${body}`);
    }

    // Wait for devnet to reach 'initialized' state
    const initDeadline = Date.now() + timeoutMs;
    while (Date.now() < initDeadline) {
        try {
            const statusRes = await fetch(`${YACI_ADMIN_URL}/local-cluster/api/admin/devnet/status`);
            if (statusRes.ok && (await statusRes.text()) === 'initialized') return;
        } catch { /* not ready */ }
        await sleep(2000);
    }
}

/**
 * Top up an address with ADA via the Yaci admin API.
 * Retries on transient failures (devnet may still be initializing).
 */
export async function topupAddress(address: string, adaAmount: number, retries = 5): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const res = await fetch(`${YACI_ADMIN_URL}/local-cluster/api/addresses/topup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, adaAmount }),
        });
        if (res.ok) return;
        const body = await res.text();
        if (attempt < retries && res.status >= 500) {
            await sleep(3000);
            continue;
        }
        throw new Error(`topupAddress failed (${res.status}): ${body}`);
    }
}

/**
 * Wait for an address to have at least minLovelace balance.
 * Polls the Store API until funds appear or timeout.
 */
export async function waitForFunds(address: string, minLovelace = 1_000_000, timeoutMs = 300_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${YACI_STORE_URL}/addresses/${address}/utxos`);
            if (res.ok) {
                const utxos = await res.json() as Array<{ amount: Array<{ unit: string; quantity: string }> }>;
                const totalLovelace = utxos.reduce((sum, u) => {
                    const ada = u.amount.find(a => a.unit === 'lovelace');
                    return sum + BigInt(ada?.quantity ?? '0');
                }, 0n);
                if (totalLovelace >= BigInt(minLovelace)) return;
            }
        } catch { /* not ready */ }
        await sleep(2000);
    }
    throw new Error(`waitForFunds timeout: ${address} did not reach ${minLovelace} lovelace after ${timeoutMs}ms`);
}

/**
 * Submit a signed transaction to Yaci using raw fetch with application/cbor.
 *
 * The YaciProvider.submitTx method sends the wrong content type,
 * so we bypass it entirely.
 *
 * @returns The transaction hash (hex string)
 */
export async function submitTx(signedTxHex: string): Promise<string> {
    const res = await fetch(`${YACI_STORE_URL}/tx/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/cbor' },
        body: Buffer.from(signedTxHex, 'hex'),
    });
    if (!res.ok) {
        throw new Error(`submitTx failed (${res.status}): ${await res.text()}`);
    }
    const txHash = (await res.text()).replace(/"/g, '');
    return txHash;
}

/**
 * Poll UTxOs at an address until a transaction hash appears, or timeout.
 */
export async function waitForTx(
    address: string,
    txHash: string,
    timeoutMs = 60_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(
                `${YACI_STORE_URL}/addresses/${address}/utxos`,
            );
            if (res.ok) {
                const utxos = await res.json() as Array<{ tx_hash: string }>;
                if (utxos.some((u) => u.tx_hash === txHash)) return;
            }
        } catch {
            // not confirmed yet
        }
        await sleep(2000);
    }
    throw new Error(
        `waitForTx timeout: tx ${txHash.slice(0, 16)}... not seen at ${address} after ${timeoutMs}ms`,
    );
}

/**
 * Simple async sleep.
 */
export async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
