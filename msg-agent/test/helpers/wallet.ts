/**
 * Wallet creation and management helpers for E2E testing on Yaci DevKit.
 *
 * Creates MeshWallet instances backed by BlockfrostProvider pointing at
 * the local Yaci Store API (port 8080).
 */

import { BlockfrostProvider, MeshWallet, Transaction } from '@meshsdk/core';
import { YACI_STORE_URL, submitTx, waitForTx, sleep } from './yaci';

/** Get the best available bech32 address from a wallet, or throw. */
export function walletAddress(wallet: MeshWallet): string {
    const addr = wallet.addresses.baseAddressBech32
        ?? wallet.addresses.enterpriseAddressBech32;
    if (!addr) throw new Error('Wallet has no base or enterprise address');
    return addr;
}

/**
 * Create a wallet from a 32-byte hex seed using BlockfrostProvider
 * pointing at the local Yaci Store API.
 *
 * The seed is prefixed with '5820' (CBOR-encoded 32-byte bytestring)
 * to form the CLI payment key expected by MeshWallet.
 *
 * @param seed 32-byte hex string (64 hex chars)
 */
export async function createWallet(seed: string): Promise<{
    wallet: MeshWallet;
    address: string;
    provider: BlockfrostProvider;
}> {
    const provider = new BlockfrostProvider(YACI_STORE_URL);
    const wallet = new MeshWallet({
        networkId: 0,
        fetcher: provider,
        submitter: provider,
        key: { type: 'cli', payment: '5820' + seed },
    });
    await wallet.init();
    const address = walletAddress(wallet);
    return { wallet, address, provider };
}

/**
 * Ensure a collateral UTxO exists in the wallet.
 * If none exists, sends 5 ADA to self and waits for confirmation.
 */
export async function ensureCollateral(wallet: MeshWallet): Promise<void> {
    const existing = await wallet.getCollateral();
    if (existing.length > 0) return;

    const address = walletAddress(wallet);
    const tx = new Transaction({ initiator: wallet });
    tx.sendLovelace(address, '5000000');
    const unsignedTx = await tx.build();
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await submitTx(signedTx);
    await waitForTx(address, txHash);

    // Wait for the wallet to recognize the new collateral
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const cols = await wallet.getCollateral();
        if (cols.length > 0) return;
        await sleep(2000);
    }
    throw new Error('ensureCollateral: collateral not detected after tx confirmation');
}

/**
 * Return wallet balance as lovelace + token map.
 */
export async function getBalance(wallet: MeshWallet): Promise<{
    lovelace: bigint;
    tokens: Map<string, bigint>;
}> {
    const balance = await wallet.getBalance();
    let lovelace = 0n;
    const tokens = new Map<string, bigint>();

    for (const entry of balance) {
        if (entry.unit === 'lovelace') {
            lovelace = BigInt(entry.quantity);
        } else {
            tokens.set(entry.unit, BigInt(entry.quantity));
        }
    }

    return { lovelace, tokens };
}
