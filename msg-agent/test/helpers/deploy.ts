/**
 * Full deployment pipeline for E2E testing on Yaci DevKit.
 *
 * Deploys all Aiken V3 validators, mints governance tokens, creates the
 * GroupNFTHolder UTxO, sets the GPK, updates stk_vh, and mints check tokens.
 *
 * Extracted from:
 *   - scripts/deploy-prod-validators.ts
 *   - scripts/update-gpk.ts
 *   - scripts/mint-check-tokens.ts
 */

import {
    BlockfrostProvider, MeshWallet, MeshTxBuilder, Transaction,
    ForgeScript, applyParamsToScript, resolveScriptHash,
    resolvePlutusScriptAddress, deserializeAddress,
    PlutusScript, serializeData,
} from '@meshsdk/core';
import { mConStr0 } from '@meshsdk/common';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';
import { defaultConfig } from '../../src/config';
import { submitTx, waitForTx, sleep } from './yaci';
import { walletAddress } from './wallet';

// Wire up sha512 for @noble/ed25519 v3 (variadic, matches update-gpk.ts)
(ed.hashes as any).sha512 = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));

/** Manual execution budgets — no evaluator available on Yaci. */
const PLUTUS_BUDGET = { mem: 7_000_000, steps: 5_000_000_000 };

export interface DeploymentResult {
    groupNftSymbol: string;
    groupNftName: string;
    adminNftSymbol: string;
    adminNftName: string;
    checkTokenSymbol: string;
    checkTokenName: string;
    inboundTokenPolicy: string;
    outboundTokenPolicy: string;
    xportHash: string;
    xportAddress: string;
    inboundMintCheckHash: string;
    inboundMintCheckAddress: string;
    groupNftHolderHash: string;
    groupNftHolderAddress: string;
    adminNftHolderHash: string;
    inboundHandlerAddress: string;
    outboundHandlerAddress: string;
    bridgeTokenPolicy: string;
    bridgeTokenName: string;
    ed25519PrivKey: string;
    ed25519PubKey: string;
    // Parameterized script CBORs (for building txs)
    groupNftHolderCbor: string;
    inboundMintCheckCbor: string;
    checkTokenCbor: string;
    outboundTokenCbor: string;
    inboundTokenCbor: string;
    xportCbor: string;
    inboundHandlerCbor: string;
    outboundHandlerCbor: string;
    bridgeTokenCbor: string;
}

/**
 * Deploy all validators and return everything needed for E2E tests.
 *
 * Steps:
 *   1. Mint AdminNFT (ForgeScript, native script)
 *   2. Mint GroupNFT (one-shot Plutus V3)
 *   3. Compute ALL parameterized validator hashes
 *   4. Create GroupNFTHolder UTxO with GroupInfoParams datum
 *   5. Generate Ed25519 keypair, update GPK (action=2)
 *   6. Update stk_vh to InboundMintCheck hash (action=7)
 *   7. Mint 5 check tokens at InboundMintCheck address
 *   8. Return all policy IDs, addresses, and parameterized script CBORs
 */
