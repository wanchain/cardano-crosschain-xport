use aiken/collection/dict
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{quantity_of}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use cross_chain/types.{
  AdminNftTokenInfo, GroupAdminNFTInfo, GroupInfoParams, GroupNFTTokenInfo,
}
use cross_chain/utils.{is_single_asset}

/// GroupNFTHolder — spending validator for the GroupNFT UTxO
///
/// Parameter: GroupAdminNFTInfo { group, admin }
///
/// Datum: Unit (real state carried as inline GroupInfoParams)
///
/// Redeemer: Int
///   0 = version upgrade (only version field at index 0 may change, length check skipped)
///   1+ = update param at redeemer index (exactly one field may change, lengths must match)
///   2 = oracle worker update (oracle worker can sign instead of admin; GPK at index 2 may change)
///
/// Checks:
///   isAuthorized  — AdminNFT in inputs (qty==1) OR (action==2 AND oracle worker signed)
///   inputHasToken — own input holds the GroupNFT
///   outputHasToken — single output holds GroupNFT, addressed to Version VH from datum
///   checkNewDatum — at most one param may differ (at position == action);
///                   length equality enforced only when action > 0
/// Extract GroupInfoParams from an inline datum, failing loudly on any mismatch.
fn group_info_params(output: Output) -> GroupInfoParams {
  expect InlineDatum(raw) = output.datum
  expect params: GroupInfoParams = raw
  params
}

/// Walk both parameter lists element by element.
/// At most one position may differ, and if it does it must be at index == action.
/// Mirrors the Haskell paramsDiff exactly:
///   go [] _           = True    -- old exhausted → ok (both [] [] and [] (new:rn))
///   go (old:ro) []    = False   -- old list longer → fail
///   go (old:ro) (new:rn) n =
///       if old /= new && n /= i then False
///       else go ro rn (n+1)
fn params_diff(
  old_params: List<ByteArray>,
  new_params: List<ByteArray>,
  action: Int,
) -> Bool {
  params_diff_go(old_params, new_params, action, 0)
}

fn params_diff_go(
  old_params: List<ByteArray>,
  new_params: List<ByteArray>,
  action: Int,
  n: Int,
) -> Bool {
  when old_params is {
    // old list exhausted → ok whether new list has more or not (matches Haskell)
    [] -> True
    [old, ..rest_old] ->
      when new_params is {
        // old list longer → fail (matches Haskell `go (old:ro) [] _ = False`)
        [] -> False
        [new, ..rest_new] ->
          if old != new && n != action {
            False
          } else {
            params_diff_go(rest_old, rest_new, action, n + 1)
          }
      }
  }
}

/// Convert GroupInfoParams to a flat list of ByteArray in the canonical order
/// matching the Haskell `params` field order:
///   [version, admin, gpk, balance_worker, treasury_check_vh, oracle_worker,
///    mint_check_vh, stk_vh, stake_check_vh, nft_ref_holder_vh,
///    nft_treasury_check_vh, nft_mint_check_vh, outbound_holder_vh, inbound_check_vh]
fn params_to_list(p: GroupInfoParams) -> List<ByteArray> {
  [
    p.version,
    p.admin,
    p.gpk,
    p.balance_worker,
    p.treasury_check_vh,
    p.oracle_worker,
    p.mint_check_vh,
    p.stk_vh,
    p.stake_check_vh,
    p.nft_ref_holder_vh,
    p.nft_treasury_check_vh,
    p.nft_mint_check_vh,
    p.outbound_holder_vh,
    p.inbound_check_vh,
  ]
}

