#!/usr/bin/env ts-node
/**
 * mint-check-tokens.ts — Mint inbound check tokens and send them to InboundMintCheck.
 *
 * Step 3 of the production inbound token migration. Mints N check tokens
 * (default 5) via the CheckToken Plutus V3 minting policy and delivers
 * each one to the InboundMintCheck script address with an inline Unit datum.
 *
 * Each check token UTxO becomes a one-use "slot" — when an inbound proof
 * is submitted it consumes one.
 *
 * Prerequisites:
 *   - BLOCKFROST_API_KEY and ACCOUNT_SEED1 set in .env
 *   - Production validators deployed (GroupNFT, AdminNFT exist on-chain)
 *   - GROUP_NFT_HOLDER address set in .env
 *
 * Usage:
 *   cd msg-agent && npx ts-node scripts/mint-check-tokens.ts [count]
 *
 *   count — number of check tokens to mint (default 5)
 */

import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.join(__dirname, '../', '.env') });

import {
    BlockfrostProvider, MeshWallet, MeshTxBuilder,
    applyParamsToScript, resolveScriptHash,
    resolvePlutusScriptAddress, PlutusScript,
} from '@meshsdk/core';
import { mConStr0 } from '@meshsdk/common';
import { defaultConfig } from '../src/config';

// ── Known deployment values ─────────────────────────────────────────────────
// AdminNFT from asset crosschain deployment (must be in deployer wallet)
const ADMIN_NFT_SYMBOL = process.env.ADMIN_NFT_SYMBOL
    || 'a2a5c7ccfe3b6e2cbac42269dbb932f7429310b6a686abd37ec7fb65';
const ADMIN_NFT_NAME = process.env.ADMIN_NFT_NAME
    || '41646d696e4e4654'; // "AdminNFT" in hex

// GroupNFT (from .env or fallback)
const GROUP_NFT_SYMBOL = process.env.GROUP_NFT_SYMBOL
    || '9e8b43e9bdfe2f9fd10a8b43899b14e95660598a4f0ad635fa2e7c36';
const GROUP_NFT_NAME = process.env.GROUP_NFT_NAME
    || '47726f7570496e666f546f6b656e436f696e'; // "GroupInfoTokenCoin" in hex

// GroupNFTHolder address (holds GroupInfoParams datum as reference)
const GROUP_NFT_HOLDER_ADDRESS = process.env.GROUP_NFT_HOLDER
    || defaultConfig.GroupNftHolder;

const DEFAULT_CHECK_TOKEN_COUNT = 5;

