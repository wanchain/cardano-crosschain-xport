#!/usr/bin/env ts-node
/**
 * deploy-xport.ts — Deploy XPort validators on an existing Wanchain Cardano infrastructure.
 *
 * Reuses GroupNFT and AdminNFT from the asset crosschain deployment.
 * Computes all XPort-specific validator hashes, updates GroupInfoParams
 * fields to point to XPort validators, and mints check tokens.
 *
 * The GroupNFTHolder validator allows changing ONE field per transaction,
 * so this script submits multiple txs for fields that need updating.
 *
 * Required env vars:
 *   BLOCKFROST_API_KEY    — Blockfrost project ID
 *   ACCOUNT_SEED1         — 32-byte hex deployer seed (must hold AdminNFT)
 *   GROUP_NFT_SYMBOL      — existing GroupNFT policy ID
 *   GROUP_NFT_NAME        — existing GroupNFT asset name (hex)
 *   ADMIN_NFT_SYMBOL      — existing AdminNFT policy ID
 *   ADMIN_NFT_NAME        — existing AdminNFT asset name (hex)
 *
 * Optional env vars:
 *   NETWORK               — 0 (testnet, default) or 1 (mainnet)
 *   INBOUND_SIGNING_KEY   — Ed25519 private key for GPK (generates new if unset)
 *   CHECK_TOKEN_COUNT     — number of check tokens to mint (default: 5)
 *   DRY_RUN               — set to "true" to compute and print without submitting txs
 *
 * Usage:
 *   cd msg-agent && npx ts-node scripts/deploy-xport.ts
 */

import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.join(__dirname, '../', '.env') });

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';

(ed.hashes as any).sha512 = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));

import {
    BlockfrostProvider, MeshWallet, MeshTxBuilder,
    applyParamsToScript, resolveScriptHash, deserializeDatum,
    resolvePlutusScriptAddress, deserializeAddress,
    PlutusScript,
} from '@meshsdk/core';
import { mConStr0 } from '@meshsdk/common';
import { defaultConfig } from '../src/config';

const DRY_RUN = process.env.DRY_RUN === 'true';
const CHECK_TOKEN_COUNT = parseInt(process.env.CHECK_TOKEN_COUNT || '5');

const FIELD_NAMES = [
    'version', 'admin', 'gpk', 'balance_worker', 'treasury_check_vh',
    'oracle_worker', 'mint_check_vh', 'stk_vh', 'stake_check_vh',
    'nft_ref_holder_vh', 'nft_treasury_check_vh', 'nft_mint_check_vh',
    'outbound_holder_vh', 'inbound_check_vh',
];

function requireEnv(name: string): string {
    const val = process.env[name];
    if (!val) { console.error(`${name} not set`); process.exit(1); }
    return val;
}

