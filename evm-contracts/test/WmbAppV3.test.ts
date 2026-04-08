"use strict";

/**
 * WmbAppV3 unit tests
 *
 * WmbAppV3 is abstract.  We test through TestWmbApp — a minimal concrete
 * subclass defined in contracts/test/TestWmbApp.sol.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// ─── Helpers ────────────────────────────────────────────────────────────────

interface AppDeployResult {
    app: Contract;
    owner: SignerWithAddress;
    other: SignerWithAddress;
}

async function deployApp(gatewayAddress: string): Promise<AppDeployResult> {
    const [owner, other] = await ethers.getSigners();
    const TestWmbApp = await ethers.getContractFactory("TestWmbApp");
    const app = await TestWmbApp.deploy(gatewayAddress);
    await app.deployed();
    return { app, owner, other };
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("WmbAppV3 (via TestWmbApp)", function () {
    let owner: SignerWithAddress;
    let other: SignerWithAddress;

    before(async function () {
        [owner, other] = await ethers.getSigners();
    });

    // ── Constructor ──────────────────────────────────────────────────────────

    describe("constructor", function () {
        it("succeeds with a valid gateway address", async function () {
            const { app } = await deployApp(owner.address);
            expect(await app.wmbGateway()).to.equal(owner.address);
        });

        it("sets deployer as owner", async function () {
            const { app } = await deployApp(owner.address);
            expect(await app.owner()).to.equal(owner.address);
        });
    });

    // ── setTrustedRemote ───────────────────────────────────────────────

    describe("setTrustedRemote", function () {
        let app: Contract;
        const fromChainId = 888;
        const remoteAddr  = ethers.utils.toUtf8Bytes("addr1qfoobar");

        beforeEach(async function () {
            ({ app } = await deployApp(owner.address));
        });

        it("can only be called by the owner", async function () {
            await expect(
                app.connect(owner).setTrustedRemote(fromChainId, remoteAddr, true)
            ).to.not.be.reverted;
        });

        it("reverts when called by non-owner", async function () {
            await expect(
                app.connect(other).setTrustedRemote(fromChainId, remoteAddr, true)
            ).to.be.reverted; // OZ Ownable reverts without a specific string in v5
        });

        it("emits SetTrustedRemote event with correct args", async function () {
            await expect(
                app.connect(owner).setTrustedRemote(fromChainId, remoteAddr, true)
            )
                .to.emit(app, "SetTrustedRemote")
                .withArgs(fromChainId, ethers.utils.hexlify(remoteAddr), true);
        });

        it("stores the trusted remote mapping correctly", async function () {
            await app.connect(owner).setTrustedRemote(fromChainId, remoteAddr, true);
            expect(await app.trustedRemotes(fromChainId, remoteAddr)).to.be.true;
        });

        it("can untrust a previously trusted remote", async function () {
            await app.connect(owner).setTrustedRemote(fromChainId, remoteAddr, true);
            await app.connect(owner).setTrustedRemote(fromChainId, remoteAddr, false);
            expect(await app.trustedRemotes(fromChainId, remoteAddr)).to.be.false;
        });

        it("emits SetTrustedRemote when untrusting", async function () {
            await app.connect(owner).setTrustedRemote(fromChainId, remoteAddr, true);
            await expect(
                app.connect(owner).setTrustedRemote(fromChainId, remoteAddr, false)
            )
                .to.emit(app, "SetTrustedRemote")
                .withArgs(fromChainId, ethers.utils.hexlify(remoteAddr), false);
        });
    });

    // ── wmbReceiveNonEvm access control ──────────────────────────────────────

    describe("wmbReceiveNonEvm", function () {
        let app: Contract;
        let gateway: SignerWithAddress;
        const fromChainId = 888;
        const remoteAddr  = ethers.utils.toUtf8Bytes("addr1qfoobar");
        const messageId   = ethers.utils.formatBytes32String("testMsg");
        const data        = "0xdeadbeef";

        beforeEach(async function () {
            // Deploy a fresh app where owner acts as the gateway
            ({ app } = await deployApp(owner.address));
            gateway = owner;

            // Trust the remote so the inner check passes
            await app.connect(owner).setTrustedRemote(fromChainId, remoteAddr, true);
        });

        it("reverts when caller is not the gateway", async function () {
            await expect(
                app.connect(other).wmbReceiveNonEvm(data, messageId, fromChainId, remoteAddr)
            ).to.be.revertedWith("WmbApp: Only WMB gateway can call this function");
        });

        it("reverts when remote is not trusted", async function () {
            const untrusted = ethers.utils.toUtf8Bytes("addr1quntrusted");
            await expect(
                app.connect(gateway).wmbReceiveNonEvm(data, messageId, fromChainId, untrusted)
            ).to.be.revertedWith("WmbApp: Remote is not trusted");
        });

        it("succeeds when caller is gateway and remote is trusted", async function () {
            await expect(
                app.connect(gateway).wmbReceiveNonEvm(data, messageId, fromChainId, remoteAddr)
            ).to.not.be.reverted;
        });

        it("stores the received data in TestWmbApp state", async function () {
            await app.connect(gateway).wmbReceiveNonEvm(data, messageId, fromChainId, remoteAddr);
            expect(await app.lastMessageId()).to.equal(messageId);
            expect(await app.lastFromChainId()).to.equal(fromChainId);
        });
    });

    // ── wmbGateway immutability ──────────────────────────────────────────────

    describe("wmbGateway", function () {
        it("stores the gateway address set in constructor", async function () {
            const { app } = await deployApp(other.address);
            expect(await app.wmbGateway()).to.equal(other.address);
        });
    });
});
