# EVM Contracts -- Wanchain Message Bridge (WMB) for Cardano

Solidity contracts that implement the EVM side of the Wanchain-Cardano cross-chain bridge. The **WmbGateway** handles general cross-chain message dispatch and verification, while **ERC20TokenHome4CardanoV2** uses it to lock/unlock ERC-20 tokens that are bridged to and from Cardano.

## Contract Architecture

```
WmbGateway (core messaging layer)
  |
  |- IWmbReceiver / IWmbReceiverNonEvm   (callback interfaces)
  |
  |- WmbApp          (base class for EVM-to-EVM apps)
  |- WmbAppV3        (base class for EVM-to-non-EVM apps, e.g. Cardano)
       |
       |- ERC20TokenHome4CardanoV2   (token bridge -- locks/unlocks ERC-20s)
```

### WmbGateway (`contracts/WmbGateway.sol`)

Central entry point for all cross-chain messaging. Deployed and managed by the Wanchain team.

- **Outbound** -- `dispatchMessage`, `dispatchMessageV2`, `dispatchMessageNonEvm`, `dispatchMessageBatch` emit events that the Storeman Group relays to the destination chain.
- **Inbound** -- `receiveMessage`, `receiveMessageNonEvm`, `receiveBatchMessage` accept messages from the Storeman Group, verify the MPC signature, then call the target contract's `wmbReceive` / `wmbReceiveNonEvm` callback.
- Uses SLIP-44 chain IDs (Cardano Preprod = `2147485463`).
- Replay protection via per-route nonces and a `messageExecuted` mapping.

### WmbAppV3 (`contracts/app/WmbAppV3.sol`)

Abstract base for applications that bridge to non-EVM chains. Handles trusted-remote validation and exposes `_dispatchMessageNonEvm` / `_wmbReceive` hooks. `ERC20TokenHome4CardanoV2` inherits from this.

### ERC20TokenHome4CardanoV2 (`contracts/examples/TokenBridgeV2/ERC20TokenHome4CardanoV2.sol`)

Token bridge between Wanchain and Cardano.

- **Outbound (Wanchain -> Cardano)** -- `send(bytes plutusData)` locks ERC-20 tokens in the contract and dispatches a CBOR-encoded PlutusData message to the Cardano TokenRemote script.
- **Inbound (Cardano -> Wanchain)** -- `_wmbReceive` decodes the incoming CBOR PlutusData, extracts the EVM receiver address and amount, and releases tokens via `safeTransfer`.

### XToken (`contracts/examples/XToken.sol`)

A minimal ERC-20 ("GXToken" / GXTK) used for testing cross-chain token transfers.

### Cardano Utilities (`contracts/cardano-utils/`)

On-chain libraries for encoding and decoding Cardano-native data structures in Solidity:

| File | Purpose |
|------|---------|
| `CBORCodec.sol` | Full RFC 8949 CBOR encoder/decoder |
| `PlutusData.sol` | Build and parse Plutus `Constr`, credentials, and addresses as CBOR |
| `CardanoAddress.sol` | Decode/encode Cardano Bech32 addresses (Base, Enterprise, Reward, Pointer) |
| `Betch32.sol` | Low-level Bech32 checksum and 5-bit conversion |

### Interfaces (`contracts/interfaces/`)

- `IWmbGateway.sol` -- Gateway dispatch/receive interface (extends EIP-5164)
- `IWmbReceiver.sol` / `IWmbReceiverNonEvm.sol` -- Callback interfaces for receiving cross-chain messages
- `IWanchainMPC.sol` -- Storeman Group config lookup and signature verification
- `IWmbConfig.sol` -- Gateway configuration interface

## Signature Verification

Cross-chain messages are secured by the **Wanchain Storeman Group**, a set of staked nodes that collectively produce **MPC (multi-party computation) signatures**.

1. The Gateway's `receiveMessage*` functions hash the incoming message fields.
2. `_acquireReadySmgInfo(smgID)` fetches the Storeman Group's public key and validates the group is in `ready` status.
3. `_verifyMpcSignature` calls the on-chain `signatureVerifier` precompile (set during `initialize`) to verify the Schnorr signature `(r, s)` against the group public key and message hash.
4. Only after verification does the Gateway deliver the message to the target contract.

