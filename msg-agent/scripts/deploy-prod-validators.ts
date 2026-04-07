#!/usr/bin/env ts-node
/**
 * deploy-prod-validators.ts — Deploy Aiken V3 production validators on preprod.
 *
 * This script handles the full deployment pipeline:
 *   1. Mint GroupNFT (one-shot)
 *   2. Mint AdminNFT (native script for testing)
 *   3. Compute all parameterized validator script hashes
 *   4. Create GroupNFTHolder UTxO with GroupInfoParams datum
 *   5. Print all policy IDs, addresses, and env vars
 *
 * Prerequisites:
 *   - Funded wallet (ACCOUNT_SEED1) on preprod
 *   - BLOCKFROST_API_KEY set
 *
 * Usage:
 *   cd msg-agent && npx ts-node scripts/deploy-prod-validators.ts
 */

import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.join(__dirname, '../', '.env') });

import {
    BlockfrostProvider, MeshWallet, MeshTxBuilder, Transaction,
    ForgeScript, applyParamsToScript, resolveScriptHash,
    resolvePlutusScriptAddress, deserializeAddress, PlutusScript, serializeData,
} from '@meshsdk/core';
import { mConStr0 } from '@meshsdk/common';
import { defaultConfig } from '../src/config';

const OUTBOUND_TOKEN_NAME = defaultConfig.OUTBOUND_TOKEN_NAME;