validator group_nft_holder(param: GroupAdminNFTInfo) {
  spend(
    _datum: Option<Data>,
    action: Int,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    let GroupAdminNFTInfo { group, admin } = param

    // ── own input ────────────────────────────────────────────────────────────
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == own_ref })

    let own_output_addr = own_input.output.address

    // ── hasAdminNftInInput ───────────────────────────────────────────────────
    let total_input_value =
      list.foldl(
        tx.inputs,
        assets.zero,
        fn(i, acc) { assets.merge(acc, i.output.value) },
      )

    let has_admin_nft_in_input =
      quantity_of(
        total_input_value,
        admin.admin_nft_symbol,
        admin.admin_nft_name,
      ) == 1

    // ── isAuthorized ─────────────────────────────────────────────────────────
    let oracle_worker_pkh = group_info_params(own_input.output).oracle_worker

    let is_authorized =
      has_admin_nft_in_input || action == 2 && list.has(
        tx.extra_signatories,
        oracle_worker_pkh,
      )

    // ── inputHasToken ────────────────────────────────────────────────────────
    let input_has_token =
      quantity_of(
        own_input.output.value,
        group.group_nft_symbol,
        group.group_nft_name,
      ) > 0

    // ── ownOutput ────────────────────────────────────────────────────────────
    // action > 0 → continuing outputs (same address); action == 0 → any output with GroupNFT
    let own_output =
      if action > 0 {
        let continuing =
          list.filter(tx.outputs, fn(o) { o.address == own_output_addr })
        expect [o] = continuing
        o
      } else {
        let locked_by_target =
          list.filter(
            tx.outputs,
            fn(o) {
              quantity_of(o.value, group.group_nft_symbol, group.group_nft_name) > 0
            },
          )
        expect [o] = locked_by_target
        o
      }

    // ── outputHasToken ───────────────────────────────────────────────────────
    let out_params = group_info_params(own_output)
    let version_vh = out_params.version

    let b_single_asset =
      is_single_asset(
        own_output.value,
        group.group_nft_symbol,
        group.group_nft_name,
      )

    let is_right_owner =
      when own_output.address.payment_credential is {
        Script(hash) -> hash == version_vh
        _ -> False
      }

    let output_has_token = b_single_asset && is_right_owner

    // ── checkNewDatum ────────────────────────────────────────────────────────
    let old_params = params_to_list(group_info_params(own_input.output))
    let new_params = params_to_list(out_params)

    let check_params_len =
      if action == 0 {
        True
      } else {
        list.length(old_params) == list.length(new_params)
      }

    let check_new_datum =
      params_diff(old_params, new_params, action) && check_params_len

    // ── combine ──────────────────────────────────────────────────────────────
    is_authorized && input_has_token && output_has_token && check_new_datum
  }

  else(_) {
    fail
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
//
// Validator handler functions are not directly callable from tests, so we
// re-implement the combined check logic in `validate_group_nft_holder` below.
// This mirrors the validator body exactly and lets tests call it like a
// plain function.

// ── test constants ────────────────────────────────────────────────────────────

const group_policy: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const group_name: ByteArray = #"47524f55504e4654"

const admin_policy: ByteArray =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const admin_name: ByteArray = #"41444d494e4e4654"

// version_vh is also the script hash the GroupNFT output must be locked at
const version_vh: ByteArray =
  #"1111111111111111111111111111111111111111111111111111111111111111"

const oracle_worker_pkh: ByteArray =
  #"2222222222222222222222222222222222222222222222222222222222222222"

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

fn base_params() -> GroupInfoParams {
  GroupInfoParams {
    version: version_vh,
    admin: #"aa",
    gpk: #"bb",
    balance_worker: #"cc",
    treasury_check_vh: #"dd",
    oracle_worker: oracle_worker_pkh,
    mint_check_vh: #"ee",
    stk_vh: #"ff",
    stake_check_vh: #"0a",
    nft_ref_holder_vh: #"0b",
    nft_treasury_check_vh: #"0c",
    nft_mint_check_vh: #"0d",
    outbound_holder_vh: #"0e",
    inbound_check_vh: #"0f",
  }
}

fn validator_param() -> GroupAdminNFTInfo {
  GroupAdminNFTInfo {
    group: GroupNFTTokenInfo {
      group_nft_symbol: group_policy,
      group_nft_name: group_name,
    },
    admin: AdminNftTokenInfo {
      admin_nft_symbol: admin_policy,
      admin_nft_name: admin_name,
    },
  }
}

fn script_addr() -> Address {
  Address { payment_credential: Script(version_vh), stake_credential: None }
}

// Input that holds the GroupNFT (the UTxO being spent)
fn group_nft_input(ref: OutputReference, params: GroupInfoParams) -> Input {
  Input {
    output_reference: ref,
    output: Output {
      address: script_addr(),
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(group_policy, group_name, 1),
      ),
      datum: InlineDatum(params),
      reference_script: None,
    },
  }
}

