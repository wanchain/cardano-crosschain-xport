# Local Testing Guide

End-to-end testing of the Cardano↔EVM cross-chain bridge on local devnets.

## Prerequisites

- **Docker** (for Yaci DevKit — local Cardano devnet)
- **Node.js** >= 18 and **Yarn**
- **Aiken** v1.1.21+ (only if recompiling validators; pre-built `plutus.json` is committed)

## 1. Start infrastructure

### Yaci DevKit (Cardano)

```bash
# From repo root
docker compose up -d
```

This starts:
- Blockfrost-compatible API on `http://localhost:8080`
- Admin API on `http://localhost:10000`
- Block explorer on `http://localhost:5173`

Wait for it to be healthy:
```bash
docker compose ps   # Should show "healthy"
```

### Hardhat Node (EVM)

```bash
cd evm-contracts
yarn install
PK=0x0000000000000000000000000000000000000000000000000000000000000001 npx hardhat node
```

Runs on `http://localhost:8545` with 20 pre-funded accounts (10k ETH each).

Leave this terminal running.

## 2. Run Cardano-only E2E tests

These deploy all Aiken V3 validators on Yaci and test the full Cardano flow.

```bash
cd msg-agent
yarn install
yarn test:e2e
```

**What it does:**
1. Creates a devnet on Yaci (if not already created)
2. Funds 3 wallets (10k tADA each)
3. Deploys all validators: GroupNFT, AdminNFT, GroupNFTHolder, CheckTokens, InboundMintCheck, XPort, handlers, bridge token
4. Sets GPK (Ed25519 test key) and stk_vh in GroupInfoParams
5. Mints 5 check tokens at InboundMintCheck

**Tests (12 total):**
- Deployment verification (GroupNFTHolder, check tokens, wallet balances)
- Inbound: create Ed25519 proof → mint inbound token → process (burn inbound, mint bridge tokens)
- Outbound: send bridge tokens → process (burn bridge, mint outbound proof at xport)
- Full cycle: inbound → outbound in sequence
- Negative: outbound without bridge tokens, replay prevention
- Edge cases: minimum amount, multiple inbound tasks

**Expected result:** 12/12 passing in ~50s.

## 3. Run EVM-only E2E tests

These deploy all Solidity contracts on Hardhat and test the full EVM flow.

```bash
cd evm-contracts
PK=0x0000000000000000000000000000000000000000000000000000000000000001 npx hardhat test test/E2E.test.ts
```

**What it does:**
1. Deploys MockWanchainMPC, WmbGateway, XToken, ERC20TokenHome4CardanoV2
2. Configures trusted remotes (Cardano bech32 addresses)
3. Funds test user with XTokens

**Tests (11 total):**
- Outbound: `send()` locks tokens, emits `MessageDispatchedNonEvm`
- Outbound: insufficient approval reverts, unconfigured remote reverts, nonce increments
- Inbound: `receiveMessageNonEvm()` releases tokens to EVM receiver
- Inbound: replay reverts, untrusted remote reverts, MPC failure reverts
- Round-trip: outbound + inbound = net-zero TokenHome balance
- Edge cases: minimum amount, multiple independent messages

**Expected result:** 11/11 passing in ~2s.

To run ALL EVM tests (including unit tests for Gateway, AppV3, CBOR, PlutusData):

```bash
PK=0x0000000000000000000000000000000000000000000000000000000000000001 npx hardhat test test/CBORCodec.test.ts test/CardanoCBORCodec.test.ts test/PlutusData.test.ts test/WmbGateway.test.ts test/WmbAppV3.test.ts test/E2E.test.ts
```

**Expected result:** 138 passing, 4 pending (skipped — require improved CBORCodec).

## 4. Run cross-chain E2E tests

These run both chains simultaneously with a test relay bridging events.

**Requires both Yaci and Hardhat node running** (from step 1).

```bash
cd e2e
yarn install
yarn test
```

**What it does:**
1. Deploys Cardano validators on Yaci (same as step 2)
2. Deploys EVM contracts on Hardhat node via JSON-RPC
3. Configures TokenHome trusted remotes with actual Cardano script addresses
4. Runs cross-chain test scenarios with in-process relay

**Tests (4 total):**

### Test 1: EVM → Cardano
1. User calls `tokenHome.send(plutusData)` on Hardhat — locks XTokens
2. Gateway emits `MessageDispatchedNonEvm`
3. Test creates inbound proof on Cardano (Ed25519 signed, spends check token)
4. Test processes inbound task (burns inbound token, mints bridge tokens)
5. **Verifies:** bridge tokens at Cardano receiver

### Test 2: Event verification
- Verifies `MessageDispatchedNonEvm` has correct chain ID and gas limit

### Test 3: Cardano → EVM
1. Create inbound + process to get bridge tokens on Cardano
2. User sends bridge tokens to outbound handler
3. Test processes outbound (burns bridge tokens, mints outbound proof at xport)
4. Test relay reads xport UTxO, calls `gateway.receiveMessageNonEvm()` on Hardhat
5. **Verifies:** outbound proof created at xport

### Test 4: Full round-trip (EVM → Cardano → EVM)
1. EVM send → lock tokens
2. Cardano inbound proof → process → bridge tokens minted
3. Cardano outbound → process → outbound proof at xport
4. Relay xport → EVM `receiveMessageNonEvm()`
5. Complete cycle verified

**Expected result:** 4/4 passing in ~70s.

## 5. Fresh start / reset

If you need to start fresh (e.g., Yaci state is corrupted):

```bash
# Reset Yaci DevKit (destroys all Cardano state)
docker compose down
docker volume rm cardano-crosschain-xport_yaci-data
docker compose up -d

# Hardhat node resets automatically on restart (in-memory state)
# Just Ctrl+C and restart: npx hardhat node
```

## Troubleshooting

### "topupAddress failed (500)"
Yaci devnet hasn't been created yet. The E2E tests handle this automatically via `createDevnet()`. If running scripts manually, first create the devnet:
```bash
curl -X POST http://localhost:10000/local-cluster/api/admin/devnet/create \
  -H "Content-Type: application/json" \
  -d '{"blockTime":"1","slotLength":"1","protocolMagic":"42"}'
```

### "BadInputsUTxO" or "ExUnitsTooBigUTxO"
Stale UTxO cache or execution budgets too high. The E2E tests handle this with fresh provider fetches and auto-collateral creation. If running scripts manually, try resetting Yaci (step 5).

### "hex data is odd-length"
CBOR test vector has wrong length. Check `evm-contracts/test/helpers/cbor-vectors.ts`.

### Hardhat "Cannot find module 'ts-node/register/transpile-only'"
Run `yarn install` in `evm-contracts/`.

### Yaci "health: starting" for > 2 minutes
Normal on first start — Yaci downloads Cardano node binaries. Wait up to 3 minutes. If stuck, check Docker logs: `docker compose logs -f`.
