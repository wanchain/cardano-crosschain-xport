#!/usr/bin/env ts-node
/**
 * update-gpk.ts — Update the GPK field in the deployed GroupInfoParams datum.
 *
 * Generates (or reads from INBOUND_SIGNING_KEY env) an Ed25519 keypair,
 * then builds a transaction that spends the GroupNFTHolder UTxO with
 * redeemer action=2, changing only the gpk field in GroupInfoParams.
 *
 * Prerequisites:
 *   - BLOCKFROST_API_KEY, ACCOUNT_SEED1 set in .env
 *   - GROUP_NFT_SYMBOL, GROUP_NFT_NAME set in .env
 *   - AdminNFT in deployer wallet
 *   - GroupNFTHolder UTxO exists with GroupInfoParams inline datum
 *
 * Usage:
 *   cd msg-agent && npx ts-node scripts/update-gpk.ts
 */

import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.join(__dirname, '../', '.env') });

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';

// Wire up sha512 for @noble/ed25519 v3
(ed.hashes as any).sha512 = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));

import {
    BlockfrostProvider, MeshWallet, MeshTxBuilder,
    applyParamsToScript, resolveScriptHash,
    resolvePlutusScriptAddress, deserializeAddress, deserializeDatum,
    PlutusScript,
} from '@meshsdk/core';
import { mConStr0 } from '@meshsdk/common';
import { defaultConfig } from '../src/config';

// Known production values from deploy-xport.ts output
const GROUP_NFT_SYMBOL = process.env.GROUP_NFT_SYMBOL || '9e8b43e9bdfe2f9fd10a8b43899b14e95660598a4f0ad635fa2e7c36';
const GROUP_NFT_NAME = process.env.GROUP_NFT_NAME || '47726f7570496e666f546f6b656e436f696e';
const ADMIN_NFT_SYMBOL = process.env.ADMIN_NFT_SYMBOL || 'a2a5c7ccfe3b6e2cbac42269dbb932f7429310b6a686abd37ec7fb65';
const ADMIN_NFT_NAME = process.env.ADMIN_NFT_NAME || '41646d696e4e4654'; // hex("AdminNFT")

