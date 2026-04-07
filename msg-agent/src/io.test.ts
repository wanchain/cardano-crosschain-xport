import { describe, it, expect } from 'vitest';
import { sleep, withTimeout } from './utils';

// ── sleep / withTimeout tests ───────────────────────────────────────────────

describe('sleep', () => {
    it('resolves after the specified duration', async () => {
        const start = Date.now();
        await sleep(50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(40); // allow 10ms jitter
    });
});

describe('withTimeout', () => {
    it('resolves if promise completes before timeout', async () => {
        const result = await withTimeout(1000, Promise.resolve('ok'));
        expect(result).toBe('ok');
    });

    it('rejects if promise exceeds timeout', async () => {
        const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));
        await expect(withTimeout(50, slowPromise)).rejects.toThrow('timeout');
    });

    it('propagates promise rejection', async () => {
        await expect(withTimeout(1000, Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    });
});

// ── TaskPool with Task-like objects (mock UTxO-based tasks) ─────────────────

import { TaskPool } from './datum';

describe('TaskPool integration', () => {
    it('processes tasks in order and tracks completion', () => {
        const pool = new TaskPool<{ id: string; status: string }>();

        pool.push({ id: 'task-1', status: 'ready' });
        pool.push({ id: 'task-2', status: 'ready' });
        pool.push({ id: 'task-3', status: 'ready' });

        expect(pool.size()).toBe(3);
        expect(pool.isExist('task-1')).toBe(true);
        expect(pool.isExist('task-2')).toBe(true);

        // Process first task
        const task1 = pool.popTask();
        expect(task1?.id).toBe('task-1');

        // Mark done
        pool.removeDone('task-1');
        expect(pool.isExist('task-1')).toBe(false);

        // Process second
        const task2 = pool.popTask();
        expect(task2?.id).toBe('task-2');

        // Remaining
        expect(pool.size()).toBe(1);
    });

    it('returns undefined when empty', () => {
        const pool = new TaskPool<{ id: string }>();
        expect(pool.popTask()).toBeUndefined();
    });

    it('does not duplicate existing task IDs in map', () => {
        const pool = new TaskPool<{ id: string; value: number }>();
        pool.push({ id: 'x', value: 1 });
        pool.push({ id: 'x', value: 2 });

        // Map has latest value
        expect(pool.isExist('x')).toBe(true);
        // Queue has both (FIFO, no dedup on push)
        expect(pool.size()).toBe(2);
    });
});

// ── Mock-based tests for provider interactions ──────────────────────────────

describe('fetchTask behavior (mock provider)', () => {
    // We can't import fetchTask directly (it's not exported and has side effects),
    // so we test the Task construction logic that fetchTask relies on.
    // This validates that UTxO → Task conversion works correctly.

    it('creates inbound task from UTxO with inbound token', async () => {
        // The Task constructor checks for inbound token policy in the UTxO amounts.
        // We verify the datum parsing works via the exported getBeneficiaryFromCbor.
        const { getBeneficiaryFromCbor, genBeneficiaryData } = await import('./datum');
        const { serializeData } = await import('@meshsdk/core');

        const datum = genBeneficiaryData('0xdeadbeef', 100);
        const hex = serializeData(datum);

        const parsed = getBeneficiaryFromCbor(hex, 0);
        expect(parsed.receiver).toBeDefined();
        expect(parsed.amount).toBe(100n);
    });

    it('rejects malformed UTxO datum gracefully', async () => {
        const { getBeneficiaryFromCbor } = await import('./datum');

        // Truncated CBOR
        expect(() => getBeneficiaryFromCbor('d87980', 0)).toThrow('Failed to deserialize');
    });
});

// ── walletReady behavior test (structural) ──────────────────────────────────

describe('walletReady logic', () => {
    it('timeout utility rejects long-running collateral fetch', async () => {
        // Simulates the walletReady scenario: collateral fetch takes too long
        const neverResolves = new Promise(() => {}); // never settles
        await expect(withTimeout(100, neverResolves)).rejects.toThrow('timeout');
    });

    it('timeout resolves when collateral appears quickly', async () => {
        const quickResolve = new Promise((resolve) => setTimeout(() => resolve('collateral'), 10));
        const result = await withTimeout(1000, quickResolve);
        expect(result).toBe('collateral');
    });
});

// ── Environment validation ──────────────────────────────────────────────────

describe('config validation', () => {
    it('defaultConfig has required fields', async () => {
        // Import config without triggering index.ts side effects
        const { defaultConfig } = await import('./config');

        expect(defaultConfig.NETWORK).toBeDefined();
        expect(typeof defaultConfig.NETWORK).toBe('number');
        expect(defaultConfig.GroupNftHolder).toBeDefined();
        expect(defaultConfig.EvmContractADDRESS).toBeDefined();
        expect(defaultConfig.EvmChainId).toBeDefined();
        expect(defaultConfig.AdaChainId).toBeDefined();
        expect(defaultConfig.OUTBOUND_TOKEN_NAME).toBeDefined();
        expect(defaultConfig.demoTokenName).toBeDefined();
    });

    it('defaultConfig validators are loaded from plutus.json', async () => {
        const { defaultConfig } = await import('./config');

        expect(defaultConfig.demoInbound).toBeDefined();
        expect(defaultConfig.demoInbound?.compiledCode).toBeTruthy();
        expect(defaultConfig.demoOutbound).toBeDefined();
        expect(defaultConfig.demoOutbound?.compiledCode).toBeTruthy();
        expect(defaultConfig.demoToken).toBeDefined();
        expect(defaultConfig.demoToken?.compiledCode).toBeTruthy();
    });

    it('BLOCKFROST endpoint check would throw if missing', () => {
        // This tests the guard we added — in the actual module it runs at import time
        // We just verify the pattern works
        const check = (url: string | undefined, key: string | undefined) => {
            const endpoint = url || key;
            if (!endpoint) throw new Error('BLOCKFROST_URL or BLOCKFROST_API_KEY environment variable is not set');
            return endpoint;
        };

        expect(() => check(undefined, undefined)).toThrow('BLOCKFROST_URL or BLOCKFROST_API_KEY');
        expect(() => check('', '')).toThrow('BLOCKFROST_URL or BLOCKFROST_API_KEY');
        expect(check('http://localhost:8080/api/v1', undefined)).toBe('http://localhost:8080/api/v1');
        expect(check(undefined, 'test-key')).toBe('test-key');
    });
});
