use aiken/collection/dict
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use cross_chain/types.{
  AdminActionRedeemer, AdminDatum, AdminNftTokenInfo, Update, Upgrade, Use,
}

/// AdminNFTHolder — spending validator for the AdminNFT UTxO
///
/// Parameter: AdminNftTokenInfo { admin_nft_symbol, admin_nft_name }
///
/// Datum: Unit (real state carried as inline AdminDatum)
///
/// Redeemer: AdminActionRedeemer
///   Use    — multi-sig check only; NFT stays at same script or goes to pubkey; datum unchanged
///   Update — multi-sig check; NFT stays at same script or goes to pubkey; new datum must be valid
///   Upgrade — multi-sig check; NFT must move to a different script or pubkey
///
/// Checks:
///   isAuthorized          — >= minNumSignatures present signatories have signed
///   inputHasAdminNFT      — own input holds AdminNFT (qty == 1)
///   checkAdminNFTOwnerInOutput — correct address logic per action
///   isDatumCorrect        — datum validity per action
/// Extract AdminDatum from an inline datum.
fn admin_datum(output: Output) -> AdminDatum {
  expect InlineDatum(raw) = output.datum
  expect d: AdminDatum = raw
  d
}

/// Structural equality for AdminDatum.
fn admin_datum_eq(a: AdminDatum, b: AdminDatum) -> Bool {
  a.signatories == b.signatories && a.min_num_signatures == b.min_num_signatures
}

validator admin_nft_holder(param: AdminNftTokenInfo) {
  spend(
    _datum: Option<Data>,
    action: AdminActionRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    let AdminNftTokenInfo { admin_nft_symbol, admin_nft_name } = param

    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == own_ref })

    let own_hash =
      when own_input.output.address.payment_credential is {
        Script(h) -> h
        _ -> fail @"own input must be a script"
      }

    let admin_nft_value =
      fn(o: Output) -> Int {
        quantity_of(o.value, admin_nft_symbol, admin_nft_name)
      }

    let datum_in = admin_datum(own_input.output)

    let signers_present =
      list.length(
        list.filter(
          datum_in.signatories,
          fn(pkh) { list.has(tx.extra_signatories, pkh) },
        ),
      )

    let is_authorized = signers_present >= datum_in.min_num_signatures

    let input_has_admin_nft = admin_nft_value(own_input.output) == 1

    let outputs_with_nft =
      list.filter(tx.outputs, fn(o) { admin_nft_value(o) == 1 })

    expect [admin_nft_output] = outputs_with_nft

    let check_admin_nft_owner_in_output =
      when admin_nft_output.address.payment_credential is {
        Script(s) ->
          when action is {
            Update -> s == own_hash
            Use -> s == own_hash
            // Upgrade: must move to a different script
            Upgrade -> s != own_hash
          }
        // PubKey output is always valid regardless of action
        _ -> True
      }

    let is_datum_correct =
      when action is {
        // Use: datum must be identical to the input datum
        Use -> admin_datum_eq(datum_in, admin_datum(admin_nft_output))
        // Update: new datum must be structurally valid
        Update -> {
          let new_d = admin_datum(admin_nft_output)
          let min_count = new_d.min_num_signatures
          let total_count = list.length(new_d.signatories)
          total_count >= min_count && min_count > 0
        }
        // Upgrade: any inline datum is accepted (checked structurally below)
        Upgrade ->
          when admin_nft_output.address.payment_credential is {
            Script(_) -> {
              // Must have an inline datum on the script output
              expect InlineDatum(_) = admin_nft_output.datum
              True
            }
            // PubKey output: no datum constraint
            _ -> True
          }
      }
    // for trace info
    is_authorized? && input_has_admin_nft? && check_admin_nft_owner_in_output? && is_datum_correct?
  }

  else(_) {
    fail
  }
}

// ── test constants ────────────────────────────────────────────────────────────

