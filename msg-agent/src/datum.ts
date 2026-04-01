/**
 * Pure datum serialization/deserialization functions.
 * Extracted from index.ts for testability — no side effects on import.
 */

import { deserializeDatum, serializeAddressObj, mConStr0, deserializeAddress } from '@meshsdk/core';
import { mConStr1, mPubKeyAddress, mScriptAddress } from "@meshsdk/common";

/**
 * Convert a bech32 Cardano address to MeshSDK datum representation.
 */
export function bech32AddressToMeshData(addr: string) {
    const a = deserializeAddress(addr);

    if (a.pubKeyHash) {
        if (a.stakeCredentialHash) return mPubKeyAddress(a.pubKeyHash, a.stakeCredentialHash, false);
        else return mPubKeyAddress(a.pubKeyHash, a.stakeScriptCredentialHash, true);
    } else {
        if (a.stakeCredentialHash) return mScriptAddress(a.scriptHash, a.stakeCredentialHash, false);
        else return mScriptAddress(a.scriptHash, a.stakeScriptCredentialHash, true)
    }
}

/**
 * Construct a Beneficiary datum for on-chain use.
 */
export function genBeneficiaryData(receiver: string, amount: string | bigint | number) {
    const isValidCardanoAddress = (addr: string) => {
        try {
            deserializeAddress(addr);
            return true;
        } catch {
            return false;
        }
    }
    const to = isValidCardanoAddress(receiver) ? mConStr1([bech32AddressToMeshData(receiver)]) : mConStr0([receiver]);
    return mConStr0([to, amount]);
}

/**
 * Deserialize a CBOR-encoded Beneficiary datum from on-chain hex.
 */
export function getBeneficiaryFromCbor(hex: string, network: number) {
    try {
        const datum = deserializeDatum(hex);
        if (!datum?.fields || datum.fields.length < 2) {
            throw new Error('Beneficiary datum must have at least 2 fields');
        }
        const subDatum = datum.fields[0];
        if (!subDatum?.fields || subDatum.fields.length < 1) {
            throw new Error('Beneficiary address field is malformed');
        }
        const receiver = subDatum.constructor == 0n ? subDatum.fields[0].bytes : serializeAddressObj(subDatum.fields[0], network);
        const amount = datum.fields[1].int;
        if (amount === undefined || amount === null) {
            throw new Error('Beneficiary amount field is missing');
        }
        return { receiver, amount };
    } catch (err) {
        throw new Error(`Failed to deserialize Beneficiary datum: ${err}`);
    }
}

/**
 * Deserialize a CBOR-encoded CrossMsgData datum from on-chain hex.
 */
export function getMsgCrossDataFromCbor(hex: string, network: number) {
    try {
        const datum = deserializeDatum(hex);
        if (!datum?.fields || datum.fields.length < 7) {
            throw new Error('CrossMsgData datum must have at least 7 fields');
        }
        const msgId = datum.fields[0].bytes;
        const fromChainId = datum.fields[1].int;
        const fromContract = datum.fields[2].constructor == 0n ? Buffer.from(datum.fields[2].fields[0].bytes, 'hex').toString('ascii') : serializeAddressObj(datum.fields[2].fields[0], network);
        const toChainId = datum.fields[3].int;
        const targetContract = datum.fields[4].constructor == 0n ? Buffer.from(datum.fields[4].fields[0].bytes, 'hex').toString('ascii') : serializeAddressObj(datum.fields[4].fields[0], network);
        const gasLimit = datum.fields[5].int;

        if (!datum.fields[6]?.fields || datum.fields[6].fields.length < 2) {
            throw new Error('FunctionCallData field is malformed');
        }
        const tmpCallData = datum.fields[6].fields[1].bytes;
        const functionCallData = {
            functionName: Buffer.from(datum.fields[6].fields[0].bytes, 'hex').toString('ascii'),
            functionArgs: getBeneficiaryFromCbor(tmpCallData, network)
        }
        return { msgId, fromChainId, fromContract, toChainId, targetContract, gasLimit, functionCallData };
    } catch (err) {
        throw new Error(`Failed to deserialize CrossMsgData datum: ${err}`);
    }
}

/**
 * Simple task pool — FIFO queue with map-based existence check.
 */
export class TaskPool<T extends { id: string }> {
    private taskMap: Map<string, T>;
    private taskQueue: T[];

    constructor() {
        this.taskMap = new Map();
        this.taskQueue = [];
    }

    push(task: T) {
        this.taskMap.set(task.id, task);
        this.taskQueue.push(task);
    }

    isExist(taskId: string) {
        return this.taskMap.has(taskId);
    }

    size() {
        return this.taskQueue.length;
    }

    popTask(): T | undefined {
        return this.taskQueue.shift();
    }

    removeDone(taskId: string) {
        this.taskMap.delete(taskId);
    }
}
