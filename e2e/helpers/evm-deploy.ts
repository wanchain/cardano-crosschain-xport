/**
 * Deploy EVM contracts to a Hardhat node for cross-chain E2E tests.
 *
 * Uses raw ethers.js against the JSON-RPC endpoint (not Hardhat's in-process network).
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HARDHAT_RPC, CARDANO_CHAIN_ID, BASE_FEE_GWEI, HARDHAT_CHAIN_ID } from './config';

const ARTIFACTS_DIR = join(__dirname, '../../evm-contracts/artifacts/contracts');

function loadArtifact(path: string) {
    const raw = readFileSync(join(ARTIFACTS_DIR, path), 'utf-8');
    const artifact = JSON.parse(raw);
    return { abi: artifact.abi, bytecode: artifact.bytecode };
}

export interface EvmDeployment {
    provider: ethers.providers.JsonRpcProvider;
    admin: ethers.Wallet;
    user: ethers.Wallet;
    gateway: ethers.Contract;
    mockMPC: ethers.Contract;
    mockVerifier: ethers.Contract;
    xToken: ethers.Contract;
    tokenHome: ethers.Contract;
    cardanoChainId: number;
}

/**
 * Deploy all EVM contracts to the Hardhat node and configure them.
 * Returns contract instances connected to the admin signer.
 */
export async function deployEvmContracts(): Promise<EvmDeployment> {
    const provider = new ethers.providers.JsonRpcProvider(HARDHAT_RPC);

    // Use Hardhat's default funded accounts
    const accounts = await provider.listAccounts();
    const admin = new ethers.Wallet(
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Hardhat account #0
        provider,
    );
    const user = new ethers.Wallet(
        '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Hardhat account #1
        provider,
    );

    // Load artifacts
    const MockMPCArtifact = loadArtifact('test/MockWanchainMPC.sol/MockWanchainMPC.json');
    const GatewayArtifact = loadArtifact('WmbGateway.sol/WmbGateway.json');
    const XTokenArtifact = loadArtifact('examples/XToken.sol/XToken.json');
    const TokenHomeArtifact = loadArtifact('examples/TokenBridgeV2/ERC20TokenHome4CardanoV2.sol/ERC20TokenHome4CardanoV2.json');

    // 1. Deploy MockWanchainMPC (two-step: temp → self-referencing)
    const MockMPCFactory = new ethers.ContractFactory(MockMPCArtifact.abi, MockMPCArtifact.bytecode, admin);
    const mockVerifier = await MockMPCFactory.deploy(
        HARDHAT_CHAIN_ID,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
    );
    await mockVerifier.deployed();

    const mockMPC = await MockMPCFactory.deploy(
        HARDHAT_CHAIN_ID,
        mockVerifier.address,
        mockVerifier.address,
    );
    await mockMPC.deployed();

    // 2. Deploy WmbGateway + initialize
    const GatewayFactory = new ethers.ContractFactory(GatewayArtifact.abi, GatewayArtifact.bytecode, admin);
    const gateway = await GatewayFactory.deploy();
    await gateway.deployed();
    await (await gateway.initialize(admin.address, mockMPC.address)).wait();

    // 3. Enable Cardano chain + set base fee
    const baseFee = ethers.utils.parseUnits(String(BASE_FEE_GWEI), 'gwei');
    await (await gateway.setSupportedDstChains([CARDANO_CHAIN_ID], [true])).wait();
    await (await gateway.batchSetBaseFees([CARDANO_CHAIN_ID], [baseFee])).wait();

    // 4. Deploy XToken (100M supply)
    const XTokenFactory = new ethers.ContractFactory(XTokenArtifact.abi, XTokenArtifact.bytecode, admin);
    const xToken = await XTokenFactory.deploy(100_000_000);
    await xToken.deployed();

    // 5. Deploy TokenHome
    const TokenHomeFactory = new ethers.ContractFactory(TokenHomeArtifact.abi, TokenHomeArtifact.bytecode, admin);
    const tokenHome = await TokenHomeFactory.deploy(gateway.address, xToken.address);
    await tokenHome.deployed();

    // 6. Transfer tokens to user + fund TokenHome for inbound releases
    const userAmount = ethers.utils.parseEther('1000000');
    await (await xToken.transfer(user.address, userAmount)).wait();
    await (await xToken.transfer(tokenHome.address, userAmount)).wait();

    // 7. User approves TokenHome
    const xTokenUser = xToken.connect(user);
    await (await xTokenUser.approve(tokenHome.address, ethers.constants.MaxUint256)).wait();

    console.log('[evm-deploy] Contracts deployed:');
    console.log(`  MockMPC:   ${mockMPC.address}`);
    console.log(`  Gateway:   ${gateway.address}`);
    console.log(`  XToken:    ${xToken.address}`);
    console.log(`  TokenHome: ${tokenHome.address}`);

    return {
        provider, admin, user,
        gateway, mockMPC, mockVerifier,
        xToken, tokenHome,
        cardanoChainId: CARDANO_CHAIN_ID,
    };
}

/**
 * Configure TokenHome trusted remotes using actual Cardano script addresses
 * from a Cardano deployment.
 */
export async function configureTokenHomeRemotes(
    tokenHome: ethers.Contract,
    inboundRemoteAddress: string,
    outboundRemoteAddress: string,
): Promise<void> {
    const inboundBytes = ethers.utils.toUtf8Bytes(inboundRemoteAddress);
    const outboundBytes = ethers.utils.toUtf8Bytes(outboundRemoteAddress);

    await (await tokenHome.configInboundTokenRemote(CARDANO_CHAIN_ID, inboundBytes)).wait();
    await (await tokenHome.configOutBoundTokenRemote(CARDANO_CHAIN_ID, outboundBytes)).wait();

    console.log('[evm-deploy] TokenHome remotes configured:');
    console.log(`  Inbound:  ${inboundRemoteAddress}`);
    console.log(`  Outbound: ${outboundRemoteAddress}`);
}
