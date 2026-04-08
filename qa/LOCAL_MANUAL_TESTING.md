# Local Manual Testing — Happy Paths

Step-by-step guide to manually test the cross-chain bridge using the actual msg-agent monitor on local devnets.

## Setup

### 1. Start Yaci DevKit

```bash
# From repo root
docker compose up -d
```

Wait for healthy status: `docker compose ps`

### 2. Deploy validators and generate .env

```bash
cd msg-agent
yarn install
yarn deploy:local
```

This deploys all Aiken V3 validators on Yaci and writes `.env.local` with every env var the msg-agent needs.

### 3. Activate the local config

```bash
cp .env.local .env
```

To switch back to preprod later: `cp .env.preprod .env`

### 4. Verify the deployment

```bash
npx ts-node ../qa/scripts/check-state.ts
```

This shows wallet balances, script addresses, UTxOs, and token policies. You should see:
- 3 funded wallets (~10k ADA each)
- GroupNFTHolder with 1 UTxO (the GroupNFT)
- Empty inbound/outbound handler addresses
- Empty XPort

---

## Happy Path 1: EVM → Cardano (Inbound)

A message arrives from EVM. The Storeman Group creates a proof on Cardano. The msg-agent monitor detects it and mints bridge tokens to the receiver.

### Terminal A: Start the monitor

```bash
cd msg-agent
yarn start
```

Leave this running. It prints all script addresses on startup and polls every 5 seconds.

### Terminal B: Create an inbound proof (simulates Storeman relay)

```bash
cd msg-agent
npx ts-node ../qa/scripts/create-inbound-proof.ts
```

Or with a custom receiver and amount:

```bash
RECEIVER=addr_test1q... AMOUNT=5000 npx ts-node ../qa/scripts/create-inbound-proof.ts
```

### Watch Terminal A

The monitor should detect the inbound token UTxO and log:

```
Begin to excute INBOUND task:[...] receiver:addr_test1q... amount:10000
```

It will then:
1. Burn the inbound token
2. Mint bridge tokens to the receiver
3. Log the transaction hash

### Verify

```bash
npx ts-node ../qa/scripts/check-state.ts
```

You should see:
- Wallet 3 (receiver) now has bridge tokens
- Inbound handler is empty (UTxO consumed)

---

## Happy Path 2: Cardano → EVM (Outbound)

A user sends bridge tokens back to EVM. The msg-agent monitor detects the outbound task and creates a proof at XPort.

**Prerequisite:** Complete Happy Path 1 first (wallet 3 needs bridge tokens).

### Terminal A: Monitor should still be running

If not: `cd msg-agent && yarn start`

### Terminal B: Create an outbound task

```bash
cd msg-agent
yarn client
```

This sends bridge tokens from wallet 3 to the outbound handler with a Beneficiary datum targeting the EVM receiver address (from `.env`).

### Watch Terminal A

The monitor should detect the bridge tokens at the outbound handler and log:

```
Begin to excute OUTBOUND task:[...] receiver:0x... amount:100
```

It will then:
1. Burn the bridge tokens
2. Mint an outbound token + CrossMsgData datum at XPort
3. Log the transaction hash

### Verify

```bash
npx ts-node ../qa/scripts/check-state.ts
```

You should see:
- XPort has 1 UTxO with an outbound token and datum
- Outbound handler is empty (UTxO consumed)
- Wallet 3's bridge tokens reduced

In production, a Storeman Group relay would pick up the XPort UTxO and call `gateway.receiveMessageNonEvm()` on EVM.

---

## Happy Path 3: Full Round-Trip

Run Happy Path 1, then Happy Path 2 in sequence:

1. Create inbound proof → monitor mints bridge tokens
2. `yarn client` → monitor creates outbound proof at XPort
3. Verify XPort has the proof, bridge tokens are burned

---

## Checking state at any point

```bash
npx ts-node ../qa/scripts/check-state.ts
```

Or use the Yaci block explorer: http://localhost:5173

---

## Fresh start

```bash
# Reset everything
docker compose down
docker volume rm cardano-crosschain-xport_yaci-data
docker compose up -d

# Redeploy
cd msg-agent
yarn deploy:local
cp .env.local .env
```

---

## Troubleshooting

### Monitor says "No UTxOs found" or doesn't detect tasks
- Check that `.env` has the correct `CHECK_TOKEN_SYMBOL`, `GROUP_NFT_SYMBOL`, etc.
- Run `check-state.ts` to verify the script addresses match what the monitor printed on startup

### "UTxO Balance Insufficient"
- The wallet ran out of ADA from previous test runs. Reset Yaci (see "Fresh start" above)

### "No collateral available"
- The wallet needs a collateral UTxO. The deploy script creates one automatically, but it may have been consumed. Reset and redeploy.

### Monitor processes task but tx fails
- Check the error for `ExUnitsTooBigUTxO` (budget too high) or `BadInputsUTxO` (stale UTxO). Reset and redeploy.