// Continuing output that returns the GroupNFT to the same script address
fn group_nft_output(params: GroupInfoParams) -> Output {
  Output {
    address: script_addr(),
    value: assets.merge(
      assets.from_lovelace(2_000_000),
      assets.from_asset(group_policy, group_name, 1),
    ),
    datum: InlineDatum(params),
    reference_script: None,
  }
}

// Input that carries the AdminNFT (proves admin authority)
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

// ── validate_group_nft_holder: logic extracted for testability ────────────────
//
// Mirrors the validator body; called by every test below.

fn validate_group_nft_holder(
  param: GroupAdminNFTInfo,
  action: Int,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  let GroupAdminNFTInfo { group, admin } = param

  expect Some(own_input) =
    list.find(tx.inputs, fn(i) { i.output_reference == own_ref })

  let own_output_addr = own_input.output.address

  let total_input_value =
    list.foldl(
      tx.inputs,
      assets.zero,
      fn(i, acc) { assets.merge(acc, i.output.value) },
    )

  let has_admin_nft =
    quantity_of(total_input_value, admin.admin_nft_symbol, admin.admin_nft_name) == 1

  let oracle_pkh = group_info_params(own_input.output).oracle_worker

  let is_authorized =
    has_admin_nft || action == 2 && list.has(tx.extra_signatories, oracle_pkh)

  let input_has_token =
    quantity_of(
      own_input.output.value,
      group.group_nft_symbol,
      group.group_nft_name,
    ) > 0

  let own_output =
    if action > 0 {
      expect [o] =
        list.filter(tx.outputs, fn(o) { o.address == own_output_addr })
      o
    } else {
      expect [o] =
        list.filter(
          tx.outputs,
          fn(o) {
            quantity_of(o.value, group.group_nft_symbol, group.group_nft_name) > 0
          },
        )
      o
    }

  let out_params = group_info_params(own_output)
  let ver_vh = out_params.version

  let single_ok =
    is_single_asset(
      own_output.value,
      group.group_nft_symbol,
      group.group_nft_name,
    )

  let right_owner =
    when own_output.address.payment_credential is {
      Script(h) -> h == ver_vh
      _ -> False
    }

  let output_has_token = single_ok && right_owner

  let old_list = params_to_list(group_info_params(own_input.output))
  let new_list = params_to_list(out_params)

  let len_ok =
    if action == 0 {
      True
    } else {
      list.length(old_list) == list.length(new_list)
    }

  let datum_ok = params_diff(old_list, new_list, action) && len_ok

  is_authorized && input_has_token && output_has_token && datum_ok
}

// ── test: admin NFT in inputs, action=1 ──────────────────────────────────────

test test_authorized_with_admin_nft() {
  let ref = oref(0)
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [group_nft_input(ref, base_params()), admin_nft_input()],
      outputs: [group_nft_output(base_params())],
    }
  validate_group_nft_holder(validator_param(), 1, ref, tx)
}

// ── test: oracle worker signs, action=2 (GPK field at index 2 may change) ────

