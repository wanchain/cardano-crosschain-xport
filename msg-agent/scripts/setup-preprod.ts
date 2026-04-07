#!/usr/bin/env ts-node
/**
 * setup-preprod.ts — Generate wallet keys and prepare for preprod testnet E2E testing.
 *
 * Usage:
 *   cd msg-agent
 *   npx ts-node scripts/setup-preprod.ts
 *
 * What it does:
 *   1. Generates 3 Ed25519 keypairs (or uses existing from .env)
 *   2. Derives Cardano testnet addresses via MeshSDK
 *   3. Prints faucet funding instructions
 *   4. Waits for funds to appear on-chain
 *   5. Creates collateral UTxOs for worker wallets
 *   6. Prints all .env values to set
 */

import dotenv from 'dotenv';
import path from 'node:path';
import crypto from 'node:crypto';
dotenv.config({ path: path.join(__dirname, '../', '.env') });

import { BlockfrostProvider, MeshWallet } from '@meshsdk/core';
import { defaultConfig } from '../src/config';
import contractsInfo from '../src/scripts';

const FAUCET_URL = 'https://docs.cardano.org/cardano-testnets/tools/faucet/';

async function main() {
    console.log('=== Preprod Testnet Setup ===\n');

    const apiKey = process.env.BLOCKFROST_API_KEY;
    if (!apiKey) {
        console.error('BLOCKFROST_API_KEY not set. Add it to .env first.');
        process.exit(1);
    }

    const provider = new BlockfrostProvider(apiKey);

    // Step 1: Generate or load wallet keys
    console.log('--- Step 1: Wallet keys ---');
    const seeds: string[] = [];
    const seedEnvs = ['ACCOUNT_SEED1', 'ACCOUNT_SEED2', 'ACCOUNT_SEED3'];
    const seedNames = ['Inbound Worker', 'Outbound Worker', 'User Client'];

    for (let i = 0; i < 3; i++) {
        const existing = process.env[seedEnvs[i]];
        if (existing && existing.length === 64) {
            console.log(`  ${seedNames[i]}: using existing key from ${seedEnvs[i]}`);
            seeds.push(existing);
        } else {
            const key = crypto.randomBytes(32).toString('hex');
            console.log(`  ${seedNames[i]}: generated new key`);
            seeds.push(key);
        }
    }

    // Step 2: Derive addresses
    console.log('\n--- Step 2: Derive addresses ---');
    const wallets: MeshWallet[] = [];
    const addresses: string[] = [];

    for (let i = 0; i < 3; i++) {
        const wallet = new MeshWallet({
            networkId: 0,
            fetcher: provider,
            submitter: provider,
            key: { type: 'cli', payment: '5820' + seeds[i] },
        });
        await wallet.init();
        const addr = wallet.addresses.baseAddressBech32 ?? wallet.addresses.enterpriseAddressBech32 ?? '';
        console.log(`  ${seedNames[i]}: ${addr}`);
        wallets.push(wallet);
        addresses.push(addr);
    }

    // Step 3: Print contract info
    console.log('\n--- Step 3: Contract addresses ---');
    console.log(`  Inbound Demo:    ${contractsInfo.inboundDemoAddress}`);
    console.log(`  Outbound Demo:   ${contractsInfo.outboundDemoAddress}`);
    console.log(`  XPort:           ${contractsInfo.xportAddress}`);
    console.log(`  Inbound Policy:  ${contractsInfo.inboundTokenPolicy}`);
    console.log(`  Outbound Policy: ${contractsInfo.outboundTokenPolicy}`);
    console.log(`  Demo Token:      ${contractsInfo.demoTokenPolicy}`);

    // Step 4: Check balances / prompt for faucet
    console.log('\n--- Step 4: Fund wallets ---');
    let allFunded = true;
    for (let i = 0; i < 3; i++) {
        try {
            const utxos = await provider.fetchAddressUTxOs(addresses[i]);
            const lovelace = utxos.reduce((sum, u) => {
                const ada = u.output.amount.find(a => a.unit === 'lovelace');
                return sum + BigInt(ada?.quantity ?? '0');
            }, 0n);
            if (lovelace > 0n) {
                console.log(`  ${seedNames[i]}: ${(lovelace / 1_000_000n).toString()} ADA`);
            } else {
                console.log(`  ${seedNames[i]}: NOT FUNDED`);
                allFunded = false;
            }
        } catch {
            console.log(`  ${seedNames[i]}: NOT FUNDED`);
            allFunded = false;
        }
    }

    if (!allFunded) {
        console.log(`\n  Fund all 3 wallets via the Cardano testnet faucet:`);
        console.log(`  ${FAUCET_URL}\n`);
        console.log('  Addresses to fund:');
        for (let i = 0; i < 3; i++) {
            console.log(`    ${seedNames[i]}: ${addresses[i]}`);
        }

        console.log('\n  Waiting for funds (polling every 15s, up to 5 min)...');
        const deadline = Date.now() + 300_000;
        while (Date.now() < deadline) {
            let funded = 0;
            for (const addr of addresses) {
                try {
                    const utxos = await provider.fetchAddressUTxOs(addr);
                    if (utxos.length > 0) funded++;
                } catch { /* not funded yet */ }
            }
            if (funded === 3) {
                console.log('  All wallets funded!\n');
                allFunded = true;
                break;
            }
            process.stdout.write('.');
            await new Promise(r => setTimeout(r, 15000));
        }

        if (!allFunded) {
            console.log('\n  Timeout waiting for funds. Run this script again after funding.');
            printEnvVars(seeds, addresses);
            process.exit(0);
        }
    }

    // Step 5: Create collateral
    console.log('--- Step 5: Create collateral ---');
    for (let i = 0; i < 2; i++) { // Only worker wallets need collateral
        const wallet = wallets[i];
        const collateral = await wallet.getCollateral();
        if (collateral.length > 0) {
            console.log(`  ${seedNames[i]}: collateral exists`);
        } else {
            console.log(`  ${seedNames[i]}: creating collateral...`);
            try {
                await wallet.createCollateral();
                // Wait for confirmation
                const colDeadline = Date.now() + 60_000;
                while (Date.now() < colDeadline) {
                    const col = await wallet.getCollateral();
                    if (col.length > 0) {
                        console.log(`  ${seedNames[i]}: collateral created`);
                        break;
                    }
                    await new Promise(r => setTimeout(r, 5000));
                }
            } catch (e) {
                console.log(`  ${seedNames[i]}: collateral creation failed: ${e}`);
            }
        }
    }

    // Step 6: Print env vars
    console.log('\n--- Step 6: Environment variables ---');
    printEnvVars(seeds, addresses);

    console.log('\n=== Setup complete! ===');
    console.log('\nNext steps:');
    console.log('  1. Copy the values above into .env.preprod (or .env)');
    console.log('  2. yarn test:local:inbound   — create test inbound task');
    console.log('  3. yarn start                — run the monitor');
    console.log('  4. yarn test:local:check     — verify results');
}

function printEnvVars(seeds: string[], addresses: string[]) {
    console.log('\n  Add these to your .env:\n');
    console.log(`  ACCOUNT_SEED1=${seeds[0]}`);
    console.log(`  ACCOUNT_SEED2=${seeds[1]}`);
    console.log(`  ACCOUNT_SEED3=${seeds[2]}`);
    console.log(`  GROUP_NFT_HOLDER=${addresses[0]}`);
    console.log(`  RECEIVER_ON_ADA=${addresses[2]}`);
}

main().catch((err) => {
    console.error('Setup failed:', err);
    process.exit(1);
});
