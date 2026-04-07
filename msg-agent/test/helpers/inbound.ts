/**
 * Inbound task creation with Ed25519 proof for E2E testing on Yaci DevKit.
 *
 * Builds the InboundMintCheck spending transaction:
 *   1. Find check token UTxO at InboundMintCheck address
 *   2. Construct CrossMsgData datum
 *   3. Construct InboundProofData with Ed25519 signature
 *   4. Spend check UTxO + mint inbound token + output at handler + return check token
 *
 * Reference: scripts/test-local.ts (production inbound path)
 */

import {
    BlockfrostProvider, MeshWallet, MeshTxBuilder,
    PlutusScript, serializeData, resolveScriptHash,
} from '@meshsdk/core';
import { mConStr0, mConStr1, mScriptAddress } from '@meshsdk/common';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';
import { sha3_256 } from '@noble/hashes/sha3';
import { defaultConfig } from '../../src/config';
import { genBeneficiaryData } from '../../src/datum';
import { submitTx } from './yaci';
import { walletAddress } from './wallet';
import type { DeploymentResult } from './deploy';

// Wire up sha512 for @noble/ed25519 v3 (variadic, matches update-gpk.ts)
(ed.hashes as any).sha512 = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));

/** Manual execution budgets — no evaluator on Yaci. */
const SPENDING_BUDGET = { mem: 8_000_000, steps: 5_000_000_000 };
const MINTING_BUDGET = { mem: 4_000_000, steps: 2_000_000_000 };

/**
 * Create an inbound task by spending a check token UTxO at InboundMintCheck
 * with an Ed25519 proof, minting an inbound token, and sending it to the
 * inbound handler address with a CrossMsgData datum.
 *
 * @returns The transaction hash
 */
