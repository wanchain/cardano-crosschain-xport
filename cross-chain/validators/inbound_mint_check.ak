use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{Finite}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use cross_chain/types.{
  AdminNftTokenInfo, BurnInboundCheckToken, CheckTokenInfo, CrossMsgData,
  GroupAdminNFTCheckTokenInfo, GroupNFTTokenInfo, InboundCheckRedeemer,
  InboundMintCheckInfo, InboundProof, LocalAddress,
}
use cross_chain/utils.{get_group_info, is_single_asset}

// ── helpers ──────────────────────────────────────────────────────────────────

/// InboundMintCheck — spending validator for inbound cross-chain check tokens
///
/// Parameter: InboundMintCheckInfo { gact: GroupAdminNFTCheckTokenInfo, mint_policy: PolicyId }
///
/// Datum: Unit
///
/// Redeemer: InboundCheckRedeemer
///   BurnInboundCheckToken   — AdminNFT in inputs; zero check tokens in outputs
///   InboundCheckRedeemer(proof) — full inbound proof path
///
/// InboundCheckRedeemer(proof) checks:
///   1. hasUTxO        — proof.proof_data.nonce == own OutputReference (replay prevention)
///   2. checkToken     — exactly 1 check token in outputs at stk_vh script (single asset)
///   3. checkSignature — hash = sha3_256(serialise(proof_data)); verify against GPK
///   4. checkOutput    — output at target with CrossMsgData datum; single mint_policy asset
///   5. mintValue      — exactly 1 mint_policy token minted with name == target VH bytes
///   6. checkTtl       — proof_data.ttl + 1 > tx validity range upper bound
/// Sum a token across all outputs (mirrors Haskell valueProduced + valueOf).
fn value_produced(tx: Transaction, cs: PolicyId, tn: ByteArray) -> Int {
  list.foldl(tx.outputs, 0, fn(o, acc) { acc + quantity_of(o.value, cs, tn) })
}

/// Filter outputs at a specific address whose inline datum matches the given
/// CrossMsgData. Returns all matching outputs (caller should assert exactly one).
fn script_outputs_at2(
  outputs: List<Output>,
  addr: Address,
  expected_msg: CrossMsgData,
) -> List<Output> {
  list.filter(
    outputs,
    fn(o) {
      if o.address == addr {
        when o.datum is {
          InlineDatum(raw) -> {
            expect d: CrossMsgData = raw
            d == expected_msg
          }
          _ -> False
        }
      } else {
        False
      }
    },
  )
}

// ── burn path ─────────────────────────────────────────────────────────────────

fn burn_token_check(info: InboundMintCheckInfo, tx: Transaction) -> Bool {
  let InboundMintCheckInfo { gact, .. } = info
  let admin = gact.admin_nft
  let check = gact.check_token

  // AdminNFT must appear exactly once in total inputs
  let total_input_value =
    list.foldl(
      tx.inputs,
      assets.zero,
      fn(i, acc) { assets.merge(acc, i.output.value) },
    )

  let has_admin_nft_in_input =
    quantity_of(total_input_value, admin.admin_nft_symbol, admin.admin_nft_name) == 1

  // Zero check tokens may appear in outputs (all must be burned)
  let check_output =
    value_produced(tx, check.check_token_symbol, check.check_token_name) == 0

  has_admin_nft_in_input && check_output
}

// ── mint / spend path ─────────────────────────────────────────────────────────