test test_authorized_oracle_worker() {
  let ref = oref(0)
  // index 2 = gpk — the oracle worker is allowed to update it under action=2
  let new_params = GroupInfoParams { ..base_params(), gpk: #"deadbeef" }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [group_nft_input(ref, base_params())],
      outputs: [group_nft_output(new_params)],
      extra_signatories: [oracle_worker_pkh],
    }
  validate_group_nft_holder(validator_param(), 2, ref, tx)
}

// ── test: no admin NFT and not oracle worker → rejected ───────────────────────

test test_rejects_unauthorized() {
  let ref = oref(0)
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [group_nft_input(ref, base_params())],
      outputs: [group_nft_output(base_params())],
    }
  !validate_group_nft_holder(validator_param(), 1, ref, tx)
}

// ── test: continuing output must contain only GroupNFT + ADA (no extra tokens) ─

test test_output_has_token() {
  let ref = oref(0)
  // A foreign policy mixed into the output value — is_single_asset should reject it
  let foreign_policy =
    #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  let foreign_name = #"666f726569676e"
  let bad_output =
    Output {
      address: script_addr(),
      // GroupNFT present but also a foreign token → is_single_asset fails
      value: assets.merge(
        assets.merge(
          assets.from_lovelace(2_000_000),
          assets.from_asset(group_policy, group_name, 1),
        ),
        assets.from_asset(foreign_policy, foreign_name, 1),
      ),
      datum: InlineDatum(base_params()),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [group_nft_input(ref, base_params()), admin_nft_input()],
      outputs: [bad_output],
    }
  !validate_group_nft_holder(validator_param(), 1, ref, tx)
}

// ── test: exactly one param changed at the action index → allowed ─────────────

test test_param_diff_allows_single_change() {
  // action=1 → index 1 is the `admin` field; changing only that is fine
  let ref = oref(0)
  let new_params =
    GroupInfoParams { ..base_params(), admin: #"6e657761646d696e" }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [group_nft_input(ref, base_params()), admin_nft_input()],
      outputs: [group_nft_output(new_params)],
    }
  validate_group_nft_holder(validator_param(), 1, ref, tx)
}

// ── test: two params changed under action=1 → rejected ───────────────────────

test test_param_diff_rejects_two_changes() {
  // action=1 but both admin (index 1) and gpk (index 2) differ → must fail
  let ref = oref(0)
  let new_params =
    GroupInfoParams {
      ..base_params(),
      admin: #"6e657761646d696e",
      gpk: #"6e657767706b",
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [group_nft_input(ref, base_params()), admin_nft_input()],
      outputs: [group_nft_output(new_params)],
    }
  !validate_group_nft_holder(validator_param(), 1, ref, tx)
}

// ── unit tests for params_diff in isolation ───────────────────────────────────

test test_params_diff_identical_lists() {
  let p = params_to_list(base_params())
  params_diff(p, p, 1)
}