const admin_nft_policy: ByteArray =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const admin_nft_token_name: ByteArray = #"41444d494e4e4654"

// Script hash of the AdminNFT holder (the "own" script)
const own_script_hash: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

// A different script hash used for Upgrade tests
const other_script_hash: ByteArray =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const signer_a: ByteArray =
  #"1111111111111111111111111111111111111111111111111111111111111111"

const signer_b: ByteArray =
  #"2222222222222222222222222222222222222222222222222222222222222222"

const signer_c: ByteArray =
  #"3333333333333333333333333333333333333333333333333333333333333333"

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

fn own_addr() -> Address {
  Address {
    payment_credential: Script(own_script_hash),
    stake_credential: None,
  }
}

fn other_addr() -> Address {
  Address {
    payment_credential: Script(other_script_hash),
    stake_credential: None,
  }
}

// The AdminNFT UTxO being spent
fn make_admin_nft_input(ref: OutputReference, datum: AdminDatum) -> Input {
  Input {
    output_reference: ref,
    output: Output {
      address: own_addr(),
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(admin_nft_policy, admin_nft_token_name, 1),
      ),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

// Output that returns the AdminNFT to the same own script
fn admin_nft_output_same(datum: AdminDatum) -> Output {
  Output {
    address: own_addr(),
    value: assets.merge(
      assets.from_lovelace(2_000_000),
      assets.from_asset(admin_nft_policy, admin_nft_token_name, 1),
    ),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

// Output that moves the AdminNFT to a different script (used for Upgrade)
fn admin_nft_output_other(datum: AdminDatum) -> Output {
  Output {
    address: other_addr(),
    value: assets.merge(
      assets.from_lovelace(2_000_000),
      assets.from_asset(admin_nft_policy, admin_nft_token_name, 1),
    ),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn validate_admin_nft_holder(
  param: AdminNftTokenInfo,
  action: AdminActionRedeemer,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  let AdminNftTokenInfo { admin_nft_symbol, admin_nft_name } = param

  expect Some(own_input) =
    list.find(tx.inputs, fn(i) { i.output_reference == own_ref })

  let own_hash =
    when own_input.output.address.payment_credential is {
      Script(h) -> h
      _ -> fail @"own input must be a script"
    }

  let nft_qty =
    fn(o: Output) -> Int {
      quantity_of(o.value, admin_nft_symbol, admin_nft_name)
    }

  let datum_in = admin_datum(own_input.output)

  let signers_present =
    list.length(
      list.filter(
        datum_in.signatories,
        fn(pkh) { list.has(tx.extra_signatories, pkh) },
      ),
    )

  let is_authorized = signers_present >= datum_in.min_num_signatures

  let input_has_admin_nft = nft_qty(own_input.output) == 1

  expect [admin_out] = list.filter(tx.outputs, fn(o) { nft_qty(o) == 1 })

  let check_owner =
    when admin_out.address.payment_credential is {
      Script(s) ->
        when action is {
          Update -> s == own_hash
          Use -> s == own_hash
          Upgrade -> s != own_hash
        }
      _ -> True
    }

  let check_datum =
    when action is {
      Use -> admin_datum_eq(datum_in, admin_datum(admin_out))
      Update -> {
        let new_d = admin_datum(admin_out)
        let min = new_d.min_num_signatures
        list.length(new_d.signatories) >= min && min > 0
      }
      Upgrade ->
        when admin_out.address.payment_credential is {
          Script(_) -> {
            expect InlineDatum(_) = admin_out.datum
            True
          }
          _ -> True
        }
    }

  is_authorized && input_has_admin_nft && check_owner && check_datum
}

fn admin_param() -> AdminNftTokenInfo {
  AdminNftTokenInfo {
    admin_nft_symbol: admin_nft_policy,
    admin_nft_name: admin_nft_token_name,
  }
}

fn two_of_three_datum() -> AdminDatum {
  AdminDatum {
    signatories: [signer_a, signer_b, signer_c],
    min_num_signatures: 2,
  }
}

test test_multisig_passes_threshold() {
  let ref = oref(0)
  let datum = two_of_three_datum()
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum)],
      outputs: [admin_nft_output_same(datum)],
      // signer_a and signer_b signed; threshold is 2
      extra_signatories: [signer_a, signer_b],
    }
  validate_admin_nft_holder(admin_param(), Use, ref, tx)
}

test test_multisig_fails_below_threshold() {
  let ref = oref(0)
  let datum = two_of_three_datum()
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum)],
      outputs: [admin_nft_output_same(datum)],
      extra_signatories: [signer_a],
    }
  !validate_admin_nft_holder(admin_param(), Use, ref, tx)
}

