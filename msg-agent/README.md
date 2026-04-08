# msg-agent

Bidirectional Cardano relay for the Wanchain cross-chain bridge. Handles token transfers between EVM chains and Cardano via the xport protocol.

- **Inbound** (EVM to Cardano): Monitors the inbound handler contract for check-token UTxOs created by the MPC oracle network. Burns the check token and mints DemoToken to the recipient's Cardano address.
- **Outbound** (Cardano to EVM): Monitors the outbound handler contract for UTxOs containing DemoToken. Burns the DemoToken, mints an outbound token, and sends a cross-chain message to xport for relay to the target EVM chain.
- **Client**: Lets a user initiate an outbound cross-chain transfer by sending DemoToken to the outbound handler contract.

## Prerequisites

- Node.js >= 18
- Yarn
- Validators compiled in `cross-chain/plutus.json` (Aiken V3) -- run `aiken build` in `cross-chain/` if missing
- For E2E tests: Docker (Yaci DevKit)

## Setup

```bash
yarn install
cp .env.example .env
```

Edit `.env` with your configuration:

| Variable | Description |
|---|---|
| `BLOCKFROST_URL` | Blockfrost-compatible endpoint for local devnet (e.g. `http://localhost:8080/api/v1`) |
| `BLOCKFROST_API_KEY` | Hosted Blockfrost API key (used when `BLOCKFROST_URL` is not set) |
| `YACI_ADMIN_URL` | Yaci DevKit admin URL (e.g. `http://localhost:10000`). When set, uses `YaciProvider` instead of Blockfrost |
| `ACCOUNT_SEED1` | 32-byte hex private key for the inbound monitor wallet |
| `ACCOUNT_SEED2` | 32-byte hex private key for the outbound monitor wallet |
| `ACCOUNT_SEED3` | 32-byte hex private key for the user/client wallet |
| `NETWORK` | `0` = testnet, `1` = mainnet |
| `GROUP_NFT_HOLDER` | Address holding the group NFT (read as reference input during outbound) |
| `EVM_CONTRACT_ADDRESS` | Target EVM bridge contract address |
| `RECEIVER_ON_ADA` | Default Cardano receiver address for testing |
| `RECEIVER_ON_EVM` | Default EVM receiver address for testing |
| `CROSS_TRANSFER_AMOUNT` | Default transfer amount for the client command |
| `EVM_CHAIN_ID` / `ADA_CHAIN_ID` | Chain identifiers |

### Script parameterization (optional)

Validators are parameterized at startup via environment variables:

| Variable | Used by |
|---|---|
| `CHECK_TOKEN_SYMBOL` + `CHECK_TOKEN_NAME` | Inbound token minting policy (check token info) |
| `GROUP_NFT_SYMBOL` + `GROUP_NFT_NAME` | Outbound token minting policy (group NFT info) |
| `XPORT_PKH` + `XPORT_NONCE` | xport spending validator (key param) |
| `LOCAL_INBOUND_TOKEN` + `LOCAL_INBOUND_TOKEN_VERSION` | Override inbound token with a test policy (e.g. always-true V2) |
| `LOCAL_OUTBOUND_TOKEN` + `LOCAL_OUTBOUND_TOKEN_VERSION` | Override outbound token with a test policy |

### Provider auto-detection

The provider is selected automatically based on which env vars are set:

1. `YACI_ADMIN_URL` -- uses `YaciProvider` (local Yaci DevKit)
2. `BLOCKFROST_URL` -- uses `BlockfrostProvider` with a custom endpoint
3. `BLOCKFROST_API_KEY` -- uses `BlockfrostProvider` with hosted Blockfrost

## Running

```bash
# Start the monitor (watches both inbound + outbound contracts in parallel)
yarn start        # or: yarn dev

# Send an outbound cross-chain transfer as a user
yarn client
```

## Available scripts

