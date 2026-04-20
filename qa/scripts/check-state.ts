#!/usr/bin/env ts-node
/**
 * Check the current state of the bridge on Cardano (local or preprod).
 *
 * Shows: wallet balances, check tokens, handler UTxOs, xport UTxOs.
 *
 * Usage:
 *   cd msg-agent && npx ts-node ../qa/scripts/check-state.ts
 */

import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.join(__dirname, '../../msg-agent/.env') });

import { BlockfrostProvider, MeshWallet } from '@meshsdk/core';

const PROVIDER_URL = process.env.BLOCKFROST_URL || process.env.BLOCKFROST_API_KEY || '';
if (!PROVIDER_URL) {
    console.error('Set BLOCKFROST_URL or BLOCKFROST_API_KEY in .env');
    process.exit(1);
}

async function main() {
    const provider = new BlockfrostProvider(PROVIDER_URL);
    const contractsInfo = (await import('../../msg-agent/src/scripts')).default;
    const { defaultConfig } = await import('../../msg-agent/src/config');

    console.log('=== Bridge State ===\n');

    // Wallets
    const seeds = [process.env.ACCOUNT_SEED1, process.env.ACCOUNT_SEED2, process.env.ACCOUNT_SEED3];
    const labels = ['Inbound worker', 'Outbound worker', 'User/client'];
    for (let i = 0; i < seeds.length; i++) {
        if (!seeds[i]) continue;
        const w = new MeshWallet({
            networkId: 0, fetcher: provider, submitter: provider,
            key: { type: 'cli', payment: '5820' + seeds[i] },
        });
        await w.init();
        const addr = w.addresses.baseAddressBech32 ?? w.addresses.enterpriseAddressBech32 ?? '';
        const balance = await w.getBalance();
        const ada = balance.find((b: any) => b.unit === 'lovelace');
        const tokens = balance.filter((b: any) => b.unit !== 'lovelace');
        console.log(`${labels[i]} (wallet ${i + 1}):`);
        console.log(`  Address: ${addr.slice(0, 40)}...`);
        console.log(`  ADA: ${(Number(ada?.quantity ?? 0) / 1e6).toFixed(1)}`);
        if (tokens.length > 0) {
            tokens.forEach((t: any) => {
                const name = t.unit.slice(56);
                let decoded = '';
                try { decoded = Buffer.from(name, 'hex').toString('ascii'); } catch {}
                console.log(`  Token: ${decoded || name} qty=${t.quantity}`);
            });
        }
        console.log('');
    }

    // Script addresses
    console.log('=== Script Addresses ===\n');
    console.log(`Inbound handler:  ${contractsInfo.inboundDemoAddress}`);
    console.log(`Outbound handler: ${contractsInfo.outboundDemoAddress}`);
    console.log(`XPort:            ${contractsInfo.xportAddress}`);
    console.log(`GroupNFTHolder:   ${process.env.GROUP_NFT_HOLDER || '(not set)'}`);
    console.log('');

    // Check UTxOs at key addresses
    const addresses = [
        { name: 'Inbound handler', addr: contractsInfo.inboundDemoAddress },
        { name: 'Outbound handler', addr: contractsInfo.outboundDemoAddress },
        { name: 'XPort', addr: contractsInfo.xportAddress },
    ];

    if (process.env.GROUP_NFT_HOLDER) {
        addresses.push({ name: 'GroupNFTHolder', addr: process.env.GROUP_NFT_HOLDER });
    }

    console.log('=== UTxOs at Script Addresses ===\n');
    for (const { name, addr } of addresses) {
        try {
            const utxos = await provider.fetchAddressUTxOs(addr);
            console.log(`${name}: ${utxos.length} UTxO(s)`);
            utxos.forEach((u: any) => {
                const tokens = u.output.amount.filter((a: any) => a.unit !== 'lovelace');
                const ada = u.output.amount.find((a: any) => a.unit === 'lovelace');
                const hasDatum = !!u.output.plutusData;
                console.log(`  ${u.input.txHash.slice(0, 16)}... ${(Number(ada?.quantity ?? 0) / 1e6).toFixed(1)} ADA${tokens.length ? ' + ' + tokens.length + ' token(s)' : ''}${hasDatum ? ' [datum]' : ''}`);
            });
        } catch {
            console.log(`${name}: error fetching`);
        }
        console.log('');
    }

    // Token policies
    console.log('=== Token Policies ===\n');
    console.log(`Inbound token:  ${contractsInfo.inboundTokenPolicy}`);
    console.log(`Outbound token: ${contractsInfo.outboundTokenPolicy}`);
    console.log(`Bridge token:   ${contractsInfo.demoTokenPolicy}`);
}

main().catch(e => {
    console.error('Failed:', e.message || e);
    process.exit(1);
});
