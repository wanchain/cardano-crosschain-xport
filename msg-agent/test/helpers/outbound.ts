/**
 * Outbound task creation for E2E testing on Yaci DevKit.
 *
 * Sends bridge tokens + Beneficiary datum to the outbound handler address.
 *
 * Reference: scripts/test-local.ts (createOutboundTask function)
 */

import {
    BlockfrostProvider, MeshWallet, Transaction,
} from '@meshsdk/core';
import { genBeneficiaryData } from '../../src/datum';
import { submitTx } from './yaci';
import type { DeploymentResult } from './deploy';

/**
 * Create an outbound task by sending bridge tokens with a Beneficiary datum
 * to the outbound handler address.
 *
 * @returns The transaction hash
 */
export async function createOutboundTask(params: {
    wallet: MeshWallet;
    provider: BlockfrostProvider;
    deployment: DeploymentResult;
    receiverOnEvm: string; // hex EVM address without 0x prefix
    amount: number;
}): Promise<string> {
    const { wallet, provider, deployment, receiverOnEvm, amount } = params;

    const {
        bridgeTokenPolicy,
        bridgeTokenName,
        outboundHandlerAddress,
    } = deployment;

    // Verify user has enough bridge tokens
    const balance = await wallet.getBalance();
    const tokenUnit = bridgeTokenPolicy + bridgeTokenName;
    const tokenBalance = balance.find((b: { unit: string }) => b.unit === tokenUnit);
    if (!tokenBalance || BigInt(tokenBalance.quantity) < BigInt(amount)) {
        throw new Error(
            `Insufficient bridge tokens: have ${tokenBalance?.quantity ?? '0'}, need ${amount}. ` +
            `Run an inbound task first to mint bridge tokens.`,
        );
    }

    // Build Beneficiary datum: ConStr0([ ConStr0([evmAddr]), amount ])
    // receiverOnEvm is a raw hex EVM address (no 0x prefix)
    const datum = genBeneficiaryData(receiverOnEvm, amount);

    const assets = [
        { unit: tokenUnit, quantity: BigInt(amount).toString(10) },
    ];

    const tx = new Transaction({ fetcher: provider, submitter: provider, initiator: wallet })
        .sendAssets(
            {
                address: outboundHandlerAddress,
                datum: { value: datum, inline: true },
            },
            assets,
        );

    const unsignedTx = await tx.build();
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await submitTx(signedTx);
    return txHash;
}
