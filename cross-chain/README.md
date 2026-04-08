# cross-chain

Aiken V3 validators for the Cardano side of the Wanchain cross-chain bridge. These validators handle governance, inbound/outbound message passing, replay prevention, and token minting/burning for cross-chain operations between Cardano and EVM chains.

## Validators

### Core protocol validators

| Validator | Type | Parameter | Purpose |
|-----------|------|-----------|---------|
| **group_nft** | Minting | `OutputReference` | One-shot NFT mint. Consumes a specific UTxO to guarantee uniqueness. |
| **group_nft_holder** | Spending | `GroupAdminNFTInfo` | Guards the GroupNFT UTxO that stores `GroupInfoParams` (GPK, oracle worker, validator hashes, etc.). Updates require AdminNFT or oracle worker signature. |
| **admin_nft_holder** | Spending | `AdminNftTokenInfo` | Guards the AdminNFT UTxO that stores `AdminDatum` (signatories + threshold). Enforces m-of-n multi-sig for Use/Update/Upgrade actions. |
| **check_token** | Minting | `CheckTokenParam` | Mints permission tokens (e.g. InboundCheckToken). Requires AdminNFT; minted tokens must land at the target validator specified in `GroupInfoParams`. |
| **inbound_mint_check** | Spending | `InboundMintCheckInfo` | Validates inbound cross-chain proofs. Verifies MPC signatures (Ed25519, ECDSA secp256k1, or Schnorr secp256k1) against the group public key (GPK). Enforces replay prevention via UTxO nonce and TTL expiry. |
| **inbound_token** | Minting | `CheckTokenInfo` | Mints inbound tokens representing a cross-chain message arrival. Requires a check token in inputs when minting; burning is unconditional. |
| **outbound_token** | Minting | `OutboundTokenParams` | Mints outbound tokens representing a cross-chain message departure. Requires exactly 1 token sent to the outbound holder script with a `CrossMsgData` datum. The source address must appear in tx inputs. |
| **xport** | Spending | `KeyParam` | Cross-chain gateway. Holds outbound tokens with their message datums. Spending requires a signature from the configured verification key. |

### Application validators

These validators implement the bridge token application (previously in the deleted `msg-demo/` directory). They are parameterized at deployment time and work with the core protocol validators above.

| Validator | Type | Parameter | Purpose |
|-----------|------|-----------|---------|
| **inbound_handler** | Spending | `PolicyId` (inbound token policy) | Processes inbound tasks: verifies the inbound token is present, deserializes `CrossMsgData`, mints bridge tokens to the receiver, and checks amounts match. |
| **outbound_handler** | Spending | `PolicyId` (outbound token policy) | Processes outbound tasks: burns bridge tokens, constructs `CrossMsgData` with `wmbReceiveNonEvm` call, and sends an outbound token to the XPort address. |
| **bridge_token** | Minting | `ScriptHash` (owner) + `AssetName` | Mints/burns the bridge token (e.g. DemoToken). Minting requires exactly one input from the owner script; burning is unconditional. |

## Validator parameterization chain

Validators are parameterized at deployment time. The dependency graph determines the order they must be compiled and applied:

```
group_nft(OutputReference)
    |
    v
group_nft_holder(GroupAdminNFTInfo)  <-- references group_nft + admin_nft policy IDs
    |
    v
admin_nft_holder(AdminNftTokenInfo)  <-- references admin_nft policy ID
    |
    v
check_token(CheckTokenParam)         <-- references group_nft + admin_nft + GroupInfoIndex
    |
    v
inbound_mint_check(InboundMintCheckInfo) <-- references group_nft + admin_nft + check_token + inbound mint policy
    |
    v
inbound_token(CheckTokenInfo)        <-- references check_token policy ID
outbound_token(OutboundTokenParams)  <-- references group_nft + token name
xport(KeyParam)                      <-- references a verification key hash

Application layer:
inbound_handler(PolicyId)            <-- inbound_token policy ID
outbound_handler(PolicyId)           <-- outbound_token policy ID
bridge_token(ScriptHash, AssetName)  <-- owner script hash (inbound_handler or outbound_handler)
```

## Shared types and utilities

- **`lib/cross_chain/types.ak`** -- All shared types: `GroupInfoParams`, `AdminDatum`, `CrossMsgData`, `InboundProof`, `Beneficiary`, redeemer types, and token info records.
- **`lib/cross_chain/utils.ak`** -- Helper functions: `get_group_info` (reads GroupNFT datum from reference inputs), `get_target_vh` (looks up validator hashes by index), `is_single_asset`, `value_at_address`, `outputs_at`, `total_input_value`.

## Build

Requires [Aiken](https://aiken-lang.org/) v1.1.21 or later.

```sh
cd cross-chain
aiken build
```

This compiles all validators and writes the output to `plutus.json`.

## Test

```sh
cd cross-chain
aiken check
```

Unit tests live alongside validators in `*.test.ak` files and inline `test` blocks within validator files. The inbound_mint_check mint/spend path requires real cryptographic signatures and is covered by integration tests rather than in-source unit tests.

## plutus.json

`plutus.json` is the compiled CIP-57 blueprint produced by `aiken build`. It is committed to the repository because the **msg-agent** reads it at runtime to:

1. Look up validator CBOR hex by title (e.g. `group_nft.group_nft.mint`)
2. Apply parameters (UTxO refs, policy IDs, script hashes) to produce final on-chain scripts
3. Compute policy IDs and script addresses for transaction building

The file contains 11 validators (22 entries counting the `else` fallback handlers). Any change to validator source requires re-running `aiken build` and committing the updated `plutus.json`.