async function main() {
    const count = parseInt(process.argv[2] || '', 10) || DEFAULT_CHECK_TOKEN_COUNT;
    console.log(`=== Mint ${count} Inbound Check Tokens ===\n`);

    // ── Environment ──────────────────────────────────────────────────────────
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
    console.log(`Deployer wallet: ${walletAddr}`);

    // ── Collateral ───────────────────────────────────────────────────────────
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

    // ── Step 1: Parameterize CheckToken minting policy ──────────────────────
    console.log('\n--- Step 1: Parameterize CheckToken ---');
    if (!defaultConfig.checkToken) throw new Error('checkToken validator not configured');

    const groupNftInfo = mConStr0([GROUP_NFT_SYMBOL, GROUP_NFT_NAME]);
    const adminNftInfo = mConStr0([ADMIN_NFT_SYMBOL, ADMIN_NFT_NAME]);
    const inboundCheckTokenName = Buffer.from('InboundCheckCoin', 'ascii').toString('hex');

    // GroupInfoIndex::InboundCheckVH = constructor index 7
    const groupInfoIndexInboundCheck = { alternative: 7, fields: [] };
    const checkTokenParam = mConStr0([groupNftInfo, adminNftInfo, inboundCheckTokenName, groupInfoIndexInboundCheck]);
    const checkTokenCbor = applyParamsToScript(defaultConfig.checkToken.compiledCode, [checkTokenParam]);
    const checkTokenPolicy = resolveScriptHash(checkTokenCbor, defaultConfig.checkToken.plutusVersion);
    console.log(`  CheckToken policy: ${checkTokenPolicy}`);
    console.log(`  Token name:        ${inboundCheckTokenName}`);

    // ── Step 2: Compute InboundMintCheck address (destination for check tokens) ─
    console.log('\n--- Step 2: Compute InboundMintCheck address ---');

    // InboundToken: parameterized with CheckTokenInfo { check_token_symbol, check_token_name }
    if (!defaultConfig.inboundToken) throw new Error('inboundToken validator not configured');
    const inboundTokenParam = mConStr0([checkTokenPolicy, inboundCheckTokenName]);
    const inboundTokenCbor = applyParamsToScript(defaultConfig.inboundToken.compiledCode, [inboundTokenParam]);
    const inboundTokenPolicy = resolveScriptHash(inboundTokenCbor, defaultConfig.inboundToken.plutusVersion);
    console.log(`  InboundToken policy: ${inboundTokenPolicy}`);

    // InboundMintCheck: parameterized with InboundMintCheckInfo { gact, mint_policy }
    //   gact = GroupAdminNFTCheckTokenInfo { group_nft, admin_nft, check_token }
    if (!defaultConfig.inboundMintCheck) throw new Error('inboundMintCheck validator not configured');
    const checkTokenInfo = mConStr0([checkTokenPolicy, inboundCheckTokenName]);
    const gactParam = mConStr0([groupNftInfo, adminNftInfo, checkTokenInfo]);
    const inboundMintCheckParam = mConStr0([gactParam, inboundTokenPolicy]);
    const inboundMintCheckCbor = applyParamsToScript(defaultConfig.inboundMintCheck.compiledCode, [inboundMintCheckParam]);
    const inboundMintCheckScript: PlutusScript = {
        code: inboundMintCheckCbor,
        version: defaultConfig.inboundMintCheck.plutusVersion,
    };
    const inboundMintCheckAddress = resolvePlutusScriptAddress(inboundMintCheckScript, defaultConfig.NETWORK);
    const inboundMintCheckHash = resolveScriptHash(inboundMintCheckCbor, defaultConfig.inboundMintCheck.plutusVersion);
    console.log(`  InboundMintCheck hash:    ${inboundMintCheckHash}`);
    console.log(`  InboundMintCheck address: ${inboundMintCheckAddress}`);

    // ── Step 3: Fetch GroupNFTHolder UTxO (for reference input) ─────────────
    console.log('\n--- Step 3: Fetch GroupNFTHolder UTxO ---');
    const holderUtxos = await provider.fetchAddressUTxOs(GROUP_NFT_HOLDER_ADDRESS);
    const groupNftUnit = GROUP_NFT_SYMBOL + GROUP_NFT_NAME;
    const groupNftHolderUtxo = holderUtxos.find(u =>
        u.output.amount.some(a => a.unit === groupNftUnit && parseInt(a.quantity) > 0),
    );
    if (!groupNftHolderUtxo) {
        throw new Error(`GroupNFT not found at holder address ${GROUP_NFT_HOLDER_ADDRESS}`);
    }
    console.log(`  GroupNFTHolder UTxO: ${groupNftHolderUtxo.input.txHash}#${groupNftHolderUtxo.input.outputIndex}`);

    // ── Step 4: Find AdminNFT UTxO in deployer wallet ───────────────────────
    console.log('\n--- Step 4: Find AdminNFT in wallet ---');
    const walletUtxos = await wallet.getUtxos();
    const adminNftUnit = ADMIN_NFT_SYMBOL + ADMIN_NFT_NAME;
    const adminNftUtxo = walletUtxos.find(u =>
        u.output.amount.some(a => a.unit === adminNftUnit && a.quantity === '1'),
    );
    if (!adminNftUtxo) {
        throw new Error(`No UTxO with exactly 1 AdminNFT (${adminNftUnit}). Split first.`);
    }
    console.log(`  AdminNFT UTxO: ${adminNftUtxo.input.txHash}#${adminNftUtxo.input.outputIndex}`);

    // ── Step 5: Build mint transaction ──────────────────────────────────────
    console.log(`\n--- Step 5: Build tx (mint ${count} check tokens) ---`);

    const txBuilder = new MeshTxBuilder({
        fetcher: provider,
        submitter: provider,
        // Don't use evaluator — Blockfrost can't evaluate complex multi-script txs with AdminNFT qty issues
    });

    const changeAddress = await wallet.getChangeAddress();
    const freshCollateral = (await wallet.getCollateral())[0];

    // Start building
    txBuilder
        // AdminNFT as a regular input (required by CheckToken validator)
        .txIn(
            adminNftUtxo.input.txHash,
            adminNftUtxo.input.outputIndex,
            adminNftUtxo.output.amount,
            adminNftUtxo.output.address,
        )
        // GroupNFTHolder as reference input (read-only, for GroupInfoParams)
        .readOnlyTxInReference(
            groupNftHolderUtxo.input.txHash,
            groupNftHolderUtxo.input.outputIndex,
        )
        // Mint N check tokens via Plutus V3 minting policy
        .mintPlutusScript(defaultConfig.checkToken.plutusVersion)
        .mint(count.toString(), checkTokenPolicy, inboundCheckTokenName)
        .mintingScript(checkTokenCbor)
        .mintRedeemerValue(mConStr0([]), undefined, { mem: 7_000_000, steps: 5_000_000_000 });

    // Each check token goes to InboundMintCheck address as a separate output
    // with inline Unit datum and min ADA
    const unitDatum = mConStr0([]);
    for (let i = 0; i < count; i++) {
        txBuilder
            .txOut(inboundMintCheckAddress, [
                { unit: checkTokenPolicy + inboundCheckTokenName, quantity: '1' },
                { unit: 'lovelace', quantity: '2000000' },
            ])
            .txOutInlineDatumValue(unitDatum);
    }

    // Send AdminNFT back to deployer wallet (it must not be consumed)
    txBuilder.txOut(walletAddr, [
        { unit: adminNftUnit, quantity: '1' },
        { unit: 'lovelace', quantity: '2000000' },
    ]);

    // Collateral + change + complete
    txBuilder
        .txInCollateral(
            freshCollateral.input.txHash,
            freshCollateral.input.outputIndex,
            freshCollateral.output.amount,
            freshCollateral.output.address,
        )
        .changeAddress(changeAddress)
        .selectUtxosFrom(walletUtxos.filter(u => {
            // Exclude ALL UTxOs with AdminNFT — the explicit adminNftUtxo input provides exactly 1
            return !u.output.amount.some((a: any) => a.unit === adminNftUnit);
        }));

    await txBuilder.complete();

    // ── Step 6: Sign and submit ─────────────────────────────────────────────
    console.log('\n--- Step 6: Sign and submit ---');
    const unsignedTx = txBuilder.txHex;
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    console.log(`  Submitted: ${txHash}`);

    // Wait for confirmation
    console.log('  Waiting for confirmation...');
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        try {
            const utxos = await provider.fetchAddressUTxOs(inboundMintCheckAddress);
            if (utxos.some(u => u.input.txHash === txHash)) {
                console.log('  Confirmed!');
                break;
            }
        } catch { /* not confirmed yet */ }
        await new Promise(r => setTimeout(r, 5000));
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`  Check tokens minted:   ${count}`);
    console.log(`  CheckToken policy:     ${checkTokenPolicy}`);
    console.log(`  Token name:            ${inboundCheckTokenName}`);
    console.log(`  Destination:           ${inboundMintCheckAddress}`);
    console.log(`  InboundMintCheck hash: ${inboundMintCheckHash}`);
    console.log(`  InboundToken policy:   ${inboundTokenPolicy}`);
    console.log(`  Tx hash:               ${txHash}`);
    console.log('\n=== Done! ===');
}

main().catch((err) => {
    console.error('Mint check tokens failed:', err);
    process.exit(1);
});
