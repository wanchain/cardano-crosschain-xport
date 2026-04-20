# cardano-crosschain-xport

Wanchain cross-chain message bridge (XPort) between Cardano and EVM chains. XPort enables trustless message passing — applications on Cardano can send messages to Ethereum/Wanchain and vice versa, secured by MPC (multi-party computation) threshold signatures.

## Repository Structure

| Directory | Description |
|---|---|
| **cross-chain/** | Aiken V3 validators (Plutus V3). Compiled output in `plutus.json`. See [cross-chain/README.md](cross-chain/README.md) for validator details. |
| **msg-agent/** | TypeScript relay agent. Runs in `monitor` mode (watches chain) or `client` mode. Built with MeshSDK. |
| **evm-contracts/** | Solidity contracts — `WmbGateway`, `TokenHome`, and supporting libraries. Uses Hardhat. |
| **e2e/** | Cross-chain end-to-end tests. Orchestrates Hardhat (EVM) and Yaci DevKit (Cardano) together via Vitest. |

### Validators (cross-chain/)

The Aiken validators implement the on-chain logic for XPort:

- **GroupNFT / GroupNFTHolder** — Stores cross-chain parameters (GPK) in an NFT datum.
- **AdminNFTHolder** — Holds the admin NFT; authorizes management operations via m/n multi-sig.
- **CheckToken / InboundMintCheck** — Permission tokens ensuring inbound mints are MPC-authorized.
- **InboundToken / InboundHandler** — Mints an inbound token to the target contract when a message arrives from an EVM chain.
- **OutboundToken / OutboundHandler / XPort** — Mints an outbound token when a Cardano app sends a message to an EVM chain.
- **BridgeToken** — Token minting for bridged assets.

## Prerequisites

- **Node.js** >= 18 and **Yarn**
- **Docker** (for Yaci DevKit local Cardano devnet)
- **Aiken** v1.1.21+ (only needed to recompile validators; pre-built `plutus.json` is committed)

## Quick Start

### 1. Start the local Cardano devnet

```bash
docker compose up -d
```

This launches [Yaci DevKit](https://github.com/bloxbean/yaci-devkit) with:
- Blockfrost-compatible API on `http://localhost:8080`
- Admin API on `http://localhost:10000`
- Yaci Viewer (block explorer) on `http://localhost:5173`

### 2. Start a local EVM node

```bash
cd evm-contracts
yarn install
npx hardhat node
```

Hardhat node runs on `http://localhost:8545`.

### 3. Deploy and test

```bash
# Deploy validators + EVM contracts via the msg-agent
cd msg-agent
yarn install
yarn deploy:local

# Or run cross-chain E2E tests directly
cd e2e
yarn install
yarn test
```

## Testing

### Aiken unit tests (validators)

```bash
cd cross-chain
aiken check
```

Runs the `*.test.ak` files (`check_token.test.ak`, `group_nft.test.ak`, `inbound_token.test.ak`, `xport.test.ak`).

### msg-agent unit tests

```bash
cd msg-agent
yarn test
```

Runs Vitest tests for datum encoding, I/O helpers, etc.

### EVM contract tests

```bash
cd evm-contracts
npx hardhat test
```

### Cross-chain E2E tests

Requires both Yaci DevKit and Hardhat node running (see Quick Start above).

```bash
cd e2e
yarn test
```

These tests orchestrate both chains directly — deploying contracts, creating inbound/outbound tasks, and verifying message delivery end-to-end.

## Architecture

**Outbound (Cardano to EVM):** A Cardano DApp mints an `OutboundToken` to the XPort contract with a cross-chain message datum. The relay agent picks up the UTxO and submits a proof to `WmbGateway.receiveMessageNonEvm()` on the EVM side.

**Inbound (EVM to Cardano):** An EVM contract calls `WmbGateway.send()`. The relay agent observes the event and creates an MPC-signed inbound transaction on Cardano, minting an `InboundToken` to the target DApp contract.

## License

[Apache-2.0](LICENSE)