async function main() {
    console.log('=== Update GPK (Group Public Key) ===\n');

    // ── Env checks ─────────────────────────────────────────────────────────
    const apiKey = process.env.BLOCKFROST_API_KEY;
    if (!apiKey) { console.error('BLOCKFROST_API_KEY not set'); process.exit(1); }
    const seed = process.env.ACCOUNT_SEED1;
    if (!seed) { console.error('ACCOUNT_SEED1 not set'); process.exit(1); }

    // ── Ed25519 keypair ────────────────────────────────────────────────────
    let privKey: Uint8Array;
    if (process.env.INBOUND_SIGNING_KEY) {
        console.log('Using INBOUND_SIGNING_KEY from environment.');
        privKey = Buffer.from(process.env.INBOUND_SIGNING_KEY, 'hex');
    } else {
        console.log('Generating new Ed25519 keypair...');
        privKey = ed.utils.randomSecretKey();
    }
    const pubKey = ed.getPublicKey(privKey);
    const privKeyHex = Buffer.from(privKey).toString('hex');
    const pubKeyHex = Buffer.from(pubKey).toString('hex');
    console.log(`  Public key:  ${pubKeyHex}`);
    console.log(`  (32 bytes = ${pubKeyHex.length} hex chars)\n`);

    // ── Wallet & provider ──────────────────────────────────────────────────
    const provider = new BlockfrostProvider(apiKey);
    const wallet = new MeshWallet({
        networkId: defaultConfig.NETWORK ? 1 : 0,
        fetcher: provider,
        submitter: provider,
        key: { type: 'cli', payment: '5820' + seed },
    });
    await wallet.init();
    const walletAddr = wallet.addresses.baseAddressBech32 ?? '';
    console.log(`Deployer wallet: ${walletAddr}\n`);

    // ── Ensure collateral ──────────────────────────────────────────────────
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

    // ── Parameterize GroupNFTHolder validator ───────────────────────────────
    const groupNftInfo = mConStr0([GROUP_NFT_SYMBOL, GROUP_NFT_NAME]);
    const adminNftInfo = mConStr0([ADMIN_NFT_SYMBOL, ADMIN_NFT_NAME]);

    if (!defaultConfig.groupNftHolder) throw new Error('groupNftHolder validator not configured');
    const groupAdminParam = mConStr0([groupNftInfo, adminNftInfo]);
    const groupNftHolderCbor = applyParamsToScript(defaultConfig.groupNftHolder.compiledCode, [groupAdminParam]);
    const groupNftHolderScript: PlutusScript = {
        code: groupNftHolderCbor,
        version: defaultConfig.groupNftHolder.plutusVersion,
    };
    const groupNftHolderAddress = resolvePlutusScriptAddress(groupNftHolderScript, defaultConfig.NETWORK);
    const groupNftHolderHash = resolveScriptHash(groupNftHolderCbor, defaultConfig.groupNftHolder.plutusVersion);
    console.log(`GroupNFTHolder hash:    ${groupNftHolderHash}`);
    console.log(`GroupNFTHolder address: ${groupNftHolderAddress}\n`);

    // ── Fetch the GroupNFTHolder UTxO ───────────────────────────────────────
    console.log('Fetching GroupNFTHolder UTxOs...');
    const holderUtxos = await provider.fetchAddressUTxOs(groupNftHolderAddress);
    const groupNftUnit = GROUP_NFT_SYMBOL + GROUP_NFT_NAME;
    const holderUtxo = holderUtxos.find(u =>
        u.output.amount.some(a => a.unit === groupNftUnit)
    );
    if (!holderUtxo) {
        throw new Error(`No UTxO found at ${groupNftHolderAddress} holding GroupNFT (${groupNftUnit})`);
    }
    console.log(`  Found holder UTxO: ${holderUtxo.input.txHash}#${holderUtxo.input.outputIndex}`);

    // ── Decode existing GroupInfoParams datum ──────────────────────────────
    const datumCbor = holderUtxo.output.plutusData;
    if (!datumCbor) {
        throw new Error('GroupNFTHolder UTxO has no inline datum (plutusData)');
    }
    const datum = deserializeDatum<{ constructor: bigint; fields: Array<{ bytes?: string; int?: bigint }> }>(datumCbor);
    if (!datum?.fields || datum.fields.length < 14) {
        throw new Error(`Expected ConStr0 with 14 fields, got ${datum?.fields?.length ?? 0} fields`);
    }

    console.log('\nCurrent GroupInfoParams:');
    const fieldNames = [
        'version', 'admin', 'gpk', 'balance_worker', 'treasury_check_vh',
        'oracle_worker', 'mint_check_vh', 'stk_vh', 'stake_check_vh',
        'nft_ref_holder_vh', 'nft_treasury_check_vh', 'nft_mint_check_vh',
        'outbound_holder_vh', 'inbound_check_vh',
    ];
    for (let i = 0; i < datum.fields.length; i++) {
        const val = datum.fields[i].bytes ?? String(datum.fields[i].int);
        console.log(`  [${i}] ${fieldNames[i]}: ${val}`);
    }

    // ── Build new GroupInfoParams (only gpk changed) ──────────────────────
    // Extract current field values as hex strings
    const currentFields = datum.fields.map(f => f.bytes ?? '');
    const newFields = [...currentFields];
    newFields[2] = pubKeyHex; // Replace gpk (index 2)

    console.log(`\nUpdating gpk from ${currentFields[2]} to ${pubKeyHex}\n`);

    // Construct new GroupInfoParams as mConStr0 with all ByteArray fields
    const newGroupInfoParams = mConStr0(newFields);

    // ── Find AdminNFT UTxO in deployer wallet ─────────────────────────────
    const walletUtxos = await wallet.getUtxos();
    const adminNftUnit = ADMIN_NFT_SYMBOL + ADMIN_NFT_NAME;
    const adminUtxo = walletUtxos.find(u =>
        u.output.amount.some(a => a.unit === adminNftUnit)
    );
    if (!adminUtxo) {
        throw new Error(`AdminNFT (${adminNftUnit}) not found in deployer wallet`);
    }
    console.log(`AdminNFT UTxO: ${adminUtxo.input.txHash}#${adminUtxo.input.outputIndex}`);

    // ── Build the transaction ──────────────────────────────────────────────
    console.log('\nBuilding transaction...');
    const txBuilder = new MeshTxBuilder({
        fetcher: provider,
        submitter: provider,
        evaluator: provider,
    });

    const freshCollateral = (await wallet.getCollateral())[0];
    const changeAddress = await wallet.getChangeAddress();
    const freshUtxos = await wallet.getUtxos();

    await txBuilder
        // Spend the GroupNFTHolder UTxO (Plutus V3 script input)
        .spendingPlutusScript(defaultConfig.groupNftHolder.plutusVersion)
        .txIn(
            holderUtxo.input.txHash,
            holderUtxo.input.outputIndex,
            holderUtxo.output.amount,
            holderUtxo.output.address,
        )
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(2)
        .txInScript(groupNftHolderCbor)

        // Include AdminNFT as regular input (for isAuthorized check)
        .txIn(
            adminUtxo.input.txHash,
            adminUtxo.input.outputIndex,
            adminUtxo.output.amount,
            adminUtxo.output.address,
        )

        // Output: GroupNFT back to same script address with updated datum
        .txOut(groupNftHolderAddress, [
            { unit: groupNftUnit, quantity: '1' },
            { unit: 'lovelace', quantity: '5000000' },
        ])
        .txOutInlineDatumValue(newGroupInfoParams)

        // Collateral
        .txInCollateral(
            freshCollateral.input.txHash,
            freshCollateral.input.outputIndex,
            freshCollateral.output.amount,
            freshCollateral.output.address,
        )
        .changeAddress(changeAddress)
        .selectUtxosFrom(freshUtxos)
        .complete();

    // ── Sign & submit ──────────────────────────────────────────────────────
    const unsignedTx = txBuilder.txHex;
    const signedTx = await wallet.signTx(unsignedTx);
    console.log('Submitting transaction...');
    const txHash = await wallet.submitTx(signedTx);
    console.log(`\nTransaction submitted: ${txHash}`);

    // ── Wait for confirmation ──────────────────────────────────────────────
    console.log('Waiting for confirmation...');
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        try {
            const utxos = await provider.fetchAddressUTxOs(groupNftHolderAddress);
            if (utxos.some(u => u.input.txHash === txHash)) {
                console.log('Confirmed!\n');
                break;
            }
        } catch { /* not confirmed yet */ }
        await new Promise(r => setTimeout(r, 5000));
    }

    // ── Print summary ──────────────────────────────────────────────────────
    console.log('=== GPK Update Summary ===\n');
    console.log(`Transaction:  ${txHash}`);
    console.log(`New GPK:      ${pubKeyHex}`);
    console.log();
    console.log('Add to .env (do not commit or log in CI):');
    console.log(`  INBOUND_SIGNING_KEY=${privKeyHex}`);
    console.log();
    console.log('=== GPK update complete! ===');
}

main().catch((err) => {
    console.error('GPK update failed:', err);
    process.exit(1);
});