test test_use_preserves_datum() {
  let ref = oref(0)
  let datum = two_of_three_datum()
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum)],
      outputs: [admin_nft_output_same(datum)],
      extra_signatories: [signer_a, signer_b],
    }
  validate_admin_nft_holder(admin_param(), Use, ref, tx)
}

test test_use_rejects_changed_datum() {
  let ref = oref(0)
  let datum_in = two_of_three_datum()
  // Output datum has a different threshold — Use must reject this
  let datum_out =
    AdminDatum {
      signatories: [signer_a, signer_b, signer_c],
      min_num_signatures: 3,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum_in)],
      outputs: [admin_nft_output_same(datum_out)],
      extra_signatories: [signer_a, signer_b],
    }
  !validate_admin_nft_holder(admin_param(), Use, ref, tx)
}

test test_update_allows_new_datum() {
  let ref = oref(0)
  let datum_in = two_of_three_datum()
  // New datum: only 2 signatories, threshold 1 — still structurally valid
  let datum_out =
    AdminDatum { signatories: [signer_a, signer_b], min_num_signatures: 1 }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum_in)],
      outputs: [admin_nft_output_same(datum_out)],
      extra_signatories: [signer_a, signer_b],
    }
  validate_admin_nft_holder(admin_param(), Update, ref, tx)
}

test test_upgrade_requires_different_script() {
  let ref = oref(0)
  let datum = two_of_three_datum()
  // Output goes to `other_addr()` which has a different script hash
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum)],
      outputs: [admin_nft_output_other(datum)],
      extra_signatories: [signer_a, signer_b],
    }
  validate_admin_nft_holder(admin_param(), Upgrade, ref, tx)
}

test test_upgrade_rejects_same_script() {
  let ref = oref(0)
  let datum = two_of_three_datum()
  // Output stays at own_addr() — Upgrade requires a different address
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum)],
      outputs: [admin_nft_output_same(datum)],
      extra_signatories: [signer_a, signer_b],
    }
  !validate_admin_nft_holder(admin_param(), Upgrade, ref, tx)
}

fn pubkey_addr() -> Address {
  Address {
    payment_credential: VerificationKey(
      #"5555555555555555555555555555555555555555555555555555555555555555",
    ),
    stake_credential: None,
  }
}

fn admin_nft_output_pubkey(datum: AdminDatum) -> Output {
  Output {
    address: pubkey_addr(),
    value: assets.merge(
      assets.from_lovelace(2_000_000),
      assets.from_asset(admin_nft_policy, admin_nft_token_name, 1),
    ),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

// Use action — AdminNFT output goes to a PubKey address → accepted.
// PubKey is always valid for any action; datum must still be identical for Use.

test test_use_to_pubkey_output() {
  let ref = oref(0)
  let datum = two_of_three_datum()
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum)],
      outputs: [admin_nft_output_pubkey(datum)],
      extra_signatories: [signer_a, signer_b],
    }
  validate_admin_nft_holder(admin_param(), Use, ref, tx)
}