async function main() {
    console.log('=== Production Validator Deployment ===\n');

    const apiKey = process.env.BLOCKFROST_API_KEY;
    if (!apiKey) { console.error('BLOCKFROST_API_KEY not set'); process.exit(1); }
    const seed = process.env.ACCOUNT_SEED1;
    if (!seed) { console.error('ACCOUNT_SEED1 not set'); process.exit(1); }

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
    console.log(`Deployer wallet: ${walletAddr}`);
    console.log(`Deployer PKH:    ${walletPkh}\n`);

    // Ensure collateral
    let collateral = (await wallet.getCollateral())[0];
    if (!collateral) {
        console.log('Creating collateral...');
        await wallet.createCollateral();
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
            const cols = await wallet.getCollateral();
            if (cols.length > 0) { collateral = cols[0]; break; }
            await new Promise(r => setTimeout(r, 5000));
        }
        if (!collateral) throw new Error('Collateral creation timed out');
    }

    // ── Step 1: Mint AdminNFT (native script for testing) ──────────────────
    console.log('--- Step 1: Mint AdminNFT ---');
    const adminForgingScript = ForgeScript.withOneSignature(walletAddr);
    const adminNftSymbol = resolveScriptHash(adminForgingScript);
    // mintAsset hex-encodes the assetName, so pass raw string
    const adminNftName = 'AdminNFT';
    const adminNftNameHex = Buffer.from('AdminNFT', 'ascii').toString('hex');
    console.log(`  AdminNFT policy: ${adminNftSymbol}`);
    console.log(`  AdminNFT name:   ${adminNftName}`);

    const adminMintTx = new Transaction({ initiator: wallet });
    adminMintTx.mintAsset(adminForgingScript, {
        assetName: adminNftName,
        assetQuantity: '1',
        recipient: walletAddr,
    });
    const adminUnsigned = await adminMintTx.build();
    const adminSigned = await wallet.signTx(adminUnsigned);
    const adminTxHash = await wallet.submitTx(adminSigned);
    console.log(`  AdminNFT minted: ${adminTxHash}`);
    await waitForTx(provider, walletAddr, adminTxHash);

    // ── Step 2: Mint GroupNFT (one-shot) ───────────────────────────────────
    console.log('\n--- Step 2: Mint GroupNFT ---');
    const utxos = await wallet.getUtxos();
    const seedUtxo = utxos[0]; // Use first UTxO as one-shot parameter
    if (!seedUtxo) throw new Error('No UTxOs available for GroupNFT mint');

    const orefParam = mConStr0([seedUtxo.input.txHash, seedUtxo.input.outputIndex]);

    if (!defaultConfig.groupNft) throw new Error('groupNft validator not configured');
    const groupNftCbor = applyParamsToScript(defaultConfig.groupNft.compiledCode, [orefParam]);
    const groupNftScript: PlutusScript = { code: groupNftCbor, version: defaultConfig.groupNft.plutusVersion };
    const groupNftSymbol = resolveScriptHash(groupNftCbor, defaultConfig.groupNft.plutusVersion);
    const groupNftName = Buffer.from('GroupInfoTokenCoin', 'ascii').toString('hex');
    console.log(`  GroupNFT policy: ${groupNftSymbol}`);
    console.log(`  GroupNFT name:   ${groupNftName}`);
    console.log(`  Seed UTxO:       ${seedUtxo.input.txHash}#${seedUtxo.input.outputIndex}`);

    // ── Step 3: Compute all parameterized validator hashes ─────────────────
    console.log('\n--- Step 3: Compute validator hashes ---');

    const groupNftInfo = mConStr0([groupNftSymbol, groupNftName]);
    const adminNftInfo = mConStr0([adminNftSymbol, adminNftNameHex]);

    // OutboundToken: parameterized with OutboundTokenParams { group_nft, token_name }
    if (!defaultConfig.outboundToken) throw new Error('outboundToken not configured');
    const outboundTokenParam = mConStr0([groupNftInfo, OUTBOUND_TOKEN_NAME]);
    const outboundTokenCbor = applyParamsToScript(defaultConfig.outboundToken.compiledCode, [outboundTokenParam]);
    const outboundTokenPolicy = resolveScriptHash(outboundTokenCbor, defaultConfig.outboundToken.plutusVersion);
    console.log(`  OutboundToken:     ${outboundTokenPolicy}`);

    // CheckToken (for inbound): parameterized with CheckTokenParam { group_nft, admin_nft, check_token_name, group_info_index }
    if (!defaultConfig.checkToken) throw new Error('checkToken not configured');
    const inboundCheckTokenName = Buffer.from('InboundCheckCoin', 'ascii').toString('hex');
    // group_info_index = InboundCheckVH (constructor index 7)
    const groupInfoIndexInboundCheck = { alternative: 7, fields: [] };
    const checkTokenParam = mConStr0([groupNftInfo, adminNftInfo, inboundCheckTokenName, groupInfoIndexInboundCheck]);
    const checkTokenCbor = applyParamsToScript(defaultConfig.checkToken.compiledCode, [checkTokenParam]);
    const checkTokenPolicy = resolveScriptHash(checkTokenCbor, defaultConfig.checkToken.plutusVersion);
    console.log(`  CheckToken:        ${checkTokenPolicy}`);

    // InboundToken: parameterized with CheckTokenInfo { check_token_symbol, check_token_name }
    if (!defaultConfig.inboundToken) throw new Error('inboundToken not configured');
    const inboundTokenParam = mConStr0([checkTokenPolicy, inboundCheckTokenName]);
    const inboundTokenCbor = applyParamsToScript(defaultConfig.inboundToken.compiledCode, [inboundTokenParam]);
    const inboundTokenPolicy = resolveScriptHash(inboundTokenCbor, defaultConfig.inboundToken.plutusVersion);
    console.log(`  InboundToken:      ${inboundTokenPolicy}`);

    // XPort: parameterized with KeyParam { pkh, nonce }
    if (!defaultConfig.xport) throw new Error('xport not configured');
    const xportParam = mConStr0([walletPkh, 0]);
    const xportCbor = applyParamsToScript(defaultConfig.xport.compiledCode, [xportParam]);
    const xportScript: PlutusScript = { code: xportCbor, version: defaultConfig.xport.plutusVersion };
    const xportAddress = resolvePlutusScriptAddress(xportScript, defaultConfig.NETWORK);
    const xportHash = resolveScriptHash(xportCbor, defaultConfig.xport.plutusVersion);
    console.log(`  XPort hash:        ${xportHash}`);
    console.log(`  XPort address:     ${xportAddress}`);

    // InboundMintCheck: parameterized with InboundMintCheckInfo { gact, mint_policy }
    if (!defaultConfig.inboundMintCheck) throw new Error('inboundMintCheck not configured');
    const checkTokenInfo = mConStr0([checkTokenPolicy, inboundCheckTokenName]);
    const gactParam = mConStr0([groupNftInfo, adminNftInfo, checkTokenInfo]);
    const inboundMintCheckParam = mConStr0([gactParam, inboundTokenPolicy]);
    const inboundMintCheckCbor = applyParamsToScript(defaultConfig.inboundMintCheck.compiledCode, [inboundMintCheckParam]);
    const inboundMintCheckHash = resolveScriptHash(inboundMintCheckCbor, defaultConfig.inboundMintCheck.plutusVersion);
    console.log(`  InboundMintCheck:  ${inboundMintCheckHash}`);

    // GroupNFTHolder: parameterized with GroupAdminNFTInfo { group, admin }
    if (!defaultConfig.groupNftHolder) throw new Error('groupNftHolder not configured');
    const groupAdminParam = mConStr0([groupNftInfo, adminNftInfo]);
    const groupNftHolderCbor = applyParamsToScript(defaultConfig.groupNftHolder.compiledCode, [groupAdminParam]);
    const groupNftHolderScript: PlutusScript = { code: groupNftHolderCbor, version: defaultConfig.groupNftHolder.plutusVersion };
    const groupNftHolderAddress = resolvePlutusScriptAddress(groupNftHolderScript, defaultConfig.NETWORK);
    const groupNftHolderHash = resolveScriptHash(groupNftHolderCbor, defaultConfig.groupNftHolder.plutusVersion);
    console.log(`  GroupNFTHolder:    ${groupNftHolderHash}`);
    console.log(`  Holder address:    ${groupNftHolderAddress}`);

    // AdminNFTHolder: parameterized with AdminNftTokenInfo
    if (!defaultConfig.adminNftHolder) throw new Error('adminNftHolder not configured');
    const adminNftHolderCbor = applyParamsToScript(defaultConfig.adminNftHolder.compiledCode, [adminNftInfo]);
    const adminNftHolderHash = resolveScriptHash(adminNftHolderCbor, defaultConfig.adminNftHolder.plutusVersion);
    console.log(`  AdminNFTHolder:    ${adminNftHolderHash}`);

    // ── Step 4: Build GroupInfoParams datum ────────────────────────────────
    console.log('\n--- Step 4: Build GroupInfoParams ---');
    // GroupInfoParams has 14 fields — fill with computed hashes where known,
    // dummy values for unused ones (treasury, oracle, etc.)
    const dummyHash = '00'.repeat(28); // 28-byte dummy
    const groupInfoParams = mConStr0([
        groupNftHolderHash,     // version (points to holder for version upgrades)
        dummyHash,              // admin
        dummyHash,              // gpk (group public key — set by MPC)
        dummyHash,              // balance_worker
        dummyHash,              // treasury_check_vh
        dummyHash,              // oracle_worker
        dummyHash,              // mint_check_vh
        dummyHash,              // stk_vh
        dummyHash,              // stake_check_vh
        dummyHash,              // nft_ref_holder_vh
        dummyHash,              // nft_treasury_check_vh
        dummyHash,              // nft_mint_check_vh
        xportHash,              // outbound_holder_vh (where outbound proofs go)
        inboundMintCheckHash,   // inbound_check_vh
    ]);

    // ── Step 5: Mint GroupNFT + create GroupNFTHolder UTxO ─────────────────
    console.log('\n--- Step 5: Mint GroupNFT + create holder UTxO ---');

    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider });
    const freshUtxos = await wallet.getUtxos();
    let freshCollateral = (await wallet.getCollateral())[0];
    if (!freshCollateral) {
        console.log('  Creating collateral...');
        await wallet.createCollateral();
        const colDeadline = Date.now() + 60_000;
        while (Date.now() < colDeadline) {
            const cols = await wallet.getCollateral();
            if (cols.length > 0) { freshCollateral = cols[0]; break; }
            await new Promise(r => setTimeout(r, 5000));
        }
        if (!freshCollateral) throw new Error('Collateral creation timed out');
    }
    const changeAddress = await wallet.getChangeAddress();

    await txBuilder
        // Spend the seed UTxO (required for one-shot mint)
        .txIn(seedUtxo.input.txHash, seedUtxo.input.outputIndex, seedUtxo.output.amount, seedUtxo.output.address)
        // Mint 1 GroupNFT
        .mintPlutusScript(defaultConfig.groupNft.plutusVersion)
        .mint('1', groupNftSymbol, groupNftName)
        .mintingScript(groupNftCbor)
        .mintRedeemerValue(mConStr0([]))
        // Send GroupNFT to holder address with GroupInfoParams datum
        .txOut(groupNftHolderAddress, [
            { unit: groupNftSymbol + groupNftName, quantity: '1' },
            { unit: 'lovelace', quantity: '5000000' },
        ])
        .txOutInlineDatumValue(groupInfoParams)
        .txInCollateral(
            freshCollateral.input.txHash,
            freshCollateral.input.outputIndex,
            freshCollateral.output.amount,
            freshCollateral.output.address,
        )
        .changeAddress(changeAddress)
        .selectUtxosFrom(freshUtxos)
        .complete();

    const groupUnsigned = txBuilder.txHex;
    const groupSigned = await wallet.signTx(groupUnsigned);
    const groupTxHash = await wallet.submitTx(groupSigned);
    console.log(`  GroupNFT minted + holder created: ${groupTxHash}`);
    await waitForTx(provider, groupNftHolderAddress, groupTxHash);

    // ── Step 6: Print summary ──────────────────────────────────────────────
    console.log('\n=== Deployment Summary ===\n');
    console.log('Policy IDs:');
    console.log(`  GroupNFT:          ${groupNftSymbol}`);
    console.log(`  AdminNFT:          ${adminNftSymbol}`);
    console.log(`  CheckToken:        ${checkTokenPolicy}`);
    console.log(`  InboundToken:      ${inboundTokenPolicy}`);
    console.log(`  OutboundToken:     ${outboundTokenPolicy}`);
    console.log();
    console.log('Script Hashes:');
    console.log(`  GroupNFTHolder:    ${groupNftHolderHash}`);
    console.log(`  AdminNFTHolder:    ${adminNftHolderHash}`);
    console.log(`  InboundMintCheck:  ${inboundMintCheckHash}`);
    console.log(`  XPort:             ${xportHash}`);
    console.log();
    console.log('Addresses:');
    console.log(`  GroupNFTHolder:    ${groupNftHolderAddress}`);
    console.log(`  XPort:             ${xportAddress}`);
    console.log();
    console.log('Environment variables for .env:');
    console.log(`  GROUP_NFT_HOLDER=${groupNftHolderAddress}`);
    console.log(`  GROUP_NFT_SYMBOL=${groupNftSymbol}`);
    console.log(`  GROUP_NFT_NAME=${groupNftName}`);
    console.log(`  ADMIN_NFT_SYMBOL=${adminNftSymbol}`);
    console.log(`  ADMIN_NFT_NAME=${adminNftName}`);
    console.log();
    console.log('=== Deployment complete! ===');
}

async function waitForTx(provider: BlockfrostProvider, address: string, txHash: string, timeoutMs = 120_000) {
    console.log(`  Waiting for tx ${txHash.slice(0, 16)}... to confirm...`);
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
    console.log('  Warning: confirmation timeout (tx may still be pending).');
}

main().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
});
