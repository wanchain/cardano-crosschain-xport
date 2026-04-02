"use strict";

/**
 * WmbGateway unit tests
 *
 * WmbGateway is Initializable (OpenZeppelin), NOT deployed through the
 * upgrades proxy plugin.  We deploy it directly and call initialize().
 *
 * MockWanchainMPC plays two roles inside the gateway:
 *   • wanchainStoremanAdminSC  — queried by _acquireReadySmgInfo()
 *   • signatureVerifier         — queried by IWanchainMPC.verify()
 *
 * Both are pointed at the same mock instance for simplicity.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// ─── Helpers ────────────────────────────────────────────────────────────────

const DST_CHAIN = 888;   // arbitrary destination chain ID
const BASE_FEE: BigNumber = ethers.utils.parseUnits("1", "gwei"); // 1 gwei per gas unit

interface DeployResult {
    gateway: Contract;
    mockMPC: Contract;
    admin: SignerWithAddress;
    user: SignerWithAddress;
}

async function deployGateway(): Promise<DeployResult> {
    const [admin, user] = await ethers.getSigners();

    // Deploy the mock that acts as both smgAdminProxy and sigVerifier
    const MockMPC = await ethers.getContractFactory("MockWanchainMPC");
    // Pass mock address as smgAdminProxy and sigVerifier (same contract)
    // We'll update those after deployment via a two-step approach:
    // Deploy with placeholder addresses first, then we can't change them on
    // the mock because getPartners() reads live state.  So we deploy with
    // the mock's own address for both (circular reference is fine for tests).
    const mockMPC = await MockMPC.deploy(
        31337,           // local hardhat chain id
        ethers.constants.AddressZero, // smgAdminProxy placeholder — updated below
        ethers.constants.AddressZero  // sigVerifier   placeholder — updated below
    );
    await mockMPC.deployed();

    // Re-deploy the mock pointing at itself for both roles
    const mockMPC2 = await MockMPC.deploy(
        31337,
        mockMPC.address,  // smgAdminProxy → itself (gateway reads this for wanchainStoremanAdminSC)
        mockMPC.address   // sigVerifier   → itself
    );
    await mockMPC2.deployed();

    const Gateway = await ethers.getContractFactory("WmbGateway");
    const gateway = await Gateway.deploy();
    await gateway.deployed();

    await gateway.initialize(admin.address, mockMPC2.address);

    return { gateway, mockMPC: mockMPC2, admin, user };
}

async function enableDstChain(gateway: Contract, admin: SignerWithAddress): Promise<void> {
    await gateway.connect(admin).setSupportedDstChains([DST_CHAIN], [true]);
    await gateway.connect(admin).batchSetBaseFees([DST_CHAIN], [BASE_FEE]);
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("WmbGateway", function () {
    let gateway: Contract;
    let mockMPC: Contract;
    let admin: SignerWithAddress;
    let user: SignerWithAddress;

    beforeEach(async function () {
        ({ gateway, mockMPC, admin, user } = await deployGateway());
        await enableDstChain(gateway, admin);
    });

    // ── Initialization ────────────────────────────────────────────────────────

    describe("initialize", function () {
        it("sets chainId from mock MPC", async function () {
            expect(await gateway.chainId()).to.equal(31337);
        });

        it("sets default gas limits", async function () {
            expect(await gateway.maxGasLimit()).to.equal(8_000_000);
            expect(await gateway.minGasLimit()).to.equal(150_000);
            expect(await gateway.defaultGasLimit()).to.equal(1_000_000);
        });

        it("grants DEFAULT_ADMIN_ROLE to admin", async function () {
            const role: string = await gateway.DEFAULT_ADMIN_ROLE();
            expect(await gateway.hasRole(role, admin.address)).to.be.true;
        });

        it("reverts when re-initialized", async function () {
            await expect(
                gateway.initialize(admin.address, mockMPC.address)
            ).to.be.reverted;
        });

        it("reverts when admin is address(0)", async function () {
            const Gateway = await ethers.getContractFactory("WmbGateway");
            const fresh = await Gateway.deploy();
            await fresh.deployed();
            await expect(
                fresh.initialize(ethers.constants.AddressZero, mockMPC.address)
            ).to.be.revertedWith("WmbGateway: Invalid admin address");
        });

        it("reverts when chain id is 0 from MPC", async function () {
            const MockMPC = await ethers.getContractFactory("MockWanchainMPC");
            const badMPC = await MockMPC.deploy(0, mockMPC.address, mockMPC.address);
            await badMPC.deployed();

            const Gateway = await ethers.getContractFactory("WmbGateway");
            const fresh = await Gateway.deploy();
            await fresh.deployed();
            await expect(
                fresh.initialize(admin.address, badMPC.address)
            ).to.be.revertedWith("chainId is empty");
        });
    });

    // ── Fee validation — dispatchMessageV2 ───────────────────────────────────

    describe("dispatchMessageV2 fee validation", function () {
        const gasLimit = 200_000; // above minGasLimit (150k), below max (8M)
        const to       = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
        const data     = "0x1234";

        it("reverts when fee is too low (below gasLimit * baseFee)", async function () {
            const tooLow: BigNumber = BASE_FEE.mul(gasLimit).sub(1);
            await expect(
                gateway.connect(user).dispatchMessageV2(DST_CHAIN, to, gasLimit, data, { value: tooLow })
            ).to.be.revertedWith("WmbGateway: Fee too low");
        });

        it("succeeds with exact fee", async function () {
            const exact: BigNumber = BASE_FEE.mul(gasLimit);
            await expect(
                gateway.connect(user).dispatchMessageV2(DST_CHAIN, to, gasLimit, data, { value: exact })
            ).to.emit(gateway, "MessageDispatchedV2");
        });

        it("succeeds with fee above minimum", async function () {
            const over: BigNumber = BASE_FEE.mul(gasLimit).add(ethers.utils.parseEther("0.001"));
            await expect(
                gateway.connect(user).dispatchMessageV2(DST_CHAIN, to, gasLimit, data, { value: over })
            ).to.emit(gateway, "MessageDispatchedV2");
        });

        it("reverts when gasLimit exceeds maxGasLimit", async function () {
            const tooHigh = 9_000_000;
            const fee: BigNumber = BASE_FEE.mul(tooHigh);
            await expect(
                gateway.connect(user).dispatchMessageV2(DST_CHAIN, to, tooHigh, data, { value: fee })
            ).to.be.revertedWith("WmbGateway: Gas limit exceeds maximum");
        });

        it("reverts when gasLimit is below minGasLimit", async function () {
            const tooLow = 100_000;
            const fee: BigNumber = BASE_FEE.mul(tooLow);
            await expect(
                gateway.connect(user).dispatchMessageV2(DST_CHAIN, to, tooLow, data, { value: fee })
            ).to.be.revertedWith("WmbGateway: Gas limit too low");
        });

        it("reverts for unsupported destination chain", async function () {
            const exact: BigNumber = BASE_FEE.mul(gasLimit);
            await expect(
                gateway.connect(user).dispatchMessageV2(9999, to, gasLimit, data, { value: exact })
            ).to.be.revertedWith("WmbGateway: Unsupported destination chain");
        });

        it("free dispatch succeeds when baseFee is 0", async function () {
            // Set baseFee to 0 for a new chain
            const freeChain = 777;
            await gateway.connect(admin).setSupportedDstChains([freeChain], [true]);
            await gateway.connect(admin).batchSetBaseFees([freeChain], [0]);

            await expect(
                gateway.connect(user).dispatchMessageV2(freeChain, to, gasLimit, data, { value: 0 })
            ).to.emit(gateway, "MessageDispatchedV2");
        });
    });

    // ── Fee validation — dispatchMessageNonEvm ───────────────────────────────

    describe("dispatchMessageNonEvm fee validation", function () {
        const gasLimit  = 200_000;
        const toBytes   = ethers.utils.toUtf8Bytes("addr1qfoo");
        const data      = "0xabcd";

        it("reverts when fee is too low", async function () {
            const tooLow: BigNumber = BASE_FEE.mul(gasLimit).sub(1);
            await expect(
                gateway.connect(user).dispatchMessageNonEvm(DST_CHAIN, toBytes, gasLimit, data, { value: tooLow })
            ).to.be.revertedWith("WmbGateway: Fee too low");
        });

        it("succeeds with exact fee", async function () {
            const exact: BigNumber = BASE_FEE.mul(gasLimit);
            await expect(
                gateway.connect(user).dispatchMessageNonEvm(DST_CHAIN, toBytes, gasLimit, data, { value: exact })
            ).to.emit(gateway, "MessageDispatchedNonEvm");
        });

        it("free dispatch succeeds when baseFee is 0", async function () {
            const freeChain = 776;
            await gateway.connect(admin).setSupportedDstChains([freeChain], [true]);
            await gateway.connect(admin).batchSetBaseFees([freeChain], [0]);

            await expect(
                gateway.connect(user).dispatchMessageNonEvm(freeChain, toBytes, gasLimit, data, { value: 0 })
            ).to.emit(gateway, "MessageDispatchedNonEvm");
        });
    });

    // ── Admin — setGasLimit ──────────────────────────────────────────────────

    describe("setGasLimit", function () {
        it("emits GasLimitSet with new values", async function () {
            await expect(
                gateway.connect(admin).setGasLimit(10_000_000, 100_000, 500_000)
            )
                .to.emit(gateway, "GasLimitSet")
                .withArgs(10_000_000, 100_000, 500_000);
        });

        it("updates stored gas limits", async function () {
            await gateway.connect(admin).setGasLimit(10_000_000, 100_000, 500_000);
            expect(await gateway.maxGasLimit()).to.equal(10_000_000);
            expect(await gateway.minGasLimit()).to.equal(100_000);
            expect(await gateway.defaultGasLimit()).to.equal(500_000);
        });

        it("reverts when called by non-admin", async function () {
            await expect(
                gateway.connect(user).setGasLimit(10_000_000, 100_000, 500_000)
            ).to.be.revertedWith("WmbGateway: Caller is not an admin");
        });
    });

    // ── Admin — setMaxMessageLength ──────────────────────────────────────────

    describe("setMaxMessageLength", function () {
        it("emits MaxMessageLengthSet with new value", async function () {
            await expect(gateway.connect(admin).setMaxMessageLength(5000))
                .to.emit(gateway, "MaxMessageLengthSet")
                .withArgs(5000);
        });

        it("updates stored maxMessageLength", async function () {
            await gateway.connect(admin).setMaxMessageLength(5000);
            expect(await gateway.maxMessageLength()).to.equal(5000);
        });

        it("reverts when called by non-admin", async function () {
            await expect(
                gateway.connect(user).setMaxMessageLength(5000)
            ).to.be.revertedWith("WmbGateway: Caller is not an admin");
        });
    });

    // ── Admin — setSignatureVerifier ─────────────────────────────────────────

    describe("setSignatureVerifier", function () {
        it("emits SignatureVerifierSet with new address", async function () {
            const newVerifier: string = user.address;
            await expect(gateway.connect(admin).setSignatureVerifier(newVerifier))
                .to.emit(gateway, "SignatureVerifierSet")
                .withArgs(newVerifier);
        });

        it("updates stored signatureVerifier", async function () {
            await gateway.connect(admin).setSignatureVerifier(user.address);
            expect(await gateway.signatureVerifier()).to.equal(user.address);
        });

        it("reverts when called by non-admin", async function () {
            await expect(
                gateway.connect(user).setSignatureVerifier(user.address)
            ).to.be.revertedWith("WmbGateway: Caller is not an admin");
        });
    });

    // ── Admin — withdrawFee ──────────────────────────────────────────────────

    describe("withdrawFee", function () {
        it("emits FeeWithdrawn with recipient and balance", async function () {
            // Fund the gateway by dispatching a message
            const gasLimit = 200_000;
            const fee: BigNumber = BASE_FEE.mul(gasLimit);
            await gateway.connect(user).dispatchMessageV2(
                DST_CHAIN,
                "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
                gasLimit,
                "0x1234",
                { value: fee }
            );

            await expect(
                gateway.connect(admin).withdrawFee(admin.address)
            )
                .to.emit(gateway, "FeeWithdrawn")
                .withArgs(admin.address, fee);
        });

        it("transfers balance to recipient", async function () {
            const gasLimit = 200_000;
            const fee: BigNumber = BASE_FEE.mul(gasLimit);
            await gateway.connect(user).dispatchMessageV2(
                DST_CHAIN,
                "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
                gasLimit,
                "0x1234",
                { value: fee }
            );

            const before: BigNumber = await ethers.provider.getBalance(admin.address);
            const tx = await gateway.connect(admin).withdrawFee(admin.address);
            const receipt = await tx.wait();
            const gasCost: BigNumber = receipt.gasUsed.mul(tx.gasPrice);
            const after: BigNumber = await ethers.provider.getBalance(admin.address);

            // after = before + fee - gasCost
            expect(after).to.equal(before.add(fee).sub(gasCost));
        });

        it("reverts when called by non-admin", async function () {
            await expect(
                gateway.connect(user).withdrawFee(user.address)
            ).to.be.revertedWith("WmbGateway: Caller is not an admin");
        });
    });

    // ── estimateFee ──────────────────────────────────────────────────────────

    describe("estimateFee", function () {
        it("returns gasLimit * baseFee for valid gasLimit", async function () {
            const gasLimit = 200_000;
            const expected: BigNumber = BASE_FEE.mul(gasLimit);
            expect(await gateway.estimateFee(DST_CHAIN, gasLimit)).to.equal(expected);
        });

        it("returns minGasLimit * baseFee when gasLimit < minGasLimit", async function () {
            const minGas: BigNumber = await gateway.minGasLimit();
            const expected: BigNumber = BASE_FEE.mul(minGas);
            expect(await gateway.estimateFee(DST_CHAIN, 100_000)).to.equal(expected);
        });

        it("reverts for unsupported chain", async function () {
            await expect(gateway.estimateFee(9999, 200_000)).to.be.revertedWith(
                "WmbGateway: Unsupported destination chain"
            );
        });
    });

    // ── batchSetBaseFees ─────────────────────────────────────────────────────

    describe("batchSetBaseFees", function () {
        it("emits BaseFeesSet", async function () {
            await expect(
                gateway.connect(admin).batchSetBaseFees([DST_CHAIN], [BASE_FEE])
            )
                .to.emit(gateway, "BaseFeesSet")
                .withArgs([DST_CHAIN], [BASE_FEE]);
        });

        it("reverts on length mismatch", async function () {
            await expect(
                gateway.connect(admin).batchSetBaseFees([DST_CHAIN, 999], [BASE_FEE])
            ).to.be.revertedWith("WmbGateway: Invalid input");
        });
    });

    // ── Message length guard ──────────────────────────────────────────────────

    describe("message length guard", function () {
        it("reverts when message data exceeds maxMessageLength", async function () {
            await gateway.connect(admin).setMaxMessageLength(4);
            const gasLimit = 200_000;
            const fee: BigNumber = BASE_FEE.mul(gasLimit);
            const longData = "0x" + "ab".repeat(5); // 5 bytes > 4 limit

            await expect(
                gateway.connect(user).dispatchMessageV2(DST_CHAIN, user.address, gasLimit, longData, { value: fee })
            ).to.be.revertedWith("WmbGateway: Message too long");
        });
    });

    // ── _receiveBatchMessage empty batch guard ────────────────────────────────
    //
    // receiveBatchMessage is gated behind _verifyMpcSignature which calls the
    // real MPC storeman group check.  To reach _receiveBatchMessage we need a
    // valid MPC signature flow.  MockWanchainMPC.verify() returns true, and the
    // storeman group status is set to "ready" (5) with wide time window.
    // We construct valid calldata manually to exercise the empty-batch revert.

    describe("_receiveBatchMessage empty batch guard", function () {
        it("reverts with 'WmbGateway: empty batch' when messages array is empty", async function () {
            const smgID: string = ethers.utils.formatBytes32String("testSmg");
            // r must be 64 bytes (PKx/PKy / Rx/Ry extraction)
            const r = "0x" + "00".repeat(64);
            const s: string = ethers.constants.HashZero;
            const messageId: string = ethers.utils.formatBytes32String("msgId1");

            await expect(
                gateway.connect(user).receiveBatchMessage(
                    messageId,
                    31337,         // sourceChainId
                    user.address,  // sourceContract
                    [],            // empty messages array
                    1_000_000,     // gasLimit
                    smgID,
                    r,
                    s
                )
            ).to.be.revertedWith("WmbGateway: empty batch");
        });
    });
});