fn mint_spend_check(
  info: InboundMintCheckInfo,
  proof: InboundProof,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  let InboundMintCheckInfo { gact, mint_policy } = info
  let group_nft = gact.group_nft
  let check = gact.check_token

  let InboundProof { proof_data, signature } = proof

  // ── 1. hasUTxO — replay prevention ───────────────────────────────────────
  let has_utxo = proof_data.nonce == own_ref

  // ── GroupInfoParams from reference input ──────────────────────────────────
  let group_info =
    get_group_info(list.map(tx.reference_inputs, fn(i) { i.output }), group_nft)

  let stk_vh = group_info.stk_vh

  // ── 2. check token in own output at stk_vh ────────────────────────────────
  // Must be exactly 1 check token at the stk_vh script, with single-asset value
  let outputs_at_stk =
    list.filter(
      tx.outputs,
      fn(o) {
        when o.address.payment_credential is {
          Script(h) -> h == stk_vh
          _ -> False
        }
      },
    )

  // Mirrors Haskell getAmountOfCheckTokeninOwnOutput:
  // sum check tokens at stk, and assert single-asset per the isSingleAsset check
  let (check_token_amount_at_stk, all_single_asset) =
    list.foldl(
      outputs_at_stk,
      (0, True),
      fn(o, acc) {
        let (total, ok) = acc
        let amt =
          quantity_of(o.value, check.check_token_symbol, check.check_token_name)
        let single =
          is_single_asset(
            o.value,
            check.check_token_symbol,
            check.check_token_name,
          )
        (total + amt, ok && single)
      },
    )

  let amount_of_check_token_in_own_output =
    if all_single_asset {
      check_token_amount_at_stk
    } else {
      fail @"check token output must contain only the check token and ADA"
    }

  let check_token_ok = amount_of_check_token_in_own_output == 1

  // ── 3. checkSignature ────────────────────────────────────────────────────
  let hash_redeemer = builtin.sha3_256(builtin.serialise_data(proof_data))

  let gpk = group_info.gpk
  let mode = proof_data.mode

  let check_signature =
    if mode == 0 {
      builtin.verify_ecdsa_secp256k1_signature(gpk, hash_redeemer, signature)
    } else if mode == 1 {
      builtin.verify_schnorr_secp256k1_signature(gpk, hash_redeemer, signature)
    } else if mode == 2 {
      builtin.verify_ed25519_signature(gpk, hash_redeemer, signature)
    } else {
      fail @"unknown signature mode"
    }

  // ── 4. checkOutput ───────────────────────────────────────────────────────
  let cross_msg_d = proof_data.cross_msg_data

  // target must be a LocalAddress
  expect LocalAddress(msg_consumer) = cross_msg_d.target_contract

  // Extract the target validator hash from the target address
  let target_vh =
    when msg_consumer.payment_credential is {
      Script(h) -> h
      _ -> fail @"target contract must be a script"
    }

  // Find outputs at msg_consumer with the CrossMsgData inline datum
  let matching_outputs =
    script_outputs_at2(tx.outputs, msg_consumer, cross_msg_d)

  let check_output =
    when matching_outputs is {
      [o] -> is_single_asset(o.value, mint_policy, target_vh)
      _ -> False
    }

  // ── 5. mintValue ─────────────────────────────────────────────────────────
  let mint_value = quantity_of(tx.mint, mint_policy, target_vh)

  let mint_ok = mint_value == 1

  // ── 6. checkTtl ──────────────────────────────────────────────────────────
  // Haskell: (POSIXTime (ttl + 1)) `after` txInfoValidRange
  // `after t range` means t is strictly after the upper bound of range,
  // i.e. range.upper.bound < t, i.e. ttl + 1 > upper_bound
  let check_ttl =
    when tx.validity_range.upper_bound.bound_type is {
      Finite(upper) -> proof_data.ttl + 1 > upper
      _ -> False
    }

  has_utxo && check_token_ok && check_signature && check_output && mint_ok && check_ttl
}

// ── validator ─────────────────────────────────────────────────────────────────

