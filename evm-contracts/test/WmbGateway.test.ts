"use strict";

/**
 * WmbGateway unit tests
 *
 * Tests the ORIGINAL (unmodified) WmbGateway contract as deployed by Wanchain.
 * We do NOT modify WmbGateway — it's Wanchain's shared infrastructure.
 *
 * MockWanchainMPC plays two roles inside the gateway:
 *   • wanchainStoremanAdminSC  — queried by _acquireReadySmgInfo()
 *   • signatureVerifier         — queried by IWanchainMPC.verify()
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// ─── Helpers ────────────────────────────────────────────────────────────────

const DST_CHAIN = 888;
const BASE_FEE: BigNumber = ethers.utils.parseUnits("1", "gwei");

interface DeployResult {
    gateway: Contract;
    mockMPC: Contract;
    admin: SignerWithAddress;
    user: SignerWithAddress;
}

async function deployGateway(): Promise<DeployResult> {
    const [admin, user] = await ethers.getSigners();

    const MockMPC = await ethers.getContractFactory("MockWanchainMPC");
    const mockMPC = await MockMPC.deploy(
        31337, ethers.constants.AddressZero, ethers.constants.AddressZero,
    );
    await mockMPC.deployed();

    const mockMPC2 = await MockMPC.deploy(31337, mockMPC.address, mockMPC.address);
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

    // ── Dispatch — original gateway is NOT payable, has no fee enforcement ───

    describe("dispatchMessageV2", function () {
        const gasLimit = 200_000;
        const to = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
        const data = "0x1234";

        it("dispatches without fee (gateway has no fee enforcement)", async function () {
            await expect(
                gateway.connect(user).dispatchMessageV2(DST_CHAIN, to, gasLimit, data)
            ).to.emit(gateway, "MessageDispatchedV2");
        });

        it("reverts when gasLimit exceeds maxGasLimit", async function () {
            await expect(
                gateway.connect(user).dispatchMessageV2(DST_CHAIN, to, 9_000_000, data)
            ).to.be.revertedWith("WmbGateway: Gas limit exceeds maximum");
        });

        it("reverts for unsupported destination chain", async function () {
            await expect(
                gateway.connect(user).dispatchMessageV2(9999, to, gasLimit, data)
            ).to.be.revertedWith("WmbGateway: Unsupported destination chain");
        });

        it("free dispatch succeeds when baseFee is 0", async function () {
            const freeChain = 777;
            await gateway.connect(admin).setSupportedDstChains([freeChain], [true]);
            await gateway.connect(admin).batchSetBaseFees([freeChain], [0]);

            await expect(
                gateway.connect(user).dispatchMessageV2(freeChain, to, gasLimit, data)
            ).to.emit(gateway, "MessageDispatchedV2");
        });
    });

    describe("dispatchMessageNonEvm", function () {
        const gasLimit = 200_000;
        const toBytes = ethers.utils.toUtf8Bytes("addr1qfoo");
        const data = "0xabcd";

        it("dispatches without fee", async function () {
            await expect(
                gateway.connect(user).dispatchMessageNonEvm(DST_CHAIN, toBytes, gasLimit, data)
            ).to.emit(gateway, "MessageDispatchedNonEvm");
        });

        it("free dispatch succeeds when baseFee is 0", async function () {
            const freeChain = 776;
            await gateway.connect(admin).setSupportedDstChains([freeChain], [true]);
            await gateway.connect(admin).batchSetBaseFees([freeChain], [0]);

            await expect(
                gateway.connect(user).dispatchMessageNonEvm(freeChain, toBytes, gasLimit, data)
            ).to.emit(gateway, "MessageDispatchedNonEvm");
        });
    });

    // ── Admin functions ──────────────────────────────────────────────────────

    describe("setGasLimit", function () {
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

    describe("setMaxMessageLength", function () {
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

    describe("setSignatureVerifier", function () {
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

    describe("withdrawFee", function () {
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
        it("reverts on length mismatch", async function () {
            await expect(
                gateway.connect(admin).batchSetBaseFees([DST_CHAIN, 999], [BASE_FEE])
            ).to.be.revertedWith("WmbGateway: Invalid input");
        });
    });
});