export async function deployAll(
    wallet: MeshWallet,
    provider: BlockfrostProvider,
): Promise<DeploymentResult> {
    const walletAddr = walletAddress(wallet);
    const walletPkh = deserializeAddress(walletAddr).pubKeyHash;

    // ── Step 1: Mint AdminNFT (ForgeScript) ──────────────────────────────────
    console.log('[deploy] Step 1: Mint AdminNFT');
    const adminForgingScript = ForgeScript.withOneSignature(walletAddr);
    const adminNftSymbol = resolveScriptHash(adminForgingScript);
    const adminNftName = Buffer.from('AdminNFT', 'ascii').toString('hex');

    const adminMintTx = new Transaction({ initiator: wallet });
    // ForgeScript mintAsset hex-encodes assetName internally, so pass raw string
    adminMintTx.mintAsset(adminForgingScript, {
        assetName: 'AdminNFT',
        assetQuantity: '1',
        recipient: walletAddr,
    });
    const adminUnsigned = await adminMintTx.build();
    const adminSigned = await wallet.signTx(adminUnsigned);
    const adminTxHash = await submitTx(adminSigned);
    console.log(`  AdminNFT minted: ${adminTxHash}`);
    await waitForTx(walletAddr, adminTxHash);
    await sleep(3000);

    // ── Step 2: Mint GroupNFT (one-shot) ─────────────────────────────────────
    console.log('[deploy] Step 2: Mint GroupNFT');
    const utxos = await wallet.getUtxos();
    const seedUtxo = utxos[0];
    if (!seedUtxo) throw new Error('No UTxOs available for GroupNFT mint');

    const orefParam = mConStr0([seedUtxo.input.txHash, seedUtxo.input.outputIndex]);

    if (!defaultConfig.groupNft) throw new Error('groupNft validator not configured');
    const groupNftCbor = applyParamsToScript(defaultConfig.groupNft.compiledCode, [orefParam]);
    const groupNftSymbol = resolveScriptHash(groupNftCbor, defaultConfig.groupNft.plutusVersion);
    const groupNftName = Buffer.from('GroupInfoTokenCoin', 'ascii').toString('hex');

    // ── Step 3: Compute all parameterized validator hashes ───────────────────
    console.log('[deploy] Step 3: Compute validator hashes');

    const groupNftInfo = mConStr0([groupNftSymbol, groupNftName]);
    const adminNftInfo = mConStr0([adminNftSymbol, adminNftName]);

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
    const xportAddress = resolvePlutusScriptAddress(xportScript, 0);
    const xportHash = resolveScriptHash(xportCbor, defaultConfig.xport.plutusVersion);

    // InboundMintCheck
    if (!defaultConfig.inboundMintCheck) throw new Error('inboundMintCheck not configured');
    const checkTokenInfo = mConStr0([checkTokenPolicy, inboundCheckTokenName]);
    const gactParam = mConStr0([groupNftInfo, adminNftInfo, checkTokenInfo]);
    const inboundMintCheckParam = mConStr0([gactParam, inboundTokenPolicy]);
    const inboundMintCheckCbor = applyParamsToScript(defaultConfig.inboundMintCheck.compiledCode, [inboundMintCheckParam]);
    const inboundMintCheckHash = resolveScriptHash(inboundMintCheckCbor, defaultConfig.inboundMintCheck.plutusVersion);
    const inboundMintCheckScript: PlutusScript = {
        code: inboundMintCheckCbor,
        version: defaultConfig.inboundMintCheck.plutusVersion,
    };
    const inboundMintCheckAddress = resolvePlutusScriptAddress(inboundMintCheckScript, 0);

    // GroupNFTHolder
    if (!defaultConfig.groupNftHolder) throw new Error('groupNftHolder not configured');
    const groupAdminParam = mConStr0([groupNftInfo, adminNftInfo]);
    const groupNftHolderCbor = applyParamsToScript(defaultConfig.groupNftHolder.compiledCode, [groupAdminParam]);
    const groupNftHolderScript: PlutusScript = {
        code: groupNftHolderCbor,
        version: defaultConfig.groupNftHolder.plutusVersion,
    };
    const groupNftHolderAddress = resolvePlutusScriptAddress(groupNftHolderScript, 0);
    const groupNftHolderHash = resolveScriptHash(groupNftHolderCbor, defaultConfig.groupNftHolder.plutusVersion);

    // AdminNFTHolder
    if (!defaultConfig.adminNftHolder) throw new Error('adminNftHolder not configured');
    const adminNftHolderCbor = applyParamsToScript(defaultConfig.adminNftHolder.compiledCode, [adminNftInfo]);
    const adminNftHolderHash = resolveScriptHash(adminNftHolderCbor, defaultConfig.adminNftHolder.plutusVersion);

    // InboundHandler (demo)
    if (!defaultConfig.demoInbound) throw new Error('demoInbound not configured');
    const inboundHandlerCbor = applyParamsToScript(defaultConfig.demoInbound.compiledCode, [inboundTokenPolicy]);
    const inboundHandlerScript: PlutusScript = {
        code: inboundHandlerCbor,
        version: defaultConfig.demoInbound.plutusVersion,
    };
    const inboundHandlerAddress = resolvePlutusScriptAddress(inboundHandlerScript, 0);

    // OutboundHandler (demo)
    if (!defaultConfig.demoOutbound) throw new Error('demoOutbound not configured');
    const outboundHandlerCbor = applyParamsToScript(defaultConfig.demoOutbound.compiledCode, [outboundTokenPolicy]);
    const outboundHandlerScript: PlutusScript = {
        code: outboundHandlerCbor,
        version: defaultConfig.demoOutbound.plutusVersion,
    };
    const outboundHandlerAddress = resolvePlutusScriptAddress(outboundHandlerScript, 0);

    // BridgeToken (demo)
    if (!defaultConfig.demoToken) throw new Error('demoToken not configured');
    const inboundHandlerScriptHash = resolveScriptHash(inboundHandlerCbor, defaultConfig.demoInbound.plutusVersion);
    const bridgeTokenCbor = applyParamsToScript(defaultConfig.demoToken.compiledCode, [inboundHandlerScriptHash, defaultConfig.demoTokenName]);
    const bridgeTokenPolicy = resolveScriptHash(bridgeTokenCbor, defaultConfig.demoToken.plutusVersion);
    const bridgeTokenName = defaultConfig.demoTokenName;

    console.log(`  GroupNFT:         ${groupNftSymbol}`);
    console.log(`  AdminNFT:         ${adminNftSymbol}`);
    console.log(`  CheckToken:       ${checkTokenPolicy}`);
    console.log(`  InboundToken:     ${inboundTokenPolicy}`);
    console.log(`  OutboundToken:    ${outboundTokenPolicy}`);
    console.log(`  XPort:            ${xportHash}`);
    console.log(`  InboundMintCheck: ${inboundMintCheckHash}`);
    console.log(`  GroupNFTHolder:   ${groupNftHolderHash}`);
    console.log(`  BridgeToken:      ${bridgeTokenPolicy}`);

    // ── Step 4: Mint GroupNFT + create GroupNFTHolder UTxO ───────────────────
    console.log('[deploy] Step 4: Mint GroupNFT + create GroupNFTHolder UTxO');

    const dummyHash = '00'.repeat(28);
    // Generate Ed25519 keypair upfront so GPK goes into initial datum
    const privKey = ed.utils.randomSecretKey();
    const pubKey = ed.getPublicKey(privKey);
    const privKeyHex = Buffer.from(privKey).toString('hex');
    const pubKeyHex = Buffer.from(pubKey).toString('hex');
    console.log(`  Ed25519 pubkey: ${pubKeyHex}`);

    const groupInfoParams = mConStr0([
        groupNftHolderHash,     // [0] version
        dummyHash,              // [1] admin
        pubKeyHex,              // [2] gpk (Ed25519 public key)
        dummyHash,              // [3] balance_worker
        dummyHash,              // [4] treasury_check_vh
        dummyHash,              // [5] oracle_worker
        dummyHash,              // [6] mint_check_vh
        inboundMintCheckHash,   // [7] stk_vh (= InboundMintCheck for check token routing)
        dummyHash,              // [8] stake_check_vh
        dummyHash,              // [9] nft_ref_holder_vh
        dummyHash,              // [10] nft_treasury_check_vh
        dummyHash,              // [11] nft_mint_check_vh
        xportHash,              // [12] outbound_holder_vh
        inboundMintCheckHash,   // [13] inbound_check_vh
    ]);

    const freshUtxos = await wallet.getUtxos();
    const collateral = await getCollateralUtxo(wallet);
    const changeAddress = await wallet.getChangeAddress();

    // Filter out UTxOs containing AdminNFT from selectUtxosFrom
    const adminNftUnit = adminNftSymbol + adminNftName;
    const utxosWithoutAdmin = freshUtxos.filter(
        (u) => !u.output.amount.some((a: { unit: string }) => a.unit === adminNftUnit),
    );

    const groupMintBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });
    await groupMintBuilder
        .txIn(seedUtxo.input.txHash, seedUtxo.input.outputIndex, seedUtxo.output.amount, seedUtxo.output.address)
        .mintPlutusScript(defaultConfig.groupNft.plutusVersion)
        .mint('1', groupNftSymbol, groupNftName)
        .mintingScript(groupNftCbor)
        .mintRedeemerValue(mConStr0([]), undefined, PLUTUS_BUDGET)
        .txOut(groupNftHolderAddress, [
            { unit: groupNftSymbol + groupNftName, quantity: '1' },
            { unit: 'lovelace', quantity: '5000000' },
        ])
        .txOutInlineDatumValue(groupInfoParams)
        .txInCollateral(
            collateral.input.txHash,
            collateral.input.outputIndex,
            collateral.output.amount,
            collateral.output.address,
        )
        .changeAddress(changeAddress)
        .selectUtxosFrom(utxosWithoutAdmin)
        .complete();

    const groupUnsigned = groupMintBuilder.txHex;
    const groupSigned = await wallet.signTx(groupUnsigned);
    const groupTxHash = await submitTx(groupSigned);
    console.log(`  GroupNFT + holder created: ${groupTxHash}`);
    await waitForTx(groupNftHolderAddress, groupTxHash);
    await sleep(3000);

    // Steps 5-6 eliminated: GPK and stk_vh set in initial GroupInfoParams above

    // ── Step 5: Mint 5 check tokens at InboundMintCheck address ──────────────
    console.log('[deploy] Step 7: Mint check tokens');

    const checkCount = 5;
    const mintCheckUtxos = await wallet.getUtxos();
    const mintCheckCollateral = await getCollateralUtxo(wallet);
    const mintCheckChangeAddr = await wallet.getChangeAddress();

    // Find AdminNFT UTxO with exactly qty=1
    const adminUtxoForMint = mintCheckUtxos.find((u) =>
        u.output.amount.some((a: { unit: string; quantity: string }) => a.unit === adminNftUnit && a.quantity === '1'),
    );
    if (!adminUtxoForMint) throw new Error('AdminNFT UTxO with qty=1 not found for check token mint');

    // GroupNFTHolder UTxO for reference input
    const holderUtxosForRef = await provider.fetchAddressUTxOs(groupNftHolderAddress);
    const groupNftUnit = groupNftSymbol + groupNftName;
    const holderRefUtxo = holderUtxosForRef.find((u) =>
        u.output.amount.some((a: { unit: string }) => a.unit === groupNftUnit),
    );
    if (!holderRefUtxo) throw new Error('GroupNFTHolder UTxO not found for check token mint');

    const mintBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });

    // AdminNFT as regular input
    mintBuilder.txIn(
        adminUtxoForMint.input.txHash,
        adminUtxoForMint.input.outputIndex,
        adminUtxoForMint.output.amount,
        adminUtxoForMint.output.address,
    );

    // GroupNFTHolder as reference input
    mintBuilder.readOnlyTxInReference(
        holderRefUtxo.input.txHash,
        holderRefUtxo.input.outputIndex,
    );

    // Mint N check tokens
    mintBuilder
        .mintPlutusScript(defaultConfig.checkToken.plutusVersion)
        .mint(checkCount.toString(), checkTokenPolicy, inboundCheckTokenName)
        .mintingScript(checkTokenCbor)
        .mintRedeemerValue(mConStr0([]), undefined, PLUTUS_BUDGET);

    // Each check token goes to InboundMintCheck address with unit datum
    const unitDatum = mConStr0([]);
    for (let i = 0; i < checkCount; i++) {
        mintBuilder
            .txOut(inboundMintCheckAddress, [
                { unit: checkTokenPolicy + inboundCheckTokenName, quantity: '1' },
                { unit: 'lovelace', quantity: '2000000' },
            ])
            .txOutInlineDatumValue(unitDatum);
    }

    // Send AdminNFT back to deployer
    mintBuilder.txOut(walletAddr, [
        { unit: adminNftUnit, quantity: '1' },
        { unit: 'lovelace', quantity: '2000000' },
    ]);

    // Collateral, change, selectUtxos (exclude AdminNFT UTxOs)
    mintBuilder
        .txInCollateral(
            mintCheckCollateral.input.txHash,
            mintCheckCollateral.input.outputIndex,
            mintCheckCollateral.output.amount,
            mintCheckCollateral.output.address,
        )
        .changeAddress(mintCheckChangeAddr)
        .selectUtxosFrom(mintCheckUtxos.filter(
            (u) => !u.output.amount.some((a: { unit: string }) => a.unit === adminNftUnit),
        ));

    await mintBuilder.complete();

    const mintUnsigned = mintBuilder.txHex;
    const mintSigned = await wallet.signTx(mintUnsigned);
    const mintTxHash = await submitTx(mintSigned);
    console.log(`  Check tokens minted: ${mintTxHash}`);
    await waitForTx(inboundMintCheckAddress, mintTxHash);

    console.log('[deploy] Deployment complete');

    return {
        groupNftSymbol,
        groupNftName,
        adminNftSymbol,
        adminNftName,
        checkTokenSymbol: checkTokenPolicy,
        checkTokenName: inboundCheckTokenName,
        inboundTokenPolicy,
        outboundTokenPolicy,
        xportHash,
        xportAddress,
        inboundMintCheckHash,
        inboundMintCheckAddress,
        groupNftHolderHash,
        groupNftHolderAddress,
        adminNftHolderHash,
        inboundHandlerAddress,
        outboundHandlerAddress,
        bridgeTokenPolicy,
        bridgeTokenName,
        ed25519PrivKey: privKeyHex,
        ed25519PubKey: pubKeyHex,
        groupNftHolderCbor,
        inboundMintCheckCbor,
        checkTokenCbor,
        outboundTokenCbor,
        inboundTokenCbor,
        xportCbor,
        inboundHandlerCbor,
        outboundHandlerCbor,
        bridgeTokenCbor,
    };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Get a collateral UTxO from the wallet, creating one if needed.
 */
async function getCollateralUtxo(wallet: MeshWallet) {
    let collateral = (await wallet.getCollateral())[0];
    if (collateral) return collateral;

    // Create collateral via a self-send
    const addr = walletAddress(wallet);
    const tx = new Transaction({ initiator: wallet });
    tx.sendLovelace(addr, '5000000');
    const unsigned = await tx.build();
    const signed = await wallet.signTx(unsigned);
    const txHash = await submitTx(signed);
    await waitForTx(addr, txHash);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const cols = await wallet.getCollateral();
        if (cols.length > 0) return cols[0];
        await sleep(2000);
    }
    throw new Error('getCollateralUtxo: collateral creation timed out');
}