validator inbound_mint_check(param: InboundMintCheckInfo) {
  spend(
    _datum: Option<Data>,
    redeemer: InboundCheckRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    when redeemer is {
      BurnInboundCheckToken -> burn_token_check(param, tx)
      InboundCheckRedeemer(proof) -> mint_spend_check(param, proof, own_ref, tx)
    }
  }

  else(_) {
    fail
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
//
// The burn path (`burn_token_check`) is tested directly — it is a plain
// function and does not need any crypto primitives.
//
// The mint/spend path (`mint_spend_check`) requires a real ECDSA/Schnorr/Ed25519
// signature computed off-chain because it calls
// `builtin.verify_ecdsa_secp256k1_signature` (and friends) against a live GPK.
// Aiken's test runtime executes the compiled Plutus bytecode exactly as the
// node would, so there is no way to bypass signature verification without a
// genuinely valid key-pair.  Generating such a pair requires off-chain tooling
// (e.g. `cardano-crypto` or a secp256k1 library) and is outside the scope of
// unit tests that live inside the validator source.  The mint/spend path is
// therefore covered only by integration/property tests that supply real
// proof fixtures.

// ── test constants ────────────────────────────────────────────────────────────

const admin_policy: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const admin_name: ByteArray = #"41444d494e4e4654"

const group_policy: ByteArray =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const group_name: ByteArray = #"47524f55504e4654"

const check_policy: ByteArray =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const check_name: ByteArray = #"436865636b546f6b656e"

// The mint_policy field — the inbound token minting policy
const mint_policy: ByteArray =
  #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

// ── test helpers ──────────────────────────────────────────────────────────────

fn base_tx() -> Transaction {
  Transaction {
    inputs: [],
    reference_inputs: [],
    outputs: [],
    fee: 0,
    mint: assets.zero,
    certificates: [],
    withdrawals: [],
    validity_range: interval.everything,
    extra_signatories: [],
    redeemers: [],
    datums: dict.empty,
    id: #"0000000000000000000000000000000000000000000000000000000000000000",
    votes: [],
    proposal_procedures: [],
    current_treasury_amount: None,
    treasury_donation: None,
  }
}

fn oref(idx: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
    output_index: idx,
  }
}

fn inbound_param() -> InboundMintCheckInfo {
  InboundMintCheckInfo {
    gact: GroupAdminNFTCheckTokenInfo {
      group_nft: GroupNFTTokenInfo {
        group_nft_symbol: group_policy,
        group_nft_name: group_name,
      },
      admin_nft: AdminNftTokenInfo {
        admin_nft_symbol: admin_policy,
        admin_nft_name: admin_name,
      },
      check_token: CheckTokenInfo {
        check_token_symbol: check_policy,
        check_token_name: check_name,
      },
    },
    mint_policy,
  }
}

// Input that carries exactly 1 AdminNFT
fn admin_nft_input() -> Input {
  Input {
    output_reference: oref(99),
    output: Output {
      address: Address {
        payment_credential: VerificationKey(
          #"9999999999999999999999999999999999999999999999999999999999999999",
        ),
        stake_credential: None,
      },
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(admin_policy, admin_name, 1),
      ),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

// ── test: burn path — AdminNFT present, zero check tokens in outputs → ok ─────

test test_burn_path_succeeds() {
  // No check-token outputs, admin NFT in inputs
  let tx = Transaction { ..base_tx(), inputs: [admin_nft_input()], outputs: [] }
  burn_token_check(inbound_param(), tx)
}

// ── test: burn path — AdminNFT absent → rejected ──────────────────────────────

test test_burn_fails_without_admin() {
  // Input has ADA only — no AdminNFT
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [
        Input {
          output_reference: oref(1),
          output: Output {
            address: Address {
              payment_credential: VerificationKey(
                #"8888888888888888888888888888888888888888888888888888888888888888",
              ),
              stake_credential: None,
            },
            value: assets.from_lovelace(5_000_000),
            datum: NoDatum,
            reference_script: None,
          },
        },
      ],
      outputs: [],
    }
  !burn_token_check(inbound_param(), tx)
}

// ── test: burn path — check token leaks to an output → rejected ───────────────

test test_burn_fails_with_check_token_in_output() {
  // AdminNFT is present but a check token escapes to an output
  let check_output =
    Output {
      address: Address {
        payment_credential: VerificationKey(
          #"7777777777777777777777777777777777777777777777777777777777777777",
        ),
        stake_credential: None,
      },
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(check_policy, check_name, 1),
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [admin_nft_input()],
      outputs: [check_output],
    }
  !burn_token_check(inbound_param(), tx)
}

// ── test: burn path — two outputs each carry 1 check token → rejected ─────────

test test_burn_multiple_check_tokens_in_outputs() {
  // Two distinct outputs each containing 1 check token.
  // value_produced sums to 2, so check_output (== 0) is False.
  let check_out_1 =
    Output {
      address: Address {
        payment_credential: VerificationKey(
          #"1111111111111111111111111111111111111111111111111111111111111111",
        ),
        stake_credential: None,
      },
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(check_policy, check_name, 1),
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let check_out_2 =
    Output {
      address: Address {
        payment_credential: VerificationKey(
          #"2222222222222222222222222222222222222222222222222222222222222222",
        ),
        stake_credential: None,
      },
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(check_policy, check_name, 1),
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [admin_nft_input()],
      outputs: [check_out_1, check_out_2],
    }
  // value_produced returns 2; the burn path requires 0 → must reject.
  !burn_token_check(inbound_param(), tx)
}

// ── test: burn path — AdminNFT input has qty=2 → rejected ────────────────────

test test_burn_admin_nft_qty_two() {
  // Input carries qty=2 AdminNFT tokens.
  // has_admin_nft_in_input checks == 1, so it evaluates to False.
  let double_admin_input =
    Input {
      output_reference: oref(98),
      output: Output {
        address: Address {
          payment_credential: VerificationKey(
            #"9999999999999999999999999999999999999999999999999999999999999999",
          ),
          stake_credential: None,
        },
        value: assets.merge(
          assets.from_lovelace(2_000_000),
          assets.from_asset(admin_policy, admin_name, 2),
        ),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    Transaction { ..base_tx(), inputs: [double_admin_input], outputs: [] }
  // qty == 2, not 1 → has_admin_nft_in_input is False → must reject.
  !burn_token_check(inbound_param(), tx)
}
// ── NOTE: mint/spend path tests (InboundCheckRedeemer) ───────────────────────
//
// `mint_spend_check` calls `builtin.verify_ecdsa_secp256k1_signature`,
// `builtin.verify_schnorr_secp256k1_signature`, and
// `builtin.verify_ed25519_signature` directly.  The Aiken test runner
// evaluates compiled Plutus bytecode, so there is no mock-able seam —
// a valid signature over the exact serialised InboundProofData is required.
//
// To test this path:
//   1. Generate a secp256k1 key-pair (or ed25519) off-chain.
//   2. Construct an InboundProofData value, CBOR-serialise it (same encoding
//      Aiken's `builtin.serialise_data` produces), hash with SHA3-256.
//   3. Sign the hash and embed the signature + public key as test constants.
//
// That fixture-generation step belongs in an integration-test harness
// (e.g. a TypeScript/Node script using @noble/curves) rather than here.
// The three burn-path tests above cover all code paths that do NOT require
// crypto, giving meaningful unit coverage of the validator.
