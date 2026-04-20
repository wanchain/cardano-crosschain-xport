/**
 * Standalone Cardano task processing functions for cross-chain E2E tests.
 *
 * These replicate the msg-agent's sendTxDoInboundTask and sendTxDoOutboundTask
 * but take explicit parameters instead of relying on module-level state.
 *
 * processInbound: burns inbound token, mints bridge tokens to receiver
 * processOutbound: burns bridge tokens, mints outbound token + CrossMsgData at xport
 */

import {
    BlockfrostProvider, MeshWallet, MeshTxBuilder,
    serializeData, resolveScriptHash,
    PlutusScript,
} from '@meshsdk/core';
import { mConStr0, mConStr1, mScriptAddress } from '@meshsdk/common';
import { submitTx, waitForTx, sleep } from './cardano-deploy';
import type { DeploymentResult } from './cardano-deploy';

import { defaultConfig } from '../../msg-agent/src/config';
import { genBeneficiaryData, bech32AddressToMeshData } from '../../msg-agent/src/datum';

/**
 * Build CrossMsgData datum for outbound messages (standalone version of
 * msg-agent's genMsgCrossData, without module-level contractsInfo dependency).
 */
function genMsgCrossData(
    to: string,
    amount: string | bigint | number,
    outboundHandlerCbor: string,
    outboundVersion: 'V1' | 'V2' | 'V3',
) {
    const scriptHash = resolveScriptHash(outboundHandlerCbor, outboundVersion);
    const taskId = '';
    const fromChainId = defaultConfig.AdaChainId;
    const fromAddress = mConStr1([mScriptAddress(scriptHash)]);
    const toChainId = defaultConfig.EvmChainId;
    const toAddress = mConStr0([defaultConfig.EvmContractADDRESS]);
    const gasLimit = 2000000;
    const callData = mConStr0(['wmbReceiveNonEvm', serializeData(genBeneficiaryData(to, amount))]);
    return mConStr0([taskId, fromChainId, fromAddress, toChainId, toAddress, gasLimit, callData]);
}

/** Manual execution budgets — must fit within Yaci max (mem: 14M, steps: 10B). */
const SPENDING_BUDGET = { mem: 5_000_000, steps: 3_000_000_000 };
const MINTING_BUDGET = { mem: 2_000_000, steps: 1_500_000_000 };

/**
 * Process an inbound task: find the inbound token UTxO at the handler,
 * burn it, and mint bridge tokens to the receiver.
 *
 * This replicates what msg-agent's monitor does for INBOUND tasks.
 */
