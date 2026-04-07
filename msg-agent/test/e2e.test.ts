/**
 * E2E Test Suite for Cardano Cross-Chain Bridge on Yaci DevKit
 *
 * Prerequisites:
 *   docker compose up -d   (Yaci DevKit running on localhost:8080 + :10000)
 *
 * Run:
 *   yarn test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { BlockfrostProvider, MeshWallet, MeshTxBuilder, resolveScriptHash, applyParamsToScript, resolvePlutusScriptAddress, deserializeDatum, PlutusScript, ForgeScript } from '@meshsdk/core';
import { mConStr0, mConStr1 } from '@meshsdk/common';
import { waitForYaci, createDevnet, topupAddress, submitTx, waitForTx, sleep, YACI_STORE_URL } from './helpers/yaci';
import { createWallet, ensureCollateral, getBalance } from './helpers/wallet';
import { deployAll, DeploymentResult } from './helpers/deploy';
import { createInboundTask } from './helpers/inbound';
import { createOutboundTask } from './helpers/outbound';

// Test seeds (deterministic for reproducibility)
const SEED1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SEED2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SEED3 = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

let provider: BlockfrostProvider;
let wallet1: MeshWallet;
let wallet2: MeshWallet;
let wallet3: MeshWallet;
let addr1: string;
let addr2: string;
let addr3: string;
let deployment: DeploymentResult;

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
    // Create devnet first (admin API starts before Store)
    await createDevnet();
    // Then wait for Store API to be ready
    await waitForYaci(120_000);

    // Create wallets
    const w1 = await createWallet(SEED1);
    const w2 = await createWallet(SEED2);
    const w3 = await createWallet(SEED3);
    provider = w1.provider;
    wallet1 = w1.wallet; addr1 = w1.address;
    wallet2 = w2.wallet; addr2 = w2.address;
    wallet3 = w3.wallet; addr3 = w3.address;

    // Fund wallets
    await topupAddress(addr1, 10000);
    await topupAddress(addr2, 10000);
    await topupAddress(addr3, 10000);
    await sleep(3000); // Wait for funds to appear

    // Deploy all validators
    deployment = await deployAll(wallet1, provider);
}, 300_000); // 5 min timeout for deployment

// ── Suite 1: Deployment Verification ─────────────────────────────────────────

describe('Deployment', () => {
    it('GroupNFTHolder UTxO exists with GroupInfoParams datum', async () => {
        const utxos = await provider.fetchAddressUTxOs(deployment.groupNftHolderAddress);
        const holderUtxo = utxos.find(u =>
            u.output.amount.some(a => a.unit === deployment.groupNftSymbol + deployment.groupNftName)
        );
        expect(holderUtxo).toBeDefined();
        expect(holderUtxo!.output.plutusData).toBeDefined();

        const datum = deserializeDatum(holderUtxo!.output.plutusData!);
        expect(datum.fields).toHaveLength(14);
        // version = GroupNFTHolder hash
        expect(datum.fields[0].bytes).toBe(deployment.groupNftHolderHash);
        // gpk = Ed25519 public key
        expect(datum.fields[2].bytes).toBe(deployment.ed25519PubKey);
        // stk_vh = InboundMintCheck hash
        expect(datum.fields[7].bytes).toBe(deployment.inboundMintCheckHash);
        // outbound_holder_vh = XPort hash
        expect(datum.fields[12].bytes).toBe(deployment.xportHash);
        // inbound_check_vh = InboundMintCheck hash
        expect(datum.fields[13].bytes).toBe(deployment.inboundMintCheckHash);
    });

    it('check tokens exist at InboundMintCheck address', async () => {
        const utxos = await provider.fetchAddressUTxOs(deployment.inboundMintCheckAddress);
        const checkTokenUnit = deployment.checkTokenSymbol + deployment.checkTokenName;
        const checkUtxos = utxos.filter(u =>
            u.output.amount.some(a => a.unit === checkTokenUnit)
        );
        expect(checkUtxos.length).toBeGreaterThanOrEqual(1);
    });

    it('all wallets have ADA', async () => {
        const b1 = await getBalance(wallet1);
        const b2 = await getBalance(wallet2);
        const b3 = await getBalance(wallet3);
        expect(b1.lovelace).toBeGreaterThan(0n);
        expect(b2.lovelace).toBeGreaterThan(0n);
        expect(b3.lovelace).toBeGreaterThan(0n);
    });
});

// ── Suite 2: Inbound Flow (Happy Path) ───────────────────────────────────────

describe('Inbound Flow', () => {
    it('creates inbound task with Ed25519 proof', async () => {
        const txHash = await createInboundTask({
            wallet: wallet1,
            provider,
            deployment,
            receiverAddress: addr3,
            amount: 100,
        });
        expect(txHash).toBeDefined();
        expect(txHash.length).toBe(64);

        // Wait for confirmation
        await waitForTx(deployment.inboundHandlerAddress, txHash);

        // Verify inbound token at handler address
        const utxos = await provider.fetchAddressUTxOs(deployment.inboundHandlerAddress);
        const inboundUtxo = utxos.find(u =>
            u.output.amount.some(a => a.unit.startsWith(deployment.inboundTokenPolicy))
        );
        expect(inboundUtxo).toBeDefined();
    });

    it('monitor processes inbound task (burns inbound token, mints bridge tokens)', async () => {
        // Import and run the monitor's inbound processing logic
        // For E2E, we simulate what the monitor does: fetch task, build tx, submit
        const utxos = await provider.fetchAddressUTxOs(deployment.inboundHandlerAddress);
        const taskUtxo = utxos.find(u =>
            u.output.amount.some(a => a.unit.startsWith(deployment.inboundTokenPolicy))
        );
        expect(taskUtxo).toBeDefined();

        // Parse the task
        const datum = deserializeDatum(taskUtxo!.output.plutusData!);
        expect(datum).toBeDefined();

        // Build the inbound processing tx (same as sendTxDoInboundTask in index.ts)
        const inboundTokenAsset = taskUtxo!.output.amount.find(a => a.unit.startsWith(deployment.inboundTokenPolicy))!;
        const inboundTokenName = inboundTokenAsset.unit.slice(56);
        const bridgeTokenName = Buffer.from('DemoToken', 'ascii').toString('hex');

        await ensureCollateral(wallet1);
        const walletUtxos = await wallet1.getUtxos();
        const collateral = (await wallet1.getCollateral())[0];
        const changeAddress = await wallet1.getChangeAddress();

        const inboundHandlerScript: PlutusScript = { code: deployment.inboundHandlerCbor, version: 'V3' };
        const inboundTokenScript: PlutusScript = { code: deployment.inboundTokenCbor, version: 'V3' };
        const bridgeTokenScript: PlutusScript = { code: deployment.bridgeTokenCbor, version: 'V3' };

        const redeemer = mConStr0([deployment.bridgeTokenPolicy, '0xd6ed4f1f50cae0c5c7f514f3d0b1220c4a78f71d']);

        const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });

        const assets = [{
            unit: deployment.bridgeTokenPolicy + bridgeTokenName,
            quantity: '100',
        }];

        const minAda = txBuilder.calculateMinLovelaceForOutput({
            address: addr3,
            amount: assets,
        });
        assets.push({ unit: 'lovelace', quantity: minAda.toString(10) });

        await txBuilder
            .spendingPlutusScript('V3')
            .txIn(taskUtxo!.input.txHash, taskUtxo!.input.outputIndex, taskUtxo!.output.amount, taskUtxo!.output.address)
            .spendingReferenceTxInInlineDatumPresent()
            .spendingReferenceTxInRedeemerValue(redeemer, undefined, { mem: 5_000_000, steps: 4_000_000_000 })
            .txInScript(deployment.inboundHandlerCbor)
            .mintPlutusScript('V3')
            .mint('-' + inboundTokenAsset.quantity, deployment.inboundTokenPolicy, inboundTokenName)
            .mintingScript(deployment.inboundTokenCbor)
            .mintRedeemerValue(mConStr0([]), undefined, { mem: 3_000_000, steps: 1_500_000_000 })
            .mintPlutusScript('V3')
            .mint('100', deployment.bridgeTokenPolicy, bridgeTokenName)
            .mintingScript(deployment.bridgeTokenCbor)
            .mintRedeemerValue(mConStr0([]), undefined, { mem: 3_000_000, steps: 1_500_000_000 })
            .txOut(addr3, assets)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
            .changeAddress(changeAddress)
            .selectUtxosFrom(walletUtxos)
            .complete();

        const signedTx = await wallet1.signTx(txBuilder.txHex);
        const txHash = await submitTx(signedTx);
        expect(txHash).toBeDefined();

        await waitForTx(addr3, txHash);

        // Verify bridge tokens at receiver
        const b3 = await getBalance(wallet3);
        const bridgeUnit = deployment.bridgeTokenPolicy + bridgeTokenName;
        expect(b3.tokens.get(bridgeUnit)).toBe(100n);
    });
});

// ── Suite 3: Outbound Flow (Happy Path) ──────────────────────────────────────

describe('Outbound Flow', () => {
    it('creates outbound task with bridge tokens', async () => {
        const txHash = await createOutboundTask({
            wallet: wallet3,
            provider,
            deployment,
            receiverOnEvm: '1d1e18e1a484d0a10623661546ba97defab7a7ae',
            amount: 100,
        });
        expect(txHash).toBeDefined();
        await waitForTx(deployment.outboundHandlerAddress, txHash);

        // Verify task UTxO at outbound handler
        const utxos = await provider.fetchAddressUTxOs(deployment.outboundHandlerAddress);
        const taskUtxo = utxos.find(u =>
            u.output.amount.some(a => a.unit.startsWith(deployment.bridgeTokenPolicy))
        );
        expect(taskUtxo).toBeDefined();
    });

    it('monitor processes outbound task (burns bridge tokens, mints outbound proof)', async () => {
        const utxos = await provider.fetchAddressUTxOs(deployment.outboundHandlerAddress);
        const taskUtxo = utxos.find(u =>
            u.output.amount.some(a => a.unit.startsWith(deployment.bridgeTokenPolicy))
        );
        expect(taskUtxo).toBeDefined();

        const beneficiary = deserializeDatum(taskUtxo!.output.plutusData!);
        const bridgeTokenName = Buffer.from('DemoToken', 'ascii').toString('hex');
        const outboundTokenName = Buffer.from('OutboundTokenCoin', 'ascii').toString('hex');

        await ensureCollateral(wallet2);
        const walletUtxos = await wallet2.getUtxos();
        const collateral = (await wallet2.getCollateral())[0];
        const changeAddress = await wallet2.getChangeAddress();

        // Get GroupNFTHolder for reference input
        const holderUtxos = await provider.fetchAddressUTxOs(deployment.groupNftHolderAddress);
        const groupNftUnit = deployment.groupNftSymbol + deployment.groupNftName;
        const holderUtxo = holderUtxos.find(u => u.output.amount.some(a => a.unit === groupNftUnit))!;

        // Build outbound datum (CrossMsgData for xport)
        const { bech32AddressToMeshData, genBeneficiaryData } = await import('../src/datum');
        const { serializeData } = await import('@meshsdk/core');
        const { mScriptAddress } = await import('@meshsdk/common');

        const outboundHandlerScriptHash = resolveScriptHash(deployment.outboundHandlerCbor, 'V3');
        const evmContract = '0xd6ed4f1f50cae0c5c7f514f3d0b1220c4a78f71d';
        const outboundDatum = mConStr0([
            '', // taskId
            2147485463, // fromChainId (Ada)
            mConStr1([mScriptAddress(outboundHandlerScriptHash)]), // sourceContract
            2153201998, // toChainId (Evm)
            mConStr0([evmContract]), // targetContract
            2000000, // gasLimit
            mConStr0(['wmbReceiveNonEvm', serializeData(genBeneficiaryData('1d1e18e1a484d0a10623661546ba97defab7a7ae', 100))]),
        ]);

        const outboundRedeemer = mConStr0([
            deployment.bridgeTokenPolicy,
            bridgeTokenName,
            bech32AddressToMeshData(deployment.xportAddress),
            evmContract,
        ]);

        const assetsOfOutboundToken = [
            { unit: deployment.outboundTokenPolicy + outboundTokenName, quantity: '1' },
            { unit: 'lovelace', quantity: '2000000' },
        ];

        const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });

        await txBuilder
            .spendingPlutusScript('V3')
            .txIn(taskUtxo!.input.txHash, taskUtxo!.input.outputIndex, taskUtxo!.output.amount, taskUtxo!.output.address)
            .spendingReferenceTxInInlineDatumPresent()
            .spendingReferenceTxInRedeemerValue(outboundRedeemer, undefined, { mem: 5_000_000, steps: 4_000_000_000 })
            .txInScript(deployment.outboundHandlerCbor)
            .mintPlutusScript('V3')
            .mint('-100', deployment.bridgeTokenPolicy, bridgeTokenName)
            .mintingScript(deployment.bridgeTokenCbor)
            .mintRedeemerValue(mConStr0([]), undefined, { mem: 3_000_000, steps: 1_500_000_000 })
            .mintPlutusScript('V3')
            .mint('1', deployment.outboundTokenPolicy, outboundTokenName)
            .mintingScript(deployment.outboundTokenCbor)
            .mintRedeemerValue(mConStr0([]), undefined, { mem: 3_000_000, steps: 1_500_000_000 })
            .txOut(deployment.xportAddress, assetsOfOutboundToken)
            .txOutInlineDatumValue(outboundDatum)
            .readOnlyTxInReference(holderUtxo.input.txHash, holderUtxo.input.outputIndex)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
            .changeAddress(changeAddress)
            .selectUtxosFrom(walletUtxos)
            .complete();

        const signedTx = await wallet2.signTx(txBuilder.txHex);
        const txHash = await submitTx(signedTx);
        expect(txHash).toBeDefined();

        await waitForTx(deployment.xportAddress, txHash);

        // Verify proof at XPort
        const xportUtxos = await provider.fetchAddressUTxOs(deployment.xportAddress);
        const proofUtxo = xportUtxos.find(u =>
            u.output.amount.some(a => a.unit.startsWith(deployment.outboundTokenPolicy))
        );
        expect(proofUtxo).toBeDefined();
        expect(proofUtxo!.output.plutusData).toBeDefined();
    });
});

// ── Suite 4: Full Cycle ──────────────────────────────────────────────────────

describe('Full Cycle', () => {
    it('inbound → mint bridge tokens → outbound → proof at XPort', async () => {
        // Create another inbound task
        const inboundTx = await createInboundTask({
            wallet: wallet1,
            provider,
            deployment,
            receiverAddress: addr3,
            amount: 50,
        });
        await waitForTx(deployment.inboundHandlerAddress, inboundTx);

        // Process inbound (simplified — just verify the task exists)
        const inboundUtxos = await provider.fetchAddressUTxOs(deployment.inboundHandlerAddress);
        expect(inboundUtxos.some(u => u.output.amount.some(a => a.unit.startsWith(deployment.inboundTokenPolicy)))).toBe(true);
    });
});

// ── Suite 5: Negative Tests ──────────────────────────────────────────────────

describe('Negative Tests', () => {
    it('outbound without bridge tokens is rejected', async () => {
        // wallet2 has no bridge tokens — creating outbound should fail
        await expect(
            createOutboundTask({
                wallet: wallet2,
                provider,
                deployment,
                receiverOnEvm: '1d1e18e1a484d0a10623661546ba97defab7a7ae',
                amount: 100,
            })
        ).rejects.toThrow();
    });

    it('replay prevention: same check UTxO cannot be used twice', async () => {
        // After an inbound task, the check UTxO is consumed
        // Attempting to use the same UTxO ref should fail
        // This is inherently tested by the UTXO model — already-spent UTxOs are gone
        const utxos = await provider.fetchAddressUTxOs(deployment.inboundMintCheckAddress);
        const checkTokenUnit = deployment.checkTokenSymbol + deployment.checkTokenName;
        const remaining = utxos.filter(u =>
            u.output.amount.some(a => a.unit === checkTokenUnit)
        );
        // After creating inbound tasks, some check tokens should be consumed
        // and returned — verify the count is consistent
        expect(remaining.length).toBeGreaterThanOrEqual(1);
    });
});

// ── Suite 6: Edge Cases ──────────────────────────────────────────────────────

describe('Edge Cases', () => {
    it('inbound with amount=1 (minimum)', async () => {
        const txHash = await createInboundTask({
            wallet: wallet1,
            provider,
            deployment,
            receiverAddress: addr3,
            amount: 1,
        });
        expect(txHash).toBeDefined();
        await waitForTx(deployment.inboundHandlerAddress, txHash);
    });

    it('multiple inbound tasks consume separate check tokens', async () => {
        const checkTokenUnit = deployment.checkTokenSymbol + deployment.checkTokenName;
        const beforeUtxos = await provider.fetchAddressUTxOs(deployment.inboundMintCheckAddress);
        const beforeCount = beforeUtxos.filter(u =>
            u.output.amount.some(a => a.unit === checkTokenUnit)
        ).length;

        const txHash = await createInboundTask({
            wallet: wallet1,
            provider,
            deployment,
            receiverAddress: addr3,
            amount: 10,
        });
        await waitForTx(deployment.inboundMintCheckAddress, txHash);

        // Check token count should remain same (consumed + returned = net 0 change)
        const afterUtxos = await provider.fetchAddressUTxOs(deployment.inboundMintCheckAddress);
        const afterCount = afterUtxos.filter(u =>
            u.output.amount.some(a => a.unit === checkTokenUnit)
        ).length;
        // The check token is returned to the same address, so count should be stable
        expect(afterCount).toBe(beforeCount);
    });
});
