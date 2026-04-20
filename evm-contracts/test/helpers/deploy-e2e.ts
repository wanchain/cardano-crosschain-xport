/**
 * Shared deployment fixture for EVM E2E tests.
 *
 * Deploys: MockWanchainMPC → WmbGateway → XToken → ERC20TokenHome4CardanoV2
 * Configures: Cardano chain support, base fees, trusted remotes, token approvals.
 */

import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export const CARDANO_CHAIN_ID = 2147485463; // BIP-44 Cardano Preprod
export const BASE_FEE: BigNumber = ethers.utils.parseUnits("1", "gwei");
export const DEFAULT_GAS_LIMIT = 1_000_000;
export const INITIAL_SUPPLY = 100_000_000; // 100M tokens

// Fake Cardano bech32 addresses used as trusted remotes
export const CARDANO_INBOUND_REMOTE = "addr_test1wqzjepm5l3jepgqv42h292u56l5fcsuz8q6j6qtwyvldusq4qmy4n";
export const CARDANO_OUTBOUND_REMOTE = "addr_test1wzu6ldpnxd7gdc0h5fyrt53utrk6ynudl6w304wc2sh7u9c3vl5le";

export interface E2EDeployment {
    gateway: Contract;
    mockMPC: Contract;        // The outer mock (passed to gateway.initialize)
    mockVerifier: Contract;   // The inner mock (actual signatureVerifier + smgAdmin)
    xToken: Contract;
    tokenHome: Contract;
    admin: SignerWithAddress;
    user: SignerWithAddress;
    receiver: SignerWithAddress;
    inboundRemoteBytes: Uint8Array;
    outboundRemoteBytes: Uint8Array;
}

export async function deployE2E(): Promise<E2EDeployment> {
    const [admin, user, receiver] = await ethers.getSigners();

    // 1. Deploy MockWanchainMPC (self-referencing for smgAdminProxy + sigVerifier)
    const MockMPC = await ethers.getContractFactory("MockWanchainMPC");
    const mockMPCTemp = await MockMPC.deploy(
        31337,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
    );
    await mockMPCTemp.deployed();

    const mockMPC = await MockMPC.deploy(
        31337,
        mockMPCTemp.address,
        mockMPCTemp.address,
    );
    await mockMPC.deployed();

    // 2. Deploy WmbGateway + initialize
    const Gateway = await ethers.getContractFactory("WmbGateway");
    const gateway = await Gateway.deploy();
    await gateway.deployed();
    await gateway.initialize(admin.address, mockMPC.address);

    // 3. Enable Cardano chain + set base fee
    await gateway.connect(admin).setSupportedDstChains([CARDANO_CHAIN_ID], [true]);
    await gateway.connect(admin).batchSetBaseFees([CARDANO_CHAIN_ID], [BASE_FEE]);

    // 4. Deploy XToken (100M supply to admin)
    const XToken = await ethers.getContractFactory("XToken");
    const xToken = await XToken.deploy(INITIAL_SUPPLY);
    await xToken.deployed();

    // 5. Deploy ERC20TokenHome4CardanoV2
    const TokenHome = await ethers.getContractFactory("ERC20TokenHome4CardanoV2");
    const tokenHome = await TokenHome.deploy(gateway.address, xToken.address);
    await tokenHome.deployed();

    // 6. Configure trusted remotes
    const inboundRemoteBytes = ethers.utils.toUtf8Bytes(CARDANO_INBOUND_REMOTE);
    const outboundRemoteBytes = ethers.utils.toUtf8Bytes(CARDANO_OUTBOUND_REMOTE);

    await tokenHome.connect(admin).configInboundTokenRemote(CARDANO_CHAIN_ID, inboundRemoteBytes);
    await tokenHome.connect(admin).configOutBoundTokenRemote(CARDANO_CHAIN_ID, outboundRemoteBytes);

    // 7. Transfer tokens to user + approve TokenHome
    const userAmount = ethers.utils.parseEther("1000000"); // 1M tokens
    await xToken.connect(admin).transfer(user.address, userAmount);
    await xToken.connect(user).approve(tokenHome.address, ethers.constants.MaxUint256);

    // Fund TokenHome with tokens for inbound releases
    const homeAmount = ethers.utils.parseEther("1000000");
    await xToken.connect(admin).transfer(tokenHome.address, homeAmount);

    return {
        gateway, mockMPC, mockVerifier: mockMPCTemp,
        xToken, tokenHome,
        admin, user, receiver,
        inboundRemoteBytes, outboundRemoteBytes,
    };
}