export async function processInboundTask(params: {
    wallet: MeshWallet;
    provider: BlockfrostProvider;
    deployment: DeploymentResult;
    inboundHandlerAddress: string;
}): Promise<string | null> {
    const { wallet, provider, deployment, inboundHandlerAddress } = params;

    // Find inbound token UTxO at handler address
    const handlerUtxos = await provider.fetchAddressUTxOs(inboundHandlerAddress);
    const inboundTokenPolicy = deployment.inboundTokenPolicy;

    const taskUtxo = handlerUtxos.find((u) =>
        u.output.amount.some((a: { unit: string }) => a.unit.startsWith(inboundTokenPolicy)),
    );
    if (!taskUtxo) return null; // No inbound task to process

    // Extract inbound token info
    const inboundTokenAsset = taskUtxo.output.amount.find(
        (a: { unit: string }) => a.unit.startsWith(inboundTokenPolicy),
    )!;
    const tokenName = inboundTokenAsset.unit.slice(56);

    // Parse datum to get receiver and amount
    // The datum is CrossMsgData — we need functionCallData.functionArgs (Beneficiary)
    // For simplicity in E2E, we'll use the datum CBOR directly
    const datumCbor = taskUtxo.output.plutusData;
    if (!datumCbor) throw new Error('Inbound task UTxO has no inline datum');

    // Import datum parser
    const { getMsgCrossDataFromCbor } = await import('../../msg-agent/src/datum');
    const crossMsgData = getMsgCrossDataFromCbor(datumCbor, 0);
    const receiver = crossMsgData.functionCallData.functionArgs.receiver;
    const amount = crossMsgData.functionCallData.functionArgs.amount;

    // Build the processing transaction
    const walletAddr = wallet.addresses.baseAddressBech32 ?? wallet.addresses.enterpriseAddressBech32 ?? '';
    const walletUtxos = await provider.fetchAddressUTxOs(walletAddr);
    let collateral = (await wallet.getCollateral())[0];
    if (!collateral) {
        const { ensureCollateral } = await import('./cardano-deploy');
        await ensureCollateral(wallet);
        collateral = (await wallet.getCollateral())[0];
        if (!collateral) throw new Error('No collateral for inbound processing');
    }
    const changeAddress = await wallet.getChangeAddress();

    // Bridge token = demoToken
    const demoTokenPolicy = deployment.bridgeTokenPolicy;
    const demoTokenName = deployment.bridgeTokenName;

    // Inbound demo script (handler)
    const inboundDemoScript: PlutusScript = {
        code: deployment.inboundHandlerCbor,
        version: defaultConfig.demoInbound!.plutusVersion,
    };

    // Inbound token script
    const inboundTokenScript: PlutusScript = {
        code: deployment.inboundTokenCbor,
        version: defaultConfig.inboundToken!.plutusVersion,
    };

    // Bridge token script
    const bridgeTokenScript: PlutusScript = {
        code: deployment.bridgeTokenCbor,
        version: defaultConfig.demoToken!.plutusVersion,
    };

    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });

    const bridgeAssets = [
        { unit: demoTokenPolicy + demoTokenName, quantity: BigInt(amount).toString(10) },
        { unit: 'lovelace', quantity: '2000000' },
    ];

    const redeemer = mConStr0([demoTokenPolicy, defaultConfig.EvmContractADDRESS]);

    await txBuilder
        // Spend inbound task UTxO
        .spendingPlutusScript(inboundDemoScript.version)
        .txIn(taskUtxo.input.txHash, taskUtxo.input.outputIndex, taskUtxo.output.amount, taskUtxo.output.address)
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(redeemer, undefined, SPENDING_BUDGET)
        .txInScript(inboundDemoScript.code)
        // Burn inbound token
        .mintPlutusScript(inboundTokenScript.version)
        .mint('-' + inboundTokenAsset.quantity, inboundTokenPolicy, tokenName)
        .mintingScript(inboundTokenScript.code)
        .mintRedeemerValue(mConStr0([]), undefined, MINTING_BUDGET)
        // Mint bridge tokens
        .mintPlutusScript(bridgeTokenScript.version)
        .mint(BigInt(amount).toString(10), demoTokenPolicy, demoTokenName)
        .mintingScript(bridgeTokenScript.code)
        .mintRedeemerValue(mConStr0([]), undefined, MINTING_BUDGET)
        // Send bridge tokens to receiver
        .txOut(receiver, bridgeAssets)
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

/**
 * Process an outbound task: find the bridge token UTxO at the handler,
 * burn bridge tokens, and mint outbound token + CrossMsgData at xport.
 *
 * This replicates what msg-agent's monitor does for OUTBOUND tasks.
 */
