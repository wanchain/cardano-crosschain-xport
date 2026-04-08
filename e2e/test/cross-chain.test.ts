/**
 * Cross-Chain E2E Tests: Hardhat (EVM) + Yaci DevKit (Cardano)
 *
 * Prerequisites:
 *   docker compose up -d                    (Yaci DevKit on :8080 + :10000)
 *   cd evm-contracts && npx hardhat node    (Hardhat node on :8545)
 *   cd e2e && yarn install
 *
 * Run:
 *   cd e2e && yarn test
 *
 * Each test uses fresh Cardano wallets to avoid UTxO fragmentation issues.
 * Only the deployer wallet (SEED1) is shared — it deploys validators once.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ethers } from 'ethers';
import { BlockfrostProvider, MeshWallet } from '@meshsdk/core';
import * as crypto from 'crypto';

import { CARDANO_CHAIN_ID, CARDANO_SEED1 } from '../helpers/config';
import { deployEvmContracts, configureTokenHomeRemotes, type EvmDeployment } from '../helpers/evm-deploy';
import {
    waitForYaci, createDevnet, topupAddress, waitForFunds, sleep, YACI_STORE_URL,
    createWallet, ensureCollateral, getBalance,
    deployAll, type DeploymentResult,
    createInboundTask,
    createOutboundTask,
} from '../helpers/cardano-deploy';
import { relayCardanoToEvm } from '../relay/cardano-to-evm';
import { extractDispatchedMessages } from '../relay/evm-to-cardano';
import { processInboundTask, processOutboundTask } from '../helpers/cardano-process';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a fresh funded Cardano wallet with a random seed. */
async function freshWallet(provider: BlockfrostProvider, adaAmount = 10_000) {
    const seed = crypto.randomBytes(32).toString('hex');
    const w = await createWallet(seed);
    await topupAddress(w.address, adaAmount);
    await waitForFunds(w.address, adaAmount * 500_000); // Wait for ~half the topup amount in lovelace
    await ensureCollateral(w.wallet);
    return w;
}

// ── Shared State (deploy once, reuse across tests) ──────────────────────────