export async function createInboundTask(params: {
    wallet: MeshWallet;
    provider: BlockfrostProvider;
    deployment: DeploymentResult;
    receiverAddress: string;
    amount: number;
}): Promise<string> {
    const { wallet, provider, deployment, receiverAddress, amount } = params;
    const walletAddr = walletAddress(wallet);

    const {
        checkTokenSymbol, checkTokenName,
        inboundTokenPolicy, inboundMintCheckCbor, inboundMintCheckAddress, inboundMintCheckHash,
        inboundHandlerAddress, inboundHandlerCbor,
        groupNftSymbol, groupNftName, groupNftHolderAddress,
        ed25519PrivKey,
    } = deployment;

    // Token name for the inbound token = inbound handler script hash
    const inboundHandlerScriptHash = resolveScriptHash(
        inboundHandlerCbor,
        defaultConfig.demoInbound!.plutusVersion,
    );
    const inboundTokenName = inboundHandlerScriptHash;

    // Parameterize inbound token script for minting
    const inboundTokenScript: PlutusScript = {
        code: deployment.inboundTokenCbor,
        version: defaultConfig.inboundToken!.plutusVersion,
    };

    // ── 1. Find check token UTxO at InboundMintCheck address ────────────────
    const checkTokenUnit = checkTokenSymbol + checkTokenName;
    const mintCheckUtxos = await provider.fetchAddressUTxOs(inboundMintCheckAddress);
    const checkUtxo = mintCheckUtxos.find((u) =>
        u.output.amount.some(
            (a: { unit: string; quantity: string }) => a.unit === checkTokenUnit && BigInt(a.quantity) >= 1n,
        ),
    );
    if (!checkUtxo) {
        throw new Error(
            `No check token UTxO found at ${inboundMintCheckAddress}. ` +
            `Have ${mintCheckUtxos.length} UTxOs.`,
        );
    }

    // ── 2. Construct CrossMsgData datum ─────────────────────────────────────
    const evmContract = defaultConfig.EvmContractADDRESS;
    const fromChainId = defaultConfig.EvmChainId;
    const toChainId = defaultConfig.AdaChainId;
    const fromAddress = mConStr0([evmContract]);
    const toAddress = mConStr1([mScriptAddress(inboundHandlerScriptHash)]);
    const beneficiary = genBeneficiaryData(receiverAddress, amount);
    const functionCallData = mConStr0(['wmbReceiveNonEvm', serializeData(beneficiary)]);
    const crossMsgData = mConStr0([
        '', fromChainId, fromAddress, toChainId, toAddress, 2000000, functionCallData,
    ]);

    // ── 3. Construct InboundProofData and sign with Ed25519 ─────────────────
    const ttl = Date.now() + 300_000; // 5 minutes from now (POSIXTime ms)
    const nonce = mConStr0([checkUtxo.input.txHash, checkUtxo.input.outputIndex]);
    const proofData = mConStr0([crossMsgData, ttl, 2, nonce]); // mode = 2 (Ed25519)

    const proofDataCbor = serializeData(proofData);
    const proofDataHash = sha3_256(Buffer.from(proofDataCbor, 'hex'));

    const privKey = Buffer.from(ed25519PrivKey, 'hex');
    const signature = ed.sign(proofDataHash, privKey);
    const pubKey = ed.getPublicKey(privKey);

    // Verify locally before submitting
    const isValid = ed.verify(signature, proofDataHash, pubKey);
    if (!isValid) throw new Error('Ed25519 signature verification failed locally');

    // ── 4. Build redeemer ───────────────────────────────────────────────────
    const signatureHex = Buffer.from(signature).toString('hex');
    const inboundProof = mConStr0([proofData, signatureHex]);
    // InboundCheckRedeemer::InboundCheckRedeemer(InboundProof) = constructor 1
    const redeemer = mConStr1([inboundProof]);

    // ── 5. Fetch required UTxOs (fresh from provider to avoid stale cache) ──
    const walletUtxos = await provider.fetchAddressUTxOs(walletAddr);
    let collateral = (await wallet.getCollateral())[0];
    if (!collateral) {
        const { ensureCollateral } = await import('./wallet');
        await ensureCollateral(wallet);
        collateral = (await wallet.getCollateral())[0];
        if (!collateral) throw new Error('No collateral available after ensureCollateral');
    }
    const changeAddress = await wallet.getChangeAddress();

    // GroupNFTHolder UTxO for reference input
    const groupNftUnit = groupNftSymbol + groupNftName;
    const groupNftHolderUtxos = await provider.fetchAddressUTxOs(groupNftHolderAddress);
    const groupNftHolderUtxo = groupNftHolderUtxos.find((u) =>
        u.output.amount.some((a: { unit: string }) => a.unit === groupNftUnit),
    );
    if (!groupNftHolderUtxo) {
        throw new Error(`GroupNFTHolder UTxO not found at ${groupNftHolderAddress}`);
    }

    // Check token output goes back to InboundMintCheck (stk_vh == inboundMintCheckHash)
    const checkTokenOutputAddress = inboundMintCheckAddress;

    // ── 6. Get slot info for validity range ─────────────────────────────────
    const latestBlock = await (provider as any).fetchBlockInfo('latest');
    const currentSlot: number = Number(latestBlock.slot);
    const txValidFrom = currentSlot;
    const txValidTo = currentSlot + 200;

    // ── 7. Build transaction ────────────────────────────────────────────────
    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });

    await txBuilder
        // Spend check token UTxO at InboundMintCheck
        .spendingPlutusScript(defaultConfig.inboundMintCheck!.plutusVersion)
        .txIn(
            checkUtxo.input.txHash,
            checkUtxo.input.outputIndex,
            checkUtxo.output.amount,
            checkUtxo.output.address,
        )
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(redeemer, undefined, SPENDING_BUDGET)
        .txInScript(inboundMintCheckCbor)
        // Mint 1 inbound token
        .mintPlutusScript(inboundTokenScript.version)
        .mint('1', inboundTokenPolicy, inboundTokenName)
        .mintingScript(inboundTokenScript.code)
        .mintRedeemerValue(mConStr0([]), undefined, MINTING_BUDGET)
        // Output: inbound token + CrossMsgData datum at inbound handler address
        .txOut(inboundHandlerAddress, [
            { unit: inboundTokenPolicy + inboundTokenName, quantity: '1' },
            { unit: 'lovelace', quantity: '5000000' },
        ])
        .txOutInlineDatumValue(crossMsgData)
        // Output: check token back to stk_vh address
        .txOut(checkTokenOutputAddress, [
            { unit: checkTokenUnit, quantity: '1' },
            { unit: 'lovelace', quantity: '5000000' },
        ])
        .txOutInlineDatumValue(mConStr0([0]))
        // Reference input: GroupNFTHolder
        .readOnlyTxInReference(
            groupNftHolderUtxo.input.txHash,
            groupNftHolderUtxo.input.outputIndex,
        )
        // Validity range
        .invalidBefore(txValidFrom)
        .invalidHereafter(txValidTo)
        // Collateral
        .txInCollateral(
            collateral.input.txHash,
            collateral.input.outputIndex,
            collateral.output.amount,
            collateral.output.address,
        )
        .changeAddress(changeAddress)
        .selectUtxosFrom(walletUtxos)
        .complete();

    const unsignedTx = txBuilder.txHex;
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await submitTx(signedTx);
    return txHash;
}
