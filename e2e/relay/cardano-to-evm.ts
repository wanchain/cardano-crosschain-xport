/**
 * Cardano→EVM relay for cross-chain E2E tests.
 *
 * Polls the Cardano xport address for UTxOs with outbound tokens.
 * When found, deserializes the CrossMsgData datum and calls
 * gateway.receiveMessageNonEvm() on the EVM side with a mock MPC signature.
 *
 * This simulates what the Wanchain Storeman Group relay does in production.
 */

import { ethers } from 'ethers';
import { deserializeDatum } from '@meshsdk/core';
import { YACI_STORE_URL, CARDANO_CHAIN_ID, INBOUND_GAS_LIMIT } from '../helpers/config';

interface RelayConfig {
    gateway: ethers.Contract;
    xportAddress: string;
    outboundTokenPolicy: string;
    outboundHandlerAddress: string;   // sourceContract for the EVM gateway
    targetContract: string;           // TokenHome address on EVM
}

interface CardanoUtxo {
    tx_hash: string;
    output_index: number;
    amount: Array<{ unit: string; quantity: string }>;
    inline_datum?: string;
}

/**
 * One-shot: scan xport for outbound token UTxOs and relay them to EVM.
 * Returns the number of messages relayed.
 */
export async function relayCardanoToEvm(config: RelayConfig): Promise<number> {
    const {
        gateway, xportAddress, outboundTokenPolicy,
        outboundHandlerAddress, targetContract,
    } = config;

    // Fetch UTxOs at xport address
    const res = await fetch(`${YACI_STORE_URL}/addresses/${xportAddress}/utxos`);
    if (!res.ok) return 0;

    const utxos: CardanoUtxo[] = await res.json();

    // Filter for UTxOs with outbound tokens
    const outboundUtxos = utxos.filter((u) =>
        u.amount.some((a) => a.unit.startsWith(outboundTokenPolicy) && BigInt(a.quantity) >= 1n),
    );

    let relayed = 0;
    for (const utxo of outboundUtxos) {
        if (!utxo.inline_datum) continue;

        // The inline datum is CrossMsgData (7 fields). TokenHome.parseToMsg() expects
        // the Beneficiary CBOR (2 fields) which is inside functionCallData.functionArgs.
        // Extract it: CrossMsgData = Constr0([..., functionCallData]) where
        // functionCallData = Constr0([functionName, functionArgs]).
        // functionArgs is the serialized Beneficiary CBOR hex string.
        let messageData: string;
        try {
            const datum = deserializeDatum<{
                constructor: number;
                fields: Array<{ bytes?: string; int?: number; constructor?: number; fields?: any[] }>;
            }>(utxo.inline_datum);
            // CrossMsgData fields: [taskId, fromChainId, fromAddress, toChainId, toAddress, gasLimit, functionCallData]
            const functionCallData = datum.fields[6];
            // functionCallData = Constr0([functionName, functionArgs])
            const functionArgs = functionCallData.fields![1];
            // functionArgs is a hex string of the serialized Beneficiary CBOR
            messageData = '0x' + (functionArgs.bytes ?? functionArgs);
        } catch (parseErr: any) {
            console.error(`[relay:C→E] Failed to parse CrossMsgData: ${parseErr.message}`);
            continue;
        }
        const messageId = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(`relay-${utxo.tx_hash}-${utxo.output_index}`),
        );
        const sourceContract = ethers.utils.toUtf8Bytes(outboundHandlerAddress);

        // Mock MPC signature (MockWanchainMPC always returns true)
        const smgID = ethers.utils.formatBytes32String('test-relay');
        const r = '0x' + '00'.repeat(64);
        const s = ethers.utils.formatBytes32String('relay-sig');

        try {
            const tx = await gateway.receiveMessageNonEvm(
                messageId,
                CARDANO_CHAIN_ID,
                sourceContract,
                targetContract,
                messageData,
                INBOUND_GAS_LIMIT,
                smgID,
                r,
                s,
            );
            await tx.wait();
            console.log(`[relay:C→E] Relayed ${utxo.tx_hash}:${utxo.output_index} → EVM tx ${tx.hash}`);
            relayed++;
        } catch (err: any) {
            console.error(`[relay:C→E] Failed to relay ${utxo.tx_hash}:${utxo.output_index}: ${err.message}`);
        }
    }

    return relayed;
}