test test_params_diff_one_change_at_correct_index() {
  // index 1 differs, action=1 → ok
  // #"aa", #"bb", #"cc" are three distinct single-byte values
  params_diff([#"aa", #"bb", #"cc"], [#"aa", #"ff", #"cc"], 1)
}

test test_params_diff_one_change_at_wrong_index() {
  // index 1 differs, action=2 → fail
  !params_diff([#"aa", #"bb", #"cc"], [#"aa", #"ff", #"cc"], 2)
}

test test_params_diff_two_changes_rejected() {
  // indexes 0 and 2 both differ, action=0 allows only index 0 → second mismatch fails
  !params_diff([#"aa", #"bb", #"cc"], [#"11", #"bb", #"22"], 0)
}

// ── test: action=0 version upgrade happy path ─────────────────────────────────
//
// A new version VH is picked; the GroupNFT output goes to the NEW address
// (keyed by the new version hash). action=0 scans ALL outputs for the GroupNFT
// rather than filtering by the input address.

const new_version_vh: ByteArray =
  #"3333333333333333333333333333333333333333333333333333333333333333"

test test_action_0_version_upgrade() {
  let ref = oref(0)
  let old_params = base_params()
  // Only the version field changes; everything else stays identical
  let new_params = GroupInfoParams { ..old_params, version: new_version_vh }
  // Output is at the NEW version VH address
  let new_addr =
    Address {
      payment_credential: Script(new_version_vh),
      stake_credential: None,
    }
  let new_output =
    Output {
      address: new_addr,
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(group_policy, group_name, 1),
      ),
      datum: InlineDatum(new_params),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [group_nft_input(ref, old_params), admin_nft_input()],
      outputs: [new_output],
    }
  validate_group_nft_holder(validator_param(), 0, ref, tx)
}

// ── test: action=0 with oracle worker only (no AdminNFT) → rejected ───────────
//
// Oracle worker auth is only valid for action==2, not action==0.

test test_action_0_rejects_oracle_worker() {
  let ref = oref(0)
  let old_params = base_params()
  let new_params = GroupInfoParams { ..old_params, version: new_version_vh }
  let new_addr =
    Address {
      payment_credential: Script(new_version_vh),
      stake_credential: None,
    }
  let new_output =
    Output {
      address: new_addr,
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(group_policy, group_name, 1),
      ),
      datum: InlineDatum(new_params),
      reference_script: None,
    }
  // No AdminNFT input; oracle worker signs instead — must be rejected for action=0
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [group_nft_input(ref, old_params)],
      outputs: [new_output],
      extra_signatories: [oracle_worker_pkh],
    }
  !validate_group_nft_holder(validator_param(), 0, ref, tx)
}

// ── test: own input has no GroupNFT → input_has_token fails ───────────────────
//
// The UTxO being spent holds only ADA; GroupNFT is absent.

test test_input_missing_group_nft() {
  let ref = oref(0)
  // Own input: ADA only, no GroupNFT
  let bare_input =
    Input {
      output_reference: ref,
      output: Output {
        address: script_addr(),
        value: assets.from_lovelace(2_000_000),
        datum: InlineDatum(base_params()),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [bare_input, admin_nft_input()],
      outputs: [group_nft_output(base_params())],
    }
  !validate_group_nft_holder(validator_param(), 1, ref, tx)
}

// ── test: output GroupNFT goes to a script whose hash ≠ version field ─────────
//
// is_right_owner checks that Script(payment_credential_hash) == version from the
// output datum. Here we keep the output address the same as the input (so the
// action=1 continuing-output filter succeeds), but set the datum's `version`
// field to a different hash so that `Script(version_vh) != wrong_version_vh`.

test test_output_wrong_owner() {
  let wrong_version_vh =
    #"4444444444444444444444444444444444444444444444444444444444444444"
  let ref = oref(0)
  // Output is still at script_addr() (version_vh) so the continuing-output
  // filter passes, but the datum declares a different version hash → is_right_owner fails.
  let bad_params =
    GroupInfoParams { ..base_params(), version: wrong_version_vh }
  let bad_output =
    Output {
      address: script_addr(),
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(group_policy, group_name, 1),
      ),
      datum: InlineDatum(bad_params),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [group_nft_input(ref, base_params()), admin_nft_input()],
      outputs: [bad_output],
    }
  !validate_group_nft_holder(validator_param(), 1, ref, tx)
}

// ── unit tests for params_diff structural edge cases ─────────────────────────

// old exhausted before new → Haskell says True (old list done = ok)
test test_params_diff_old_shorter_than_new() {
  params_diff([#"aa"], [#"aa", #"bb"], 0)
}

// old list longer than new → Haskell says False
test test_params_diff_old_longer_than_new() {
  !params_diff([#"aa", #"bb"], [#"aa"], 0)
}

// both lists empty → trivially True
test test_params_diff_empty_lists() {
  params_diff([], [], 0)
}