| Script | Description |
|---|---|
| `yarn start` / `yarn dev` | Start the inbound + outbound monitor |
| `yarn client` | Send an outbound cross-chain transfer |
| `yarn build` | Compile TypeScript |
| `yarn deploy:local` | Deploy validators to a local Yaci DevKit |
| `yarn test:local` | Run local integration test (all flows) |
| `yarn test:local:check` | Test check-token minting only |
| `yarn test:local:inbound` | Test inbound flow only |
| `yarn test:local:outbound` | Test outbound flow only |
| `yarn setup:preprod` | Set up wallets and deploy to preprod testnet |
| `yarn deploy:prod` | Deploy production validators |
| `yarn update:gpk` | Update the group public key |
| `yarn mint:check-tokens` | Mint check tokens (MPC oracle simulation) |
| `yarn test` | Run unit tests (vitest) |
| `yarn test:e2e` | Run E2E tests on Yaci DevKit |

## Testing

### Unit tests

```bash
yarn test
```

Tests datum serialization/deserialization (`datum.test.ts`) and I/O helpers (`io.test.ts`).

### E2E tests (Yaci DevKit)

The E2E suite (`test/e2e.test.ts`) deploys all validators to a local Yaci DevKit instance and exercises the full inbound/outbound flow.

```bash
# Start Yaci DevKit
docker compose up -d

# Run E2E tests (5-minute timeout)
yarn test:e2e
```

The test harness:
1. Creates a fresh devnet via the Yaci admin API
2. Creates three wallets (inbound monitor, outbound monitor, user) and funds them via the Yaci topup endpoint
3. Deploys all validators (inbound handler, outbound handler, bridge token, inbound token, outbound token, xport)
4. Runs inbound and outbound transfer scenarios end-to-end

Test helpers live in `test/helpers/` (wallet creation, deployment, Yaci DevKit control, inbound/outbound task helpers).

## Architecture

### Validators

All validators are loaded from `cross-chain/plutus.json` (compiled by Aiken, Plutus V3):

| Validator | Role |
|---|---|
| `inbound_handler` | Holds inbound check-token UTxOs; spending releases them for DemoToken minting |
| `outbound_handler` | Holds DemoToken UTxOs; spending burns DemoToken and triggers outbound message |
| `bridge_token` | DemoToken minting policy; parameterized by inbound handler script hash |
| `inbound_token` | Inbound check-token minting policy; parameterized by check token info |
| `outbound_token` | Outbound token minting policy; parameterized by group NFT info |
| `xport` | Cross-chain message endpoint; receives outbound messages with outbound token |

### Inbound flow (EVM to Cardano)

1. MPC oracle network observes a lock/transfer on the source EVM chain
2. Oracle mints an inbound check token and sends a UTxO to the **inbound handler** contract with a `CrossMsgData` datum (receiver, amount, chain IDs, etc.)
3. The monitor detects the new UTxO, builds a transaction that:
   - Spends the inbound handler UTxO (burns the check token)
   - Mints DemoToken to the Cardano receiver address
4. Transaction is signed and submitted

### Outbound flow (Cardano to EVM)

1. A user sends DemoToken to the **outbound handler** contract with a `Beneficiary` datum (EVM receiver address, amount)
2. The monitor detects the new UTxO, builds a transaction that:
   - Spends the outbound handler UTxO
   - Burns the DemoToken
   - Mints an outbound token
   - Sends the outbound token + `CrossMsgData` datum to the **xport** contract
3. The xport message is picked up by the MPC oracle network and relayed to the target EVM chain

### Source layout

```
msg-agent/
  src/
    index.ts        Main entry point (monitor + client commands via commander)
    config.ts       Loads validators from cross-chain/plutus.json, env-driven config
    scripts.ts      Parameterizes validators using env vars, resolves addresses/policies
    datum.ts        Pure datum serialization/deserialization (Beneficiary, CrossMsgData, TaskPool)
    utils.ts        Helpers (sleep, withTimeout)
  test/
    e2e.test.ts     End-to-end tests on Yaci DevKit
    helpers/        Test utilities (wallet, deploy, yaci, inbound, outbound)
  scripts/
    deploy-and-generate-env.ts  Deploy validators + generate .env.local
    test-local.ts             Local integration tests
    setup-preprod.ts          Preprod testnet setup
    deploy-prod-validators.ts Production deployment
    update-gpk.ts             Update group public key
    mint-check-tokens.ts      Mint check tokens
```
