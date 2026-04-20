"use strict";

/**
 * EVM E2E Tests: Token Bridge Lifecycle
 *
 * Tests the full EVM-side flow of the Cardano↔EVM bridge:
 *   - Outbound: EVM → Cardano (send tokens, lock, dispatch message)
 *   - Inbound: Cardano → EVM (receive message, verify signature, release tokens)
 *   - Round-trip: outbound + inbound = net-zero
 *
 * Uses MockWanchainMPC for signature verification bypass.
 * All tests run on the in-process Hardhat Network.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
    deployE2E, E2EDeployment,
    CARDANO_CHAIN_ID, DEFAULT_GAS_LIMIT,
    CARDANO_INBOUND_REMOTE,
} from "./helpers/deploy-e2e";
import {
    CARDANO_RECEIVER_10000, CARDANO_RECEIVER_10000_AMOUNT,
    EVM_RECEIVER_10000, EVM_RECEIVER_10000_ADDR, EVM_RECEIVER_10000_AMOUNT,
    EVM_RECEIVER_1, EVM_RECEIVER_1_ADDR, EVM_RECEIVER_1_AMOUNT,
} from "./helpers/cbor-vectors";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build mock MPC signature args for receiveMessageNonEvm. */
function mockSignatureArgs() {
    return {
        smgID: ethers.utils.formatBytes32String("test-smg"),
        r: "0x" + "00".repeat(64), // 64 bytes (gateway extracts PKx/PKy/Rx/Ry)
        s: ethers.utils.formatBytes32String("test-sig"),
    };
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe("EVM E2E: Token Bridge Lifecycle", function () {
    let d: E2EDeployment;

    beforeEach(async function () {
        d = await deployE2E();
    });

    // ── Outbound: EVM → Cardano ─────────────────────────────────────────────

    describe("Outbound: EVM → Cardano", function () {
        it("send() locks tokens and emits MessageDispatchedNonEvm", async function () {
            const userBalBefore = await d.xToken.balanceOf(d.user.address);
            const homeBalBefore = await d.xToken.balanceOf(d.tokenHome.address);


            const tx = await d.tokenHome.connect(d.user).send(CARDANO_RECEIVER_10000);
            const receipt = await tx.wait();

            // Verify SendTokenToRemote event from TokenHome
            const sendEvent = receipt.events?.find((e: any) => e.event === "SendTokenToRemote");
            expect(sendEvent).to.not.be.undefined;
            expect(sendEvent!.args!.toChainId).to.equal(CARDANO_CHAIN_ID);
            expect(sendEvent!.args!.from).to.equal(d.user.address);

            // Verify token balances changed
            const userBalAfter = await d.xToken.balanceOf(d.user.address);
            const homeBalAfter = await d.xToken.balanceOf(d.tokenHome.address);
            expect(userBalBefore.sub(userBalAfter)).to.equal(CARDANO_RECEIVER_10000_AMOUNT);
            expect(homeBalAfter.sub(homeBalBefore)).to.equal(CARDANO_RECEIVER_10000_AMOUNT);
        });

        it("send() with insufficient approval reverts", async function () {
            await d.xToken.connect(d.user).approve(d.tokenHome.address, 0);

            await expect(
                d.tokenHome.connect(d.user).send(CARDANO_RECEIVER_10000)
            ).to.be.reverted;
        });

        it("send() without configured outbound remote reverts", async function () {
            const TokenHome = await ethers.getContractFactory("ERC20TokenHome4CardanoV2");
            const freshHome = await TokenHome.deploy(d.gateway.address, d.xToken.address);
            await freshHome.deployed();


            await expect(
                freshHome.connect(d.user).send(CARDANO_RECEIVER_10000)
            ).to.be.revertedWith("tokenRemote not set");
        });

        it("nonce increments on successive dispatches", async function () {


            const tx1 = await d.tokenHome.connect(d.user).send(CARDANO_RECEIVER_10000);
            const receipt1 = await tx1.wait();

            const tx2 = await d.tokenHome.connect(d.user).send(CARDANO_RECEIVER_10000);
            const receipt2 = await tx2.wait();

            // Extract messageIds from gateway events
            const eventTopic = d.gateway.interface.getEventTopic("MessageDispatchedNonEvm");
            const logs1 = receipt1.logs.filter((l: any) => l.topics[0] === eventTopic);
            const logs2 = receipt2.logs.filter((l: any) => l.topics[0] === eventTopic);
            expect(logs1.length).to.equal(1);
            expect(logs2.length).to.equal(1);

            const decoded1 = d.gateway.interface.parseLog(logs1[0]);
            const decoded2 = d.gateway.interface.parseLog(logs2[0]);
            expect(decoded1.args.messageId).to.not.equal(decoded2.args.messageId);
        });
    });

    // ── Inbound: Cardano → EVM ──────────────────────────────────────────────

    describe("Inbound: Cardano → EVM", function () {
        it("receiveMessageNonEvm() releases tokens to EVM receiver", async function () {
            const receiverBal = await d.xToken.balanceOf(EVM_RECEIVER_10000_ADDR);
            const homeBalBefore = await d.xToken.balanceOf(d.tokenHome.address);

            const messageId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test-msg-1"));
            const sourceContract = ethers.utils.toUtf8Bytes(CARDANO_INBOUND_REMOTE);
            const { smgID, r, s } = mockSignatureArgs();

            await d.gateway.receiveMessageNonEvm(
                messageId, CARDANO_CHAIN_ID, sourceContract,
                d.tokenHome.address, EVM_RECEIVER_10000, DEFAULT_GAS_LIMIT,
                smgID, r, s,
            );

            const receiverBalAfter = await d.xToken.balanceOf(EVM_RECEIVER_10000_ADDR);
            expect(receiverBalAfter.sub(receiverBal)).to.equal(EVM_RECEIVER_10000_AMOUNT);

            const homeBalAfter = await d.xToken.balanceOf(d.tokenHome.address);
            expect(homeBalBefore.sub(homeBalAfter)).to.equal(EVM_RECEIVER_10000_AMOUNT);
        });

        it("replay: same messageId reverts with custom error", async function () {
            const messageId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("replay-test"));
            const sourceContract = ethers.utils.toUtf8Bytes(CARDANO_INBOUND_REMOTE);
            const { smgID, r, s } = mockSignatureArgs();

            await d.gateway.receiveMessageNonEvm(
                messageId, CARDANO_CHAIN_ID, sourceContract,
                d.tokenHome.address, EVM_RECEIVER_10000, DEFAULT_GAS_LIMIT,
                smgID, r, s,
            );

            // Second call with same messageId reverts with custom error
            await expect(
                d.gateway.receiveMessageNonEvm(
                    messageId, CARDANO_CHAIN_ID, sourceContract,
                    d.tokenHome.address, EVM_RECEIVER_10000, DEFAULT_GAS_LIMIT,
                    smgID, r, s,
                )
            ).to.be.reverted; // MessageIdAlreadyExecuted custom error
        });

        it("untrusted remote: reverts (gateway propagates inner revert)", async function () {
            // Original gateway reverts with MessageFailure when inner call fails
            const messageId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("untrusted-test"));
            const fakeRemote = ethers.utils.toUtf8Bytes("addr_test1fake_not_trusted");
            const { smgID, r, s } = mockSignatureArgs();

            await expect(
                d.gateway.receiveMessageNonEvm(
                    messageId, CARDANO_CHAIN_ID, fakeRemote,
                    d.tokenHome.address, EVM_RECEIVER_10000, DEFAULT_GAS_LIMIT,
                    smgID, r, s,
                )
            ).to.be.reverted; // MessageFailure custom error
        });

        it("MPC verify=false reverts with custom error", async function () {
            // Set the actual verifier mock (mockVerifier) to reject signatures
            await d.mockVerifier.setVerifyResult(false);

            const messageId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("mpc-fail-test"));
            const sourceContract = ethers.utils.toUtf8Bytes(CARDANO_INBOUND_REMOTE);
            const { smgID, r, s } = mockSignatureArgs();

            await expect(
                d.gateway.receiveMessageNonEvm(
                    messageId, CARDANO_CHAIN_ID, sourceContract,
                    d.tokenHome.address, EVM_RECEIVER_10000, DEFAULT_GAS_LIMIT,
                    smgID, r, s,
                )
            ).to.be.reverted; // SignatureVerifyFailed custom error
        });
    });

    // ── Full Round-Trip ─────────────────────────────────────────────────────

    describe("Full Round-Trip", function () {
        it("outbound + inbound = net-zero balance change for TokenHome", async function () {
            const homeBalStart = await d.xToken.balanceOf(d.tokenHome.address);

            // Outbound: user sends tokens (locks in TokenHome)

            await d.tokenHome.connect(d.user).send(CARDANO_RECEIVER_10000);

            const homeBalAfterSend = await d.xToken.balanceOf(d.tokenHome.address);
            expect(homeBalAfterSend.sub(homeBalStart)).to.equal(CARDANO_RECEIVER_10000_AMOUNT);

            // Inbound: simulate relay delivering same amount back
            const messageId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("round-trip"));
            const sourceContract = ethers.utils.toUtf8Bytes(CARDANO_INBOUND_REMOTE);
            const { smgID, r, s } = mockSignatureArgs();

            await d.gateway.receiveMessageNonEvm(
                messageId, CARDANO_CHAIN_ID, sourceContract,
                d.tokenHome.address, EVM_RECEIVER_10000, DEFAULT_GAS_LIMIT,
                smgID, r, s,
            );

            // TokenHome balance should return to start
            const homeBalEnd = await d.xToken.balanceOf(d.tokenHome.address);
            expect(homeBalEnd).to.equal(homeBalStart);
        });
    });

    // ── Edge Cases ──────────────────────────────────────────────────────────

    describe("Edge Cases", function () {
        it("minimum amount (1 token)", async function () {
            const messageId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("min-amount"));
            const sourceContract = ethers.utils.toUtf8Bytes(CARDANO_INBOUND_REMOTE);
            const { smgID, r, s } = mockSignatureArgs();

            const receiverBal = await d.xToken.balanceOf(EVM_RECEIVER_1_ADDR);

            await d.gateway.receiveMessageNonEvm(
                messageId, CARDANO_CHAIN_ID, sourceContract,
                d.tokenHome.address, EVM_RECEIVER_1, DEFAULT_GAS_LIMIT,
                smgID, r, s,
            );

            const receiverBalAfter = await d.xToken.balanceOf(EVM_RECEIVER_1_ADDR);
            expect(receiverBalAfter.sub(receiverBal)).to.equal(EVM_RECEIVER_1_AMOUNT);
        });

        it("multiple independent inbound messages", async function () {
            const sourceContract = ethers.utils.toUtf8Bytes(CARDANO_INBOUND_REMOTE);
            const { smgID, r, s } = mockSignatureArgs();

            const msg1 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("multi-1"));
            const msg2 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("multi-2"));

            const receiverBal = await d.xToken.balanceOf(EVM_RECEIVER_10000_ADDR);

            await d.gateway.receiveMessageNonEvm(
                msg1, CARDANO_CHAIN_ID, sourceContract,
                d.tokenHome.address, EVM_RECEIVER_10000, DEFAULT_GAS_LIMIT,
                smgID, r, s,
            );

            await d.gateway.receiveMessageNonEvm(
                msg2, CARDANO_CHAIN_ID, sourceContract,
                d.tokenHome.address, EVM_RECEIVER_10000, DEFAULT_GAS_LIMIT,
                smgID, r, s,
            );

            const receiverBalAfter = await d.xToken.balanceOf(EVM_RECEIVER_10000_ADDR);
            expect(receiverBalAfter.sub(receiverBal)).to.equal(EVM_RECEIVER_10000_AMOUNT * 2);
        });
    });
});