export async function processOutboundTask(params: {
    wallet: MeshWallet;
    provider: BlockfrostProvider;
    deployment: DeploymentResult;
    outboundHandlerAddress: string;
}): Promise<string | null> {
    const { wallet, provider, deployment, outboundHandlerAddress } = params;

    // Find bridge token UTxO at outbound handler address
    const handlerUtxos = await provider.fetchAddressUTxOs(outboundHandlerAddress);
    const demoTokenPolicy = deployment.bridgeTokenPolicy;
    const demoTokenName = deployment.bridgeTokenName;
    const tokenUnit = demoTokenPolicy + demoTokenName;

    const taskUtxo = handlerUtxos.find((u) =>
        u.output.amount.some((a: { unit: string }) => a.unit === tokenUnit),
    );
    if (!taskUtxo) return null; // No outbound task to process

    // Parse Beneficiary datum
    const datumCbor = taskUtxo.output.plutusData;
    if (!datumCbor) throw new Error('Outbound task UTxO has no inline datum');

    const { getBeneficiaryFromCbor } = await import('../../msg-agent/src/datum');
    const beneficiary = getBeneficiaryFromCbor(datumCbor, 0);
    const receiver = beneficiary.receiver;
    const amount = beneficiary.amount;

    // Build the processing transaction
    const walletAddr = wallet.addresses.baseAddressBech32 ?? wallet.addresses.enterpriseAddressBech32 ?? '';
    const walletUtxos = await provider.fetchAddressUTxOs(walletAddr);
    let collateral = (await wallet.getCollateral())[0];
    if (!collateral) {
        const { ensureCollateral } = await import('./cardano-deploy');
        await ensureCollateral(wallet);
        collateral = (await wallet.getCollateral())[0];
        if (!collateral) throw new Error('No collateral for outbound processing');
    }
    const changeAddress = await wallet.getChangeAddress();

    // GroupNFTHolder reference input
    const groupNftHolderUtxos = await provider.fetchAddressUTxOs(deployment.groupNftHolderAddress);
    const groupNftUnit = deployment.groupNftSymbol + deployment.groupNftName;
    const groupNftUtxo = groupNftHolderUtxos.find((u) =>
        u.output.amount.some((a: { unit: string }) => a.unit === groupNftUnit),
    );
    if (!groupNftUtxo) throw new Error('GroupNFTHolder UTxO not found');

    // Build CrossMsgData datum for xport output
    const outboundDatum = genMsgCrossData(
        receiver, amount,
        deployment.outboundHandlerCbor,
        defaultConfig.demoOutbound!.plutusVersion,
    );

    // Scripts
    const outboundDemoScript: PlutusScript = {
        code: deployment.outboundHandlerCbor,
        version: defaultConfig.demoOutbound!.plutusVersion,
    };
    const bridgeTokenScript: PlutusScript = {
        code: deployment.bridgeTokenCbor,
        version: defaultConfig.demoToken!.plutusVersion,
    };
    const outboundTokenScript: PlutusScript = {
        code: deployment.outboundTokenCbor,
        version: defaultConfig.outboundToken!.plutusVersion,
    };

    const outboundTokenPolicy = deployment.outboundTokenPolicy;
    const outboundTokenName = defaultConfig.OUTBOUND_TOKEN_NAME;

    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });

    const { resolvePlutusScriptAddress } = await import('@meshsdk/core');
    const xportScript: PlutusScript = { code: deployment.xportCbor, version: defaultConfig.xport!.plutusVersion };
    const xportAddress = deployment.xportAddress;

    const xportAssets = [
        { unit: outboundTokenPolicy + outboundTokenName, quantity: '1' },
        { unit: 'lovelace', quantity: '5000000' },
    ];

    const outboundRedeemer = mConStr0([
        demoTokenPolicy, demoTokenName,
        bech32AddressToMeshData(xportAddress),
        defaultConfig.EvmContractADDRESS,
    ]);

    const bridgeTokenAsset = taskUtxo.output.amount.find(
        (a: { unit: string }) => a.unit === tokenUnit,
    )!;

    await txBuilder
        // Spend outbound task UTxO
        .spendingPlutusScript(outboundDemoScript.version)
        .txIn(taskUtxo.input.txHash, taskUtxo.input.outputIndex, taskUtxo.output.amount, taskUtxo.output.address)
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(outboundRedeemer, undefined, SPENDING_BUDGET)
        .txInScript(outboundDemoScript.code)
        // Burn bridge tokens
        .mintPlutusScript(bridgeTokenScript.version)
        .mint('-' + BigInt(amount).toString(10), demoTokenPolicy, demoTokenName)
        .mintingScript(bridgeTokenScript.code)
        .mintRedeemerValue(mConStr0([]), undefined, MINTING_BUDGET)
        // Mint outbound token
        .mintPlutusScript(outboundTokenScript.version)
        .mint('1', outboundTokenPolicy, outboundTokenName)
        .mintingScript(outboundTokenScript.code)
        .mintRedeemerValue(mConStr0([]), undefined, MINTING_BUDGET)
        // Send outbound token + datum to xport
        .txOut(xportAddress, xportAssets)
        .txOutInlineDatumValue(outboundDatum)
        // GroupNFTHolder reference input
        .readOnlyTxInReference(groupNftUtxo.input.txHash, groupNftUtxo.input.outputIndex)
        // Collateral
        .txInCollateral(
            collateral.input.txHash,
            collateral.input.outputIndex,
            collateral.output.amount,
            collateral.output.address,
        )
        .changeAddress(changeAddress)
        // Filter out UTxOs with bridge tokens to avoid ValueNotConserved
        .selectUtxosFrom(walletUtxos.filter(
            (u) => !u.output.amount.some((a: { unit: string }) =>
                a.unit === tokenUnit || a.unit.startsWith(outboundTokenPolicy)),
        ))
        .complete();

    const unsignedTx = txBuilder.txHex;
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await submitTx(signedTx);
    return txHash;
}
