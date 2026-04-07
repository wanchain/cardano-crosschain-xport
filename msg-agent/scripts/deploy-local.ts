#!/usr/bin/env ts-node
/**
 * deploy-local.ts — Bootstrap cross-chain Aiken V3 validators on a local Yaci DevKit devnet.
 *
 * Prerequisites:
 *   docker compose up -d   (from repo root)
 *   cp .env.local .env     (in msg-agent/)
 *
 * What this script does:
 *   1. Derives wallet addresses from the test seeds in .env
 *   2. Tops up wallets via the Yaci admin API
 *   3. Sends ADA to the GroupNftHolder address (creates the reference UTxO)
 *   4. Prints the addresses and env vars needed for .env
 *
 * Usage:
 *   cd msg-agent && npx ts-node scripts/deploy-local.ts
 */

import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.join(__dirname, '../', '.env') });

import { BlockfrostProvider, YaciProvider, MeshWallet, Transaction } from '@meshsdk/core';
import { defaultConfig } from '../src/config';
import contractsInfo from '../src/scripts';

const YACI_STORE_URL = process.env.BLOCKFROST_URL || 'http://localhost:8080/api/v1';
const YACI_ADMIN_URL = process.env.YACI_ADMIN_URL || 'http://localhost:10000';
const TOPUP_AMOUNT = 10_000; // ADA

async function yaciTopup(address: string, adaAmount: number): Promise<void> {
    const url = `${YACI_ADMIN_URL}/local-cluster/api/addresses/topup`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, adaAmount }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Yaci topup failed (${res.status}): ${text}`);
    }
    console.log(`  Topped up ${address.slice(0, 20)}... with ${adaAmount} ADA`);
}

async function waitForFunds(provider: BlockfrostProvider | YaciProvider, address: string, timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const utxos = await provider.fetchAddressUTxOs(address);
            if (utxos.length > 0) return;
        } catch {
            // API may not be ready yet
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(`Timeout waiting for funds at ${address.slice(0, 20)}...`);
}

async function main() {
    console.log('=== Local Devnet Deployment ===\n');
    console.log(`Yaci Store:  ${YACI_STORE_URL}`);
    console.log(`Yaci Admin:  ${YACI_ADMIN_URL}\n`);

    // Step 0: Wait for admin API, then create devnet if needed
    console.log('Waiting for Yaci admin API...');
    const adminDeadline = Date.now() + 30_000;
    let adminReady = false;
    while (Date.now() < adminDeadline) {
        try {
            const res = await fetch(`${YACI_ADMIN_URL}/local-cluster/api/admin/devnet/status`);
            if (res.ok) { adminReady = true; break; }
        } catch { /* not ready */ }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 2000));
    }
    if (!adminReady) {
        console.error('\nERROR: Yaci admin API not reachable. Is docker compose running?');
        process.exit(1);
    }

    const statusRes = await fetch(`${YACI_ADMIN_URL}/local-cluster/api/admin/devnet/status`);
    const status = await statusRes.text();
    console.log(`\nDevnet status: ${status}`);

    if (status === 'not_initialized') {
        console.log('Creating devnet node (1s block time)...');
        const createRes = await fetch(`${YACI_ADMIN_URL}/local-cluster/api/admin/devnet/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blockTime: '1', slotLength: '1', protocolMagic: '42' }),
        });
        if (!createRes.ok) {
            console.error(`Create failed: HTTP ${createRes.status} ${await createRes.text()}`);
            process.exit(1);
        }
        console.log('Devnet created.');
    }

    // Wait for Yaci Store API (takes ~30-60s on first boot)
    console.log('Waiting for Yaci Store API...');
    const storeDeadline = Date.now() + 120_000;
    while (Date.now() < storeDeadline) {
        try {
            const res = await fetch(`${YACI_STORE_URL}/epochs/latest`);
            if (res.ok) { console.log('\nYaci Store API is ready.\n'); break; }
        } catch { /* not ready */ }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 3000));
    }
    try {
        const res = await fetch(`${YACI_STORE_URL}/epochs/latest`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
        console.error('\nERROR: Yaci Store API not available after 120s.');
        process.exit(1);
    }

    const provider = new YaciProvider(YACI_ADMIN_URL + '/local-cluster/api');

    // --- Step 1: Derive wallet addresses ---
    console.log('--- Step 1: Derive wallet addresses ---');

    const seeds = [
        { name: 'Inbound Worker (SEED1)', env: 'ACCOUNT_SEED1', seed: process.env.ACCOUNT_SEED1 },
        { name: 'Outbound Worker (SEED2)', env: 'ACCOUNT_SEED2', seed: process.env.ACCOUNT_SEED2 },
        { name: 'User Client (SEED3)', env: 'ACCOUNT_SEED3', seed: process.env.ACCOUNT_SEED3 },
    ];

    const wallets: MeshWallet[] = [];
    const addresses: string[] = [];

    for (const s of seeds) {
        if (!s.seed) {
            console.error(`  ${s.env} is not set in .env`);
            process.exit(1);
        }
        const wallet = new MeshWallet({
            networkId: 0,
            fetcher: provider,
            submitter: provider,
            key: { type: 'cli', payment: '5820' + s.seed },
        });
        await wallet.init();
        const addr = wallet.addresses.baseAddressBech32 ?? wallet.addresses.enterpriseAddressBech32 ?? '';
        console.log(`  ${s.name}: ${addr}`);
        wallets.push(wallet);
        addresses.push(addr);
    }

    // --- Step 2: Top up wallets ---
    console.log('\n--- Step 2: Top up wallets via Yaci admin API ---');
    for (let i = 0; i < addresses.length; i++) {
        await yaciTopup(addresses[i], TOPUP_AMOUNT);
    }

    // Also top up the GroupNftHolder address
    const groupNftHolder = defaultConfig.GroupNftHolder;
    console.log(`\n  GroupNftHolder: ${groupNftHolder}`);
    await yaciTopup(groupNftHolder, 100);

    // Wait for funds to appear
    console.log('\n  Waiting for funds to appear on-chain...');
    await waitForFunds(provider, addresses[0]);
    console.log('  Funds confirmed.\n');

    // --- Step 3: Print contract info ---
    console.log('--- Step 3: Contract addresses & policies ---');
    console.log(`  Inbound Demo Address:   ${contractsInfo.inboundDemoAddress}`);
    console.log(`  Outbound Demo Address:  ${contractsInfo.outboundDemoAddress}`);
    console.log(`  XPort Address:          ${contractsInfo.xportAddress}`);
    console.log(`  Inbound Token Policy:   ${contractsInfo.inboundTokenPolicy}`);
    console.log(`  Outbound Token Policy:  ${contractsInfo.outboundTokenPolicy}`);
    console.log(`  Demo Token Policy:      ${contractsInfo.demoTokenPolicy}`);

    // --- Step 4: Print .env updates ---
    console.log('\n--- Step 4: Update your .env with these values ---');
    console.log(`GROUP_NFT_HOLDER=${groupNftHolder}`);
    console.log(`RECEIVER_ON_ADA=${addresses[0]}`);

    console.log('\n=== Deployment complete! ===');
    console.log('\nNext steps:');
    console.log('  1. Update GROUP_NFT_HOLDER and RECEIVER_ON_ADA in your .env');
    console.log('  2. Run: npx ts-node scripts/test-local.ts       (create test tasks)');
    console.log('  3. Run: npx ts-node src/index.ts monitor         (start the agent)');
}

main().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
});
