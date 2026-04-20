import { describe, it, expect } from 'vitest';
import { TaskPool, genBeneficiaryData, bech32AddressToMeshData, getBeneficiaryFromCbor } from './datum';
import { serializeData } from '@meshsdk/core';

// ── TaskPool tests ──────────────────────────────────────────────────────────

describe('TaskPool', () => {
    it('starts empty', () => {
        const pool = new TaskPool();
        expect(pool.size()).toBe(0);
        expect(pool.popTask()).toBeUndefined();
    });

    it('push and pop in FIFO order', () => {
        const pool = new TaskPool<{ id: string }>();
        pool.push({ id: 'a' });
        pool.push({ id: 'b' });
        pool.push({ id: 'c' });
        expect(pool.size()).toBe(3);
        expect(pool.popTask()?.id).toBe('a');
        expect(pool.popTask()?.id).toBe('b');
        expect(pool.popTask()?.id).toBe('c');
        expect(pool.popTask()).toBeUndefined();
    });

    it('isExist returns true for pushed tasks', () => {
        const pool = new TaskPool<{ id: string }>();
        pool.push({ id: 'x' });
        expect(pool.isExist('x')).toBe(true);
        expect(pool.isExist('y')).toBe(false);
    });

    it('removeDone removes from map but not queue', () => {
        const pool = new TaskPool<{ id: string }>();
        pool.push({ id: 'x' });
        pool.removeDone('x');
        expect(pool.isExist('x')).toBe(false);
        // task is still in queue (this matches the original behavior)
        expect(pool.size()).toBe(1);
    });

    it('handles duplicate IDs by overwriting in map', () => {
        const pool = new TaskPool<{ id: string; data?: string }>();
        pool.push({ id: 'x', data: 'first' });
        pool.push({ id: 'x', data: 'second' });
        expect(pool.size()).toBe(2); // both in queue
        expect(pool.isExist('x')).toBe(true); // latest in map
    });
});

// ── bech32AddressToMeshData tests ───────────────────────────────────────────

describe('bech32AddressToMeshData', () => {
    const testAddr = 'addr_test1qpm0q3dmc0cq4ea75dum0dgpz4x5jsdf6jk0we04yktpuxnk7pzmhslsptnmagmek76sz92df9q6n49v7ajl2fvkrcdq9semsd';

    it('converts a valid testnet address without throwing', () => {
        const result = bech32AddressToMeshData(testAddr);
        expect(result).toBeDefined();
    });

    it('throws on invalid address', () => {
        expect(() => bech32AddressToMeshData('not_a_real_address')).toThrow();
    });
});

// ── genBeneficiaryData tests ────────────────────────────────────────────────

describe('genBeneficiaryData', () => {
    it('produces a datum for EVM address', () => {
        const result = genBeneficiaryData('0xabcdef1234567890', 100);
        expect(result).toBeDefined();
        // MeshSDK datum is a constr with fields array
        expect(result.fields).toBeDefined();
        expect(result.fields.length).toBe(2);
    });

    it('produces a datum for Cardano address', () => {
        const testAddr = 'addr_test1qpm0q3dmc0cq4ea75dum0dgpz4x5jsdf6jk0we04yktpuxnk7pzmhslsptnmagmek76sz92df9q6n49v7ajl2fvkrcdq9semsd';
        const result = genBeneficiaryData(testAddr, 500);
        expect(result).toBeDefined();
        expect(result.fields).toBeDefined();
        expect(result.fields.length).toBe(2);
    });

    it('accepts bigint amount', () => {
        const result = genBeneficiaryData('0xdeadbeef', 999999999n);
        expect(result).toBeDefined();
    });
});

// ── getBeneficiaryFromCbor roundtrip tests ──────────────────────────────────

describe('getBeneficiaryFromCbor', () => {
    it('roundtrips EVM address beneficiary', () => {
        const evmAddr = '0xabcdef1234567890abcdef1234567890abcdef12';
        const amount = 42;
        const datum = genBeneficiaryData(evmAddr, amount);
        const hex = serializeData(datum);

        const parsed = getBeneficiaryFromCbor(hex, 0);
        // EVM addresses are stored as raw bytes on-chain; receiver is the hex of those bytes
        expect(parsed.receiver).toBeDefined();
        expect(typeof parsed.receiver).toBe('string');
        expect(parsed.amount).toBe(BigInt(amount));
    });

    it('throws on empty hex', () => {
        expect(() => getBeneficiaryFromCbor('', 0)).toThrow('Failed to deserialize');
    });

    it('throws on malformed CBOR', () => {
        expect(() => getBeneficiaryFromCbor('deadbeef', 0)).toThrow('Failed to deserialize');
    });
});