// Update action — AdminNFT output goes to a PubKey address → accepted.
// PubKey short-circuits check_owner; datum just needs to be structurally valid.

test test_update_to_pubkey_output() {
  let ref = oref(0)
  let datum_in = two_of_three_datum()
  let datum_out =
    AdminDatum { signatories: [signer_a, signer_b], min_num_signatures: 1 }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum_in)],
      outputs: [admin_nft_output_pubkey(datum_out)],
      extra_signatories: [signer_a, signer_b],
    }
  validate_admin_nft_holder(admin_param(), Update, ref, tx)
}

// Upgrade action — AdminNFT output goes to a PubKey address → accepted.
// check_owner returns True (PubKey branch); datum unconstrained.

test test_upgrade_to_pubkey_output() {
  let ref = oref(0)
  let datum = two_of_three_datum()
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum)],
      outputs: [admin_nft_output_pubkey(datum)],
      extra_signatories: [signer_a, signer_b],
    }
  validate_admin_nft_holder(admin_param(), Upgrade, ref, tx)
}

// Update action — new datum has min_num_signatures=0 → rejected.
// `min > 0` is enforced in the Update datum check.

test test_update_rejects_zero_threshold() {
  let ref = oref(0)
  let datum_in = two_of_three_datum()
  // Invalid: threshold is 0
  let datum_out =
    AdminDatum {
      signatories: [signer_a, signer_b, signer_c],
      min_num_signatures: 0,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum_in)],
      outputs: [admin_nft_output_same(datum_out)],
      extra_signatories: [signer_a, signer_b],
    }
  !validate_admin_nft_holder(admin_param(), Update, ref, tx)
}

// Update action — threshold exceeds signatory count → rejected.
// `length(signatories) >= min` is enforced: 1 signatory but min=2 must fail.

test test_update_rejects_threshold_exceeds_signatories() {
  let ref = oref(0)
  let datum_in = two_of_three_datum()
  // Invalid: only 1 signatory but min_num_signatures=2
  let datum_out = AdminDatum { signatories: [signer_a], min_num_signatures: 2 }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum_in)],
      outputs: [admin_nft_output_same(datum_out)],
      extra_signatories: [signer_a, signer_b],
    }
  !validate_admin_nft_holder(admin_param(), Update, ref, tx)
}

// own input has no AdminNFT → input_has_admin_nft fails.
// The AdminNFT may be in another input, but the check is specifically against the own input.

test test_input_missing_admin_nft() {
  let ref = oref(0)
  let datum = two_of_three_datum()
  // Own input: ADA only, no AdminNFT
  let bare_input =
    Input {
      output_reference: ref,
      output: Output {
        address: own_addr(),
        value: assets.from_lovelace(2_000_000),
        datum: InlineDatum(datum),
        reference_script: None,
      },
    }
  // A separate input carries the AdminNFT (but it is NOT the own input)
  let other_nft_input =
    Input {
      output_reference: oref(99),
      output: Output {
        address: own_addr(),
        value: assets.merge(
          assets.from_lovelace(2_000_000),
          assets.from_asset(admin_nft_policy, admin_nft_token_name, 1),
        ),
        datum: InlineDatum(datum),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [bare_input, other_nft_input],
      // The NFT output still satisfies the single-output-with-nft requirement
      outputs: [admin_nft_output_same(datum)],
      extra_signatories: [signer_a, signer_b],
    }
  !validate_admin_nft_holder(admin_param(), Use, ref, tx)
}

test test_threshold_exactly_met() {
  let ref = oref(0)
  // All three are required (min=3)
  let datum =
    AdminDatum {
      signatories: [signer_a, signer_b, signer_c],
      min_num_signatures: 3,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [make_admin_nft_input(ref, datum)],
      outputs: [admin_nft_output_same(datum)],
      extra_signatories: [signer_a, signer_b, signer_c],
    }
  validate_admin_nft_holder(admin_param(), Use, ref, tx)
}