In tests, the Storeman Group contracts are not available on Hardhat's local network, so the test scripts connect to the Wanchain testnet where the real Gateway and Storeman infrastructure are already deployed.

## Build

```bash
npm install        # or: yarn
npx hardhat compile
```

Compiler settings (from `hardhat.config.js`):
- Solidity 0.8.18 (optimizer 200 runs) -- used by WmbGateway and related contracts
- Solidity 0.8.20 (optimizer 200 runs, EVM target `london`) -- used by WmbAppV3 and cardano-utils

## Testing

The test scripts run against the **Wanchain testnet** (not a local Hardhat network), because they interact with the deployed Gateway and Storeman Group infrastructure.

```bash
# Outbound: send tokens from Wanchain to a Cardano address
PK=<your-private-key> npx hardhat --network wanchainTestnet test test/TestMsgTask4Outbound.js

# Inbound: simulate receiving tokens from Cardano
PK=<your-private-key> npx hardhat --network wanchainTestnet test test/TestMsgTask4Inboundjs

# Token transfer: transfer test tokens between accounts
PK=<your-private-key> npx hardhat --network wanchainTestnet test test/TestMsgTask4TransferToken.js
```

Set the `PK` environment variable to a funded Wanchain testnet private key.

## Deployment Scripts

All scripts are under `scripts/` and target the Wanchain testnet:

| Script | Purpose |
|--------|---------|
| `deploy_XToken_forTest.js` | Deploy the GXToken ERC-20 test token |
| `deploy_tokenHome4ada.js` | Deploy `ERC20TokenHome4CardanoV2` (requires Gateway and XToken addresses) |
| `config_tokenHome4ada.js` | Configure inbound/outbound Cardano TokenRemote peer addresses on TokenHome |

Run a deployment script:

```bash
PK=<your-private-key> npx hardhat --network wanchainTestnet run scripts/deploy_tokenHome4ada.js
```

## Deployed Addresses

### Wanchain Testnet (`deployed/wanTestnet.json`)

| Contract | Address |
|----------|---------|
| XToken (GXToken) | `0x0B40EF8f0bA69C39f8dD7Eeab073275c72593aa2` |
| WmbGateway | `0xDDddd58428706FEdD013b3A761c6E40723a7911d` |
| TokenHome | `0xd6Ed4F1F50Cae0c5c7F514F3D0B1220c4a78F71d` |

### Cardano Preprod Peers (`deployed/cardanoPreprod.json`)

| Role | Address |
|------|---------|
| Inbound TokenRemote | `addr_test1wqzjepm5l3jepgqv42h292u56l5fcsuz8q6j6qtwyvldusq4qmy4n` |
| Outbound TokenRemote | `addr_test1wzu6ldpnxd7gdc0h5fyrt53utrk6ynudl6w304wc2sh7u9c3vl5le` |

Pre-built ABIs are available in `deployed/scAbi/`.

## Demo Transactions

### Wanchain -> Cardano

- [0x5120c4...](https://testnet.wanscan.org/tx/0x5120c402cf2b3e5065d5fa5f5b07a94c00b003c0df57c730c243419a12c65161?type=msg)
- [0x7c1d28...](https://testnet.wanscan.org/tx/0x7c1d28e7c30bf866caa010a25cd72843b6dd6daf8a315d60af7206df32da8c2c?type=msg)
- [0x5f5f38...](https://testnet.wanscan.org/tx/0x5f5f386b902ea4b157e8fd615b48e4c5b38e93a9833a1f7dfc506b795380941a?type=msg)

### Cardano -> Wanchain

- [d9faa3...](https://testnet.wanscan.org/tx/d9faa3ee8779f61539a9dd4626212c8be5572fca2ced3d11432d4e8e63c61a79?type=msg)
- [51e046...](https://testnet.wanscan.org/tx/51e04e670a4aefd9c580e1f3e1200e0da561b11c2dd3d0da2c9581e173a9904c?type=msg)

## License

MIT