async function main() {
    console.log('=== XPort Deployment (existing infrastructure) ===\n');
    if (DRY_RUN) console.log('*** DRY RUN — no transactions will be submitted ***\n');

    // ── Env vars ──────────────────────────────────────────────────────────
    const apiKey = requireEnv('BLOCKFROST_API_KEY');
    const seed = requireEnv('ACCOUNT_SEED1');
    const GROUP_NFT_SYMBOL = requireEnv('GROUP_NFT_SYMBOL');
    const GROUP_NFT_NAME = requireEnv('GROUP_NFT_NAME');
    const ADMIN_NFT_SYMBOL = requireEnv('ADMIN_NFT_SYMBOL');
    const ADMIN_NFT_NAME = requireEnv('ADMIN_NFT_NAME');

    // ── Wallet ────────────────────────────────────────────────────────────
    const provider = new BlockfrostProvider(apiKey);
    const wallet = new MeshWallet({
        networkId: defaultConfig.NETWORK ? 1 : 0,
        fetcher: provider,
        submitter: provider,
        key: { type: 'cli', payment: '5820' + seed },
    });
    await wallet.init();
    const walletAddr = wallet.addresses.baseAddressBech32 ?? '';
    const walletPkh = deserializeAddress(walletAddr).pubKeyHash;
    console.log(`Deployer: ${walletAddr}`);
    console.log(`PKH:      ${walletPkh}\n`);

    // ── Ed25519 keypair (for GPK) ─────────────────────────────────────────
    let privKey: Uint8Array;
    if (process.env.INBOUND_SIGNING_KEY) {
        privKey = Buffer.from(process.env.INBOUND_SIGNING_KEY, 'hex');
        console.log('Using INBOUND_SIGNING_KEY from environment.');
    } else {
        privKey = ed.utils.randomSecretKey();
        console.log('Generated new Ed25519 keypair.');
    }
    const pubKey = ed.getPublicKey(privKey);
    const privKeyHex = Buffer.from(privKey).toString('hex');
    const pubKeyHex = Buffer.from(pubKey).toString('hex');
    console.log(`  GPK pubkey: ${pubKeyHex}\n`);

    // ── Step 1: Compute all XPort validator hashes ────────────────────────
    console.log('--- Step 1: Compute XPort validator hashes ---');

    const groupNftInfo = mConStr0([GROUP_NFT_SYMBOL, GROUP_NFT_NAME]);
    const adminNftInfo = mConStr0([ADMIN_NFT_SYMBOL, ADMIN_NFT_NAME]);

    // OutboundToken
    if (!defaultConfig.outboundToken) throw new Error('outboundToken not configured');
    const outboundTokenParam = mConStr0([groupNftInfo, defaultConfig.OUTBOUND_TOKEN_NAME]);
    const outboundTokenCbor = applyParamsToScript(defaultConfig.outboundToken.compiledCode, [outboundTokenParam]);
    const outboundTokenPolicy = resolveScriptHash(outboundTokenCbor, defaultConfig.outboundToken.plutusVersion);

    // CheckToken
    if (!defaultConfig.checkToken) throw new Error('checkToken not configured');
    const inboundCheckTokenName = Buffer.from('InboundCheckCoin', 'ascii').toString('hex');
    const groupInfoIndexInboundCheck = { alternative: 7, fields: [] };
    const checkTokenParam = mConStr0([groupNftInfo, adminNftInfo, inboundCheckTokenName, groupInfoIndexInboundCheck]);
    const checkTokenCbor = applyParamsToScript(defaultConfig.checkToken.compiledCode, [checkTokenParam]);
    const checkTokenPolicy = resolveScriptHash(checkTokenCbor, defaultConfig.checkToken.plutusVersion);

    // InboundToken
    if (!defaultConfig.inboundToken) throw new Error('inboundToken not configured');
    const inboundTokenParam = mConStr0([checkTokenPolicy, inboundCheckTokenName]);
    const inboundTokenCbor = applyParamsToScript(defaultConfig.inboundToken.compiledCode, [inboundTokenParam]);
    const inboundTokenPolicy = resolveScriptHash(inboundTokenCbor, defaultConfig.inboundToken.plutusVersion);

    // XPort
    if (!defaultConfig.xport) throw new Error('xport not configured');
    const xportParam = mConStr0([walletPkh, 0]);
    const xportCbor = applyParamsToScript(defaultConfig.xport.compiledCode, [xportParam]);
    const xportScript: PlutusScript = { code: xportCbor, version: defaultConfig.xport.plutusVersion };
    const xportAddress = resolvePlutusScriptAddress(xportScript, defaultConfig.NETWORK);
    const xportHash = resolveScriptHash(xportCbor, defaultConfig.xport.plutusVersion);

    // InboundMintCheck
    if (!defaultConfig.inboundMintCheck) throw new Error('inboundMintCheck not configured');
    const checkTokenInfo = mConStr0([checkTokenPolicy, inboundCheckTokenName]);
    const gactParam = mConStr0([groupNftInfo, adminNftInfo, checkTokenInfo]);
    const inboundMintCheckParam = mConStr0([gactParam, inboundTokenPolicy]);
    const inboundMintCheckCbor = applyParamsToScript(defaultConfig.inboundMintCheck.compiledCode, [inboundMintCheckParam]);
    const inboundMintCheckHash = resolveScriptHash(inboundMintCheckCbor, defaultConfig.inboundMintCheck.plutusVersion);
    const inboundMintCheckScript: PlutusScript = { code: inboundMintCheckCbor, version: defaultConfig.inboundMintCheck.plutusVersion };
    const inboundMintCheckAddress = resolvePlutusScriptAddress(inboundMintCheckScript, defaultConfig.NETWORK);

    // GroupNFTHolder
    if (!defaultConfig.groupNftHolder) throw new Error('groupNftHolder not configured');
    const groupAdminParam = mConStr0([groupNftInfo, adminNftInfo]);
    const groupNftHolderCbor = applyParamsToScript(defaultConfig.groupNftHolder.compiledCode, [groupAdminParam]);
    const groupNftHolderAddress = resolvePlutusScriptAddress(
        { code: groupNftHolderCbor, version: defaultConfig.groupNftHolder.plutusVersion } as PlutusScript,
        defaultConfig.NETWORK,
    );
    const groupNftHolderHash = resolveScriptHash(groupNftHolderCbor, defaultConfig.groupNftHolder.plutusVersion);

    // AdminNFTHolder
    if (!defaultConfig.adminNftHolder) throw new Error('adminNftHolder not configured');
    const adminNftHolderCbor = applyParamsToScript(defaultConfig.adminNftHolder.compiledCode, [adminNftInfo]);
    const adminNftHolderHash = resolveScriptHash(adminNftHolderCbor, defaultConfig.adminNftHolder.plutusVersion);

    // Demo validators
    if (!defaultConfig.demoInbound) throw new Error('demoInbound not configured');
    const inboundHandlerCbor = applyParamsToScript(defaultConfig.demoInbound.compiledCode, [inboundTokenPolicy]);
    const inboundHandlerAddress = resolvePlutusScriptAddress(
        { code: inboundHandlerCbor, version: defaultConfig.demoInbound.plutusVersion } as PlutusScript,
        defaultConfig.NETWORK,
    );

    if (!defaultConfig.demoOutbound) throw new Error('demoOutbound not configured');
    const outboundHandlerCbor = applyParamsToScript(defaultConfig.demoOutbound.compiledCode, [outboundTokenPolicy]);
    const outboundHandlerAddress = resolvePlutusScriptAddress(
        { code: outboundHandlerCbor, version: defaultConfig.demoOutbound.plutusVersion } as PlutusScript,
        defaultConfig.NETWORK,
    );

    console.log(`  CheckToken:        ${checkTokenPolicy}`);
    console.log(`  InboundToken:      ${inboundTokenPolicy}`);
    console.log(`  OutboundToken:     ${outboundTokenPolicy}`);
    console.log(`  XPort:             ${xportHash}`);
    console.log(`  InboundMintCheck:  ${inboundMintCheckHash}`);
    console.log(`  GroupNFTHolder:    ${groupNftHolderHash}`);
    console.log(`  AdminNFTHolder:    ${adminNftHolderHash}`);
    console.log(`  InboundHandler:    ${inboundHandlerAddress}`);
    console.log(`  OutboundHandler:   ${outboundHandlerAddress}`);
    console.log();

    // ── Step 2: Fetch and decode existing GroupInfoParams ──────────────────
    console.log('--- Step 2: Fetch GroupNFTHolder UTxO ---');
    const groupNftUnit = GROUP_NFT_SYMBOL + GROUP_NFT_NAME;
    const holderUtxos = await provider.fetchAddressUTxOs(groupNftHolderAddress);
    const holderUtxo = holderUtxos.find(u =>
        u.output.amount.some(a => a.unit === groupNftUnit),
    );
    if (!holderUtxo) {
        throw new Error(`No UTxO at ${groupNftHolderAddress} holding GroupNFT (${groupNftUnit})`);
    }
    console.log(`  Found: ${holderUtxo.input.txHash}#${holderUtxo.input.outputIndex}`);

    const datumCbor = holderUtxo.output.plutusData;
    if (!datumCbor) throw new Error('GroupNFTHolder UTxO has no inline datum');

    const datum = deserializeDatum<{ constructor: bigint; fields: Array<{ bytes?: string; int?: bigint }> }>(datumCbor);
    if (!datum?.fields || datum.fields.length < 14) {
        throw new Error(`Expected 14 fields, got ${datum?.fields?.length ?? 0}`);
    }

    const currentFields = datum.fields.map(f => f.bytes ?? '');
    console.log('\nCurrent GroupInfoParams:');
    for (let i = 0; i < currentFields.length; i++) {
        console.log(`  [${i.toString().padStart(2)}] ${FIELD_NAMES[i].padEnd(22)} ${currentFields[i]}`);
    }

    // ── Step 3: Determine which fields need updating ──────────────────────
    console.log('\n--- Step 3: Plan field updates ---');

    const updates: Array<{ index: number; name: string; newValue: string }> = [];

    if (currentFields[2] !== pubKeyHex) {
        updates.push({ index: 2, name: 'gpk', newValue: pubKeyHex });
    }
    if (currentFields[7] !== inboundMintCheckHash) {
        updates.push({ index: 7, name: 'stk_vh', newValue: inboundMintCheckHash });
    }
    if (currentFields[12] !== xportHash) {
        updates.push({ index: 12, name: 'outbound_holder_vh', newValue: xportHash });
    }
    if (currentFields[13] !== inboundMintCheckHash) {
        updates.push({ index: 13, name: 'inbound_check_vh', newValue: inboundMintCheckHash });
    }

    if (updates.length === 0) {
        console.log('  All fields already up to date — no updates needed.');
    } else {
        for (const u of updates) {
            console.log(`  [${u.index}] ${u.name}: ${currentFields[u.index]} → ${u.newValue}`);
        }
    }

    // ── Step 4: Submit field updates (one tx per field) ───────────────────
    if (updates.length > 0 && !DRY_RUN) {
        console.log(`\n--- Step 4: Update GroupInfoParams (${updates.length} txs) ---`);
        const adminNftUnit = ADMIN_NFT_SYMBOL + ADMIN_NFT_NAME;
        let fields = [...currentFields];

        for (const update of updates) {
            console.log(`\n  Updating [${update.index}] ${update.name}...`);
            fields[update.index] = update.newValue;
            const newDatum = mConStr0(fields);

            // Fetch fresh state
            const walletUtxos = await wallet.getUtxos();
            const adminUtxo = walletUtxos.find(u =>
                u.output.amount.some(a => a.unit === adminNftUnit),
            );
            if (!adminUtxo) throw new Error('AdminNFT not found in deployer wallet');

            const latestHolderUtxos = await provider.fetchAddressUTxOs(groupNftHolderAddress);
            const latestHolderUtxo = latestHolderUtxos.find(u =>
                u.output.amount.some(a => a.unit === groupNftUnit),
            );
            if (!latestHolderUtxo) throw new Error('GroupNFTHolder UTxO not found');

            const collateral = await getCollateral(wallet);
            const changeAddress = await wallet.getChangeAddress();

            const txBuilder = new MeshTxBuilder({
                fetcher: provider,
                submitter: provider,
                evaluator: provider,
            });

            await txBuilder
                .spendingPlutusScript(defaultConfig.groupNftHolder!.plutusVersion)
                .txIn(
                    latestHolderUtxo.input.txHash,
                    latestHolderUtxo.input.outputIndex,
                    latestHolderUtxo.output.amount,
                    latestHolderUtxo.output.address,
                )
                .spendingReferenceTxInInlineDatumPresent()
                .spendingReferenceTxInRedeemerValue(update.index)
                .txInScript(groupNftHolderCbor)
                .txIn(
                    adminUtxo.input.txHash,
                    adminUtxo.input.outputIndex,
                    adminUtxo.output.amount,
                    adminUtxo.output.address,
                )
                .txOut(groupNftHolderAddress, [
                    { unit: groupNftUnit, quantity: '1' },
                    { unit: 'lovelace', quantity: '5000000' },
                ])
                .txOutInlineDatumValue(newDatum)
                .txInCollateral(
                    collateral.input.txHash,
                    collateral.input.outputIndex,
                    collateral.output.amount,
                    collateral.output.address,
                )
                .changeAddress(changeAddress)
                .selectUtxosFrom(walletUtxos.filter(
                    u => !u.output.amount.some(a => a.unit === adminNftUnit),
                ))
                .complete();

            const signedTx = await wallet.signTx(txBuilder.txHex);
            const txHash = await wallet.submitTx(signedTx);
            console.log(`  Submitted: ${txHash}`);
            await waitForTx(provider, groupNftHolderAddress, txHash);
        }
    }

    // ── Step 5: Mint check tokens ─────────────────────────────────────────
    if (!DRY_RUN) {
        console.log(`\n--- Step 5: Mint ${CHECK_TOKEN_COUNT} check tokens ---`);
        const adminNftUnit = ADMIN_NFT_SYMBOL + ADMIN_NFT_NAME;

        const mintUtxos = await wallet.getUtxos();
        const adminUtxo = mintUtxos.find(u =>
            u.output.amount.some((a: { unit: string; quantity: string }) => a.unit === adminNftUnit && a.quantity === '1'),
        );
        if (!adminUtxo) throw new Error('AdminNFT not found for check token minting');

        const holderUtxosForRef = await provider.fetchAddressUTxOs(groupNftHolderAddress);
        const holderRefUtxo = holderUtxosForRef.find(u =>
            u.output.amount.some((a: { unit: string }) => a.unit === groupNftUnit),
        );
        if (!holderRefUtxo) throw new Error('GroupNFTHolder UTxO not found for check token mint');

        const collateral = await getCollateral(wallet);
        const changeAddress = await wallet.getChangeAddress();

        const mintBuilder = new MeshTxBuilder({
            fetcher: provider,
            submitter: provider,
            evaluator: provider,
        });

        mintBuilder.txIn(
            adminUtxo.input.txHash,
            adminUtxo.input.outputIndex,
            adminUtxo.output.amount,
            adminUtxo.output.address,
        );

        mintBuilder.readOnlyTxInReference(
            holderRefUtxo.input.txHash,
            holderRefUtxo.input.outputIndex,
        );

        mintBuilder
            .mintPlutusScript(defaultConfig.checkToken!.plutusVersion)
            .mint(CHECK_TOKEN_COUNT.toString(), checkTokenPolicy, inboundCheckTokenName)
            .mintingScript(checkTokenCbor)
            .mintRedeemerValue(mConStr0([]));

        const unitDatum = mConStr0([]);
        for (let i = 0; i < CHECK_TOKEN_COUNT; i++) {
            mintBuilder
                .txOut(inboundMintCheckAddress, [
                    { unit: checkTokenPolicy + inboundCheckTokenName, quantity: '1' },
                    { unit: 'lovelace', quantity: '2000000' },
                ])
                .txOutInlineDatumValue(unitDatum);
        }

        mintBuilder.txOut(walletAddr, [
            { unit: adminNftUnit, quantity: '1' },
            { unit: 'lovelace', quantity: '2000000' },
        ]);

        mintBuilder
            .txInCollateral(
                collateral.input.txHash,
                collateral.input.outputIndex,
                collateral.output.amount,
                collateral.output.address,
            )
            .changeAddress(changeAddress)
            .selectUtxosFrom(mintUtxos.filter(
                u => !u.output.amount.some((a: { unit: string }) => a.unit === adminNftUnit),
            ));

        await mintBuilder.complete();
        const signedTx = await wallet.signTx(mintBuilder.txHex);
        const mintTxHash = await wallet.submitTx(signedTx);
        console.log(`  Check tokens minted: ${mintTxHash}`);
        await waitForTx(provider, inboundMintCheckAddress, mintTxHash);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    console.log('\n=== Deployment Summary ===\n');
    console.log('Existing (from asset crosschain):');
    console.log(`  GroupNFT:          ${GROUP_NFT_SYMBOL}`);
    console.log(`  AdminNFT:          ${ADMIN_NFT_SYMBOL}`);
    console.log();
    console.log('XPort validators:');
    console.log(`  CheckToken:        ${checkTokenPolicy}`);
    console.log(`  InboundToken:      ${inboundTokenPolicy}`);
    console.log(`  OutboundToken:     ${outboundTokenPolicy}`);
    console.log(`  XPort:             ${xportHash}`);
    console.log(`  InboundMintCheck:  ${inboundMintCheckHash}`);
    console.log(`  GroupNFTHolder:    ${groupNftHolderHash}`);
    console.log(`  AdminNFTHolder:    ${adminNftHolderHash}`);
    console.log();
    console.log('Addresses:');
    console.log(`  GroupNFTHolder:    ${groupNftHolderAddress}`);
    console.log(`  InboundMintCheck:  ${inboundMintCheckAddress}`);
    console.log(`  XPort:             ${xportAddress}`);
    console.log(`  InboundHandler:    ${inboundHandlerAddress}`);
    console.log(`  OutboundHandler:   ${outboundHandlerAddress}`);
    console.log();
    console.log('Environment variables for .env:');
    console.log(`  GROUP_NFT_HOLDER=${groupNftHolderAddress}`);
    console.log(`  GROUP_NFT_SYMBOL=${GROUP_NFT_SYMBOL}`);
    console.log(`  GROUP_NFT_NAME=${GROUP_NFT_NAME}`);
    console.log(`  ADMIN_NFT_SYMBOL=${ADMIN_NFT_SYMBOL}`);
    console.log(`  ADMIN_NFT_NAME=${ADMIN_NFT_NAME}`);
    console.log(`  CHECK_TOKEN_SYMBOL=${checkTokenPolicy}`);
    console.log(`  CHECK_TOKEN_NAME=${inboundCheckTokenName}`);
    console.log(`  INBOUND_SIGNING_KEY=${privKeyHex}`);
    console.log();
    console.log('=== Deployment complete! ===');
}

async function getCollateral(wallet: MeshWallet) {
    const collateral = (await wallet.getCollateral())[0];
    if (!collateral) throw new Error('No collateral available. Send 5 ADA to the deployer wallet first.');
    return collateral;
}

async function waitForTx(provider: BlockfrostProvider, address: string, txHash: string, timeoutMs = 120_000) {
    console.log(`  Waiting for ${txHash.slice(0, 16)}...`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const utxos = await provider.fetchAddressUTxOs(address);
            if (utxos.some(u => u.input.txHash === txHash)) {
                console.log('  Confirmed.');
                return;
            }
        } catch { /* not confirmed yet */ }
        await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error(`Tx ${txHash.slice(0, 16)}... not confirmed after ${timeoutMs}ms`);
}

main().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
});