let evm: EvmDeployment;
let cardano: DeploymentResult;
let cardanoProvider: BlockfrostProvider;

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
    // 1. Cardano: start devnet and deploy validators
    console.log('[cross-chain] Setting up Cardano...');
    await createDevnet();
    await waitForYaci(120_000);

    const deployer = await createWallet(CARDANO_SEED1);
    cardanoProvider = deployer.provider;

    await topupAddress(deployer.address, 10_000);
    await waitForFunds(deployer.address, 5_000_000_000); // Wait for at least 5k ADA
    await ensureCollateral(deployer.wallet);

    console.log('[cross-chain] Deploying Cardano validators...');
    cardano = await deployAll(deployer.wallet, deployer.provider);

    // 2. EVM: deploy contracts
    console.log('[cross-chain] Deploying EVM contracts...');
    evm = await deployEvmContracts();

    // 3. Configure TokenHome with actual Cardano addresses
    await configureTokenHomeRemotes(
        evm.tokenHome,
        cardano.inboundHandlerAddress,
        cardano.outboundHandlerAddress,
    );

    console.log('[cross-chain] Setup complete');
}, 300_000);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Cross-Chain E2E', () => {

    // ── EVM → Cardano ────────────────────────────────────────────────────

    describe('EVM → Cardano', () => {
        it('user sends XTokens on EVM, bridge tokens arrive on Cardano', async () => {
            const amount = 10000;

            // Fresh wallets for this test
            const worker = await freshWallet(cardanoProvider);
            const receiver = await freshWallet(cardanoProvider, 1_000);

            // 1. Build CBOR for Cardano receiver
            const PlutusUtil = require('../../evm-contracts/utils/plutusDataTool.js');
            const pu = new PlutusUtil();
            const plutusData: string = pu.genBeneficiaryData(receiver.address, amount);

            // 2. User sends tokens on EVM
            const tokenHomeUser = evm.tokenHome.connect(evm.user);
            const tx = await tokenHomeUser.send(plutusData);
            const receipt = await tx.wait();

            // 3. Verify EVM event emitted
            const messages = extractDispatchedMessages(evm.gateway, receipt);
            expect(messages.length).toBe(1);
            expect(messages[0].toChainId).toBe(CARDANO_CHAIN_ID);

            // 4. Verify tokens locked in TokenHome
            const homeBalance = await evm.xToken.balanceOf(evm.tokenHome.address);
            expect(homeBalance.gte(amount)).toBe(true);

            // 5. Create inbound proof on Cardano (simulates Storeman relay)
            const inboundTxHash = await createInboundTask({
                wallet: worker.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                receiverAddress: receiver.address,
                amount,
            });
            expect(inboundTxHash).toBeDefined();
            await sleep(3000);

            // 6. Process inbound task (simulates msg-agent monitor)
            const processTxHash = await processInboundTask({
                wallet: worker.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                inboundHandlerAddress: cardano.inboundHandlerAddress,
            });
            expect(processTxHash).not.toBeNull();
            await sleep(3000);

            // 7. Verify bridge tokens arrived at Cardano receiver
            const bal = await getBalance(receiver.wallet);
            const bridgeTokenUnit = cardano.bridgeTokenPolicy + cardano.bridgeTokenName;
            const bridgeTokenBal = bal.tokens.get(bridgeTokenUnit) ?? 0n;
            expect(bridgeTokenBal).toBeGreaterThanOrEqual(BigInt(amount));
            console.log(`[cross-chain] EVM→Cardano complete: ${bridgeTokenBal} bridge tokens at receiver`);
        });

        it('send() event contains correct target chain and gas limit', async () => {
            const receiver = await freshWallet(cardanoProvider, 1_000);

            const PlutusUtil = require('../../evm-contracts/utils/plutusDataTool.js');
            const pu = new PlutusUtil();
            const plutusData: string = pu.genBeneficiaryData(receiver.address, 5000);

            const tx = await evm.tokenHome.connect(evm.user).send(plutusData);
            const receipt = await tx.wait();

            const messages = extractDispatchedMessages(evm.gateway, receipt);
            expect(messages.length).toBe(1);
            expect(messages[0].toChainId).toBe(CARDANO_CHAIN_ID);
            expect(messages[0].gasLimit).toBe(300_000);
        });
    });

    // ── Cardano → EVM ────────────────────────────────────────────────────

    describe('Cardano → EVM', () => {
        it('user sends bridge tokens on Cardano, XTokens released on EVM', async () => {
            const amount = 5000;
            const evmReceiverAddr = evm.user.address;

            // Fresh wallets
            const worker = await freshWallet(cardanoProvider);
            const user = await freshWallet(cardanoProvider);

            // 1. First create + process inbound to get bridge tokens
            const inboundTxHash = await createInboundTask({
                wallet: worker.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                receiverAddress: user.address,
                amount,
            });
            await sleep(3000);

            const processTx = await processInboundTask({
                wallet: worker.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                inboundHandlerAddress: cardano.inboundHandlerAddress,
            });
            expect(processTx).not.toBeNull();
            await sleep(3000);

            // 2. Create outbound task (send bridge tokens back to EVM)
            const outboundTxHash = await createOutboundTask({
                wallet: user.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                receiverOnEvm: evmReceiverAddr.replace('0x', ''),
                amount,
            });
            expect(outboundTxHash).toBeDefined();
            await sleep(3000);

            // 3. Process outbound task
            const processOutTx = await processOutboundTask({
                wallet: user.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                outboundHandlerAddress: cardano.outboundHandlerAddress,
            });
            expect(processOutTx).not.toBeNull();
            await sleep(3000);

            // 4. Relay xport → EVM
            const relayed = await relayCardanoToEvm({
                gateway: evm.gateway,
                xportAddress: cardano.xportAddress,
                outboundTokenPolicy: cardano.outboundTokenPolicy,
                outboundHandlerAddress: cardano.outboundHandlerAddress,
                targetContract: evm.tokenHome.address,
            });

            console.log(`[cross-chain] Cardano→EVM relayed ${relayed} messages`);
        });
    });

    // ── Full Round-Trip ──────────────────────────────────────────────────

    describe('Full Round-Trip', () => {
        it('EVM → Cardano → EVM: inbound proof created and outbound relayed', async () => {
            const amount = 1000;

            // Fresh wallets
            const worker = await freshWallet(cardanoProvider);
            const user = await freshWallet(cardanoProvider);

            // Step 1: EVM → Cardano
            const PlutusUtil = require('../../evm-contracts/utils/plutusDataTool.js');
            const pu = new PlutusUtil();
            const outboundPlutus: string = pu.genBeneficiaryData(user.address, amount);

            const evmTx = await evm.tokenHome.connect(evm.user).send(outboundPlutus);
            await evmTx.wait();

            // Create inbound proof on Cardano
            const inboundTxHash = await createInboundTask({
                wallet: worker.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                receiverAddress: user.address,
                amount,
            });
            expect(inboundTxHash).toBeDefined();
            await sleep(3000);

            // Process inbound
            const processInbound = await processInboundTask({
                wallet: worker.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                inboundHandlerAddress: cardano.inboundHandlerAddress,
            });
            expect(processInbound).not.toBeNull();
            await sleep(3000);

            // Step 2: Cardano → EVM
            const outboundTxHash = await createOutboundTask({
                wallet: user.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                receiverOnEvm: evm.user.address.replace('0x', ''),
                amount,
            });
            expect(outboundTxHash).toBeDefined();
            await sleep(3000);

            // Process outbound
            const processOutbound = await processOutboundTask({
                wallet: user.wallet,
                provider: cardanoProvider,
                deployment: cardano,
                outboundHandlerAddress: cardano.outboundHandlerAddress,
            });
            expect(processOutbound).not.toBeNull();
            await sleep(3000);

            // Relay xport → EVM
            const relayed = await relayCardanoToEvm({
                gateway: evm.gateway,
                xportAddress: cardano.xportAddress,
                outboundTokenPolicy: cardano.outboundTokenPolicy,
                outboundHandlerAddress: cardano.outboundHandlerAddress,
                targetContract: evm.tokenHome.address,
            });

            console.log(`[cross-chain] Round-trip complete: relayed=${relayed}`);
        });
    });
});
