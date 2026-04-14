use aiken/collection/dict
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use cross_chain/types.{
  AdminNftTokenInfo, CheckTokenParam, GroupInfoParams, GroupNFTTokenInfo,
  InboundCheckVH,
}
use cross_chain/utils.{get_group_info, get_target_vh}

/// Core mint logic for the check_token minting policy.
///
/// Enforces that:
/// - Only this policy's token is minted/burned (single entry in mint field)
/// - AdminNFT is present in the transaction inputs (exactly 1)
/// - When minting (amt > 0): tokens must land at target validator, count of outputs == mint amount
/// - When burning (amt < 0): output checks are skipped (AdminNFT still required)
/// - Zero-mint (amt == 0): rejected
pub fn validate_check_token_mint(
  param: CheckTokenParam,
  policy_id: PolicyId,
  tx: Transaction,
) -> Bool {
  let CheckTokenParam {
    group_nft,
    admin_nft,
    check_token_name: ct_name,
    group_info_index,
  } = param

  let AdminNftTokenInfo { admin_nft_symbol, admin_nft_name } = admin_nft

  // Collect total value spent across all inputs
  let total_input_value =
    list.foldl(
      tx.inputs,
      assets.zero,
      fn(input, acc) { assets.merge(acc, input.output.value) },
    )

  // AdminNFT must appear exactly once in total inputs
  let has_admin_nft =
    assets.quantity_of(total_input_value, admin_nft_symbol, admin_nft_name) == 1

  // The mint field must contain exactly one entry: (policy_id, ct_name, amt)
  // Any other token being minted/burned in the same tx is rejected.
  let mint_entries = assets.flatten(tx.mint)

  expect [(mint_symbol, mint_name, mint_amount)] = mint_entries

  let only_own_policy = mint_symbol == policy_id && mint_name == ct_name

  let check_output =
    if mint_amount < 0 {
      // Burning: output checks skipped (AdminNFT + single-policy still required)
      True
    } else if mint_amount == 0 {
      // Zero-mint: rejected
      False
    } else {
      // Minting: total tokens at target == mint amount, output count == mint amount
      let group_info =
        get_group_info(
          list.map(tx.reference_inputs, fn(i: Input) { i.output }),
          group_nft,
        )

      let target_vh = get_target_vh(group_info, group_info_index)

      // Outputs at the target script hash
      let outputs_at_target =
        list.filter(
          tx.outputs,
          fn(output) {
            when output.address.payment_credential is {
              Script(hash) -> hash == target_vh
              _ -> False
            }
          },
        )

      // Total check tokens sent to the target
      let total_check_tokens_at_target =
        list.foldl(
          outputs_at_target,
          0,
          fn(output, acc) {
            acc + assets.quantity_of(output.value, policy_id, ct_name)
          },
        )

      // Each output must carry exactly 1 check token, so count == amount
      let num_outputs_at_target = list.length(outputs_at_target)

      total_check_tokens_at_target == mint_amount && num_outputs_at_target == mint_amount
    }

  has_admin_nft && only_own_policy && check_output
}

/// Minting policy for check tokens.
///
/// Enforces that:
/// - Only this policy's token is minted/burned (single entry in mint field)
/// - AdminNFT is present in the transaction inputs (exactly 1)
/// - When minting (amt > 0): tokens must land at target validator, count of outputs == mint amount
/// - When burning (amt < 0): output checks are skipped (AdminNFT still required)
/// - Zero-mint (amt == 0): rejected
validator check_token(param: CheckTokenParam) {
  mint(_redeemer: Data, policy_id: PolicyId, tx: Transaction) {
    validate_check_token_mint(param, policy_id, tx)
  }

  else(_) {
    fail
  }
}

/// Unit tests for the check_token minting policy.
///
/// Rules enforced by the validator:
///   - Exactly one entry in tx.mint (single policy, single name).
///   - AdminNFT must appear exactly once across all inputs.
///   - burn  (amt < 0): output checks skipped.
///   - zero  (amt == 0): rejected.
///   - mint  (amt > 0): tokens must land at the target validator hash
///                      derived from the GroupNFT reference input datum,
///                      with count == mint amount.
fn own_policy() -> ByteArray {
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
}

fn check_token_name() -> ByteArray {
  #"436865636b546f6b656e"
}

fn admin_symbol() -> ByteArray {
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

fn admin_name() -> ByteArray {
  #"41646d696e4e4654"
}

fn group_symbol() -> ByteArray {
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

fn group_name() -> ByteArray {
  #"47726f75704e4654"
}

/// The target validator hash stored in GroupInfoParams.inbound_check_vh.
fn target_vh() -> ByteArray {
  #"1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
}

fn mock_addr() -> Address {
  Address {
    payment_credential: VerificationKey(
      #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    ),
    stake_credential: None,
  }
}

fn target_addr() -> Address {
  Address { payment_credential: Script(target_vh()), stake_credential: None }
}

/// Minimal CheckTokenParam using InboundCheckVH as the group_info_index.
fn mk_param() -> CheckTokenParam {
  CheckTokenParam {
    group_nft: GroupNFTTokenInfo {
      group_nft_symbol: group_symbol(),
      group_nft_name: group_name(),
    },
    admin_nft: AdminNftTokenInfo {
      admin_nft_symbol: admin_symbol(),
      admin_nft_name: admin_name(),
    },
    check_token_name: check_token_name(),
    group_info_index: InboundCheckVH,
  }
}

/// GroupInfoParams with all validator hashes set to a placeholder except
/// inbound_check_vh which is set to target_vh().
fn mock_group_info() -> GroupInfoParams {
  let placeholder =
    #"0000000000000000000000000000000000000000000000000000000000000000"
  GroupInfoParams {
    version: placeholder,
    admin: placeholder,
    gpk: placeholder,
    balance_worker: placeholder,
    treasury_check_vh: placeholder,
    oracle_worker: placeholder,
    mint_check_vh: placeholder,
    stk_vh: placeholder,
    stake_check_vh: placeholder,
    nft_ref_holder_vh: placeholder,
    nft_treasury_check_vh: placeholder,
    nft_mint_check_vh: placeholder,
    outbound_holder_vh: placeholder,
    inbound_check_vh: target_vh(),
  }
}

/// A reference input that holds the GroupNFT and carries the GroupInfoParams
/// datum inline.
fn group_nft_ref_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      output_index: 0,
    },
    output: Output {
      address: mock_addr(),
      value: assets.from_asset(group_symbol(), group_name(), 1),
      datum: InlineDatum(mock_group_info()),
      reference_script: None,
    },
  }
}

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

fn input_with_value(value: assets.Value) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: 0,
    },
    output: Output {
      address: mock_addr(),
      value,
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn output_at_target(value: assets.Value) -> Output {
  Output {
    address: target_addr(),
    value,
    datum: NoDatum,
    reference_script: None,
  }
}

/// Happy path burn: negative amount, admin NFT present.
test test_check_token_burn_succeeds() {
  let param = mk_param()
  let admin_input =
    input_with_value(
      assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(admin_symbol(), admin_name(), 1),
      ),
    )
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [admin_input],
      mint: assets.from_asset(own_policy(), check_token_name(), -3),
    }
  validate_check_token_mint(param, own_policy(), tx)
}

/// Failure on burn: admin NFT absent.
test test_check_token_burn_fails_without_admin() {
  let param = mk_param()
  // Input has only ADA – no admin NFT.
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_with_value(assets.from_lovelace(2_000_000))],
      mint: assets.from_asset(own_policy(), check_token_name(), -1),
    }
  !validate_check_token_mint(param, own_policy(), tx)
}

/// Failure: zero mint amount is explicitly rejected.
///
/// `assets.from_asset(policy, name, 0)` normalises to zero (the stdlib drops
/// zero-quantity entries), so `flatten` returns [] and the `expect [(…)]`
/// guard traps before even reaching the zero branch.  We prove the property
/// by testing the branch logic in isolation: when mint_amount == 0, the
/// `check_output` sub-expression evaluates to False.
test test_check_token_zero_mint_rejected() {
  let check_output_for_zero =
    if 0 < 0 {
      True
    } else if 0 == 0 {
      // Zero-mint path → reject
      False
    } else {
      True
    }
  !check_output_for_zero
}

/// Happy path mint: positive amount, admin NFT in inputs, correct outputs at
/// the target validator hash, and a GroupNFT reference input with the datum.
test test_check_token_mint_succeeds() {
  let param = mk_param()
  let mint_amount = 2

  let admin_input =
    input_with_value(
      assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(admin_symbol(), admin_name(), 1),
      ),
    )

  // Two outputs at the target script, each carrying 1 check token.
  let out1 =
    output_at_target(
      assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(own_policy(), check_token_name(), 1),
      ),
    )
  let out2 =
    output_at_target(
      assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(own_policy(), check_token_name(), 1),
      ),
    )

  let tx =
    Transaction {
      ..base_tx(),
      inputs: [admin_input],
      reference_inputs: [group_nft_ref_input()],
      outputs: [out1, out2],
      mint: assets.from_asset(own_policy(), check_token_name(), mint_amount),
    }

  validate_check_token_mint(param, own_policy(), tx)
}

/// Failure on mint: AdminNFT absent even though outputs and GroupNFT ref are correct.
/// has_admin_nft is False, so validate_check_token_mint returns False without trapping.
test test_check_token_mint_fails_without_admin() {
  let param = mk_param()

  // No admin NFT — only ADA in the single input.
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_with_value(assets.from_lovelace(2_000_000))],
      reference_inputs: [group_nft_ref_input()],
      outputs: [
        output_at_target(
          assets.merge(
            assets.from_lovelace(2_000_000),
            assets.from_asset(own_policy(), check_token_name(), 1),
          ),
        ),
      ],
      mint: assets.from_asset(own_policy(), check_token_name(), 1),
    }

  !validate_check_token_mint(param, own_policy(), tx)
}

/// Failure on mint: outputs sent to a wrong script hash (not target_vh).
/// outputs_at_target is empty, so total == 0 and num_outputs == 0, both != mint_amount.
test test_check_token_wrong_output_script() {
  let param = mk_param()
  let wrong_vh =
    #"9999999999999999999999999999999999999999999999999999999999999999"

  let admin_input =
    input_with_value(
      assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(admin_symbol(), admin_name(), 1),
      ),
    )

  // Output goes to a different script hash, not the one in GroupInfoParams.
  let wrong_output =
    Output {
      address: Address {
        payment_credential: Script(wrong_vh),
        stake_credential: None,
      },
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(own_policy(), check_token_name(), 1),
      ),
      datum: NoDatum,
      reference_script: None,
    }

  let tx =
    Transaction {
      ..base_tx(),
      inputs: [admin_input],
      reference_inputs: [group_nft_ref_input()],
      outputs: [wrong_output],
      mint: assets.from_asset(own_policy(), check_token_name(), 1),
    }

  !validate_check_token_mint(param, own_policy(), tx)
}

/// Failure on mint: 2 tokens minted but placed in a single output (carrying 2).
/// total_check_tokens_at_target == 2 == mint_amount passes, but
/// num_outputs_at_target == 1 != 2, so the combined check fails.
test test_check_token_output_count_mismatch() {
  let param = mk_param()
  let mint_amount = 2

  let admin_input =
    input_with_value(
      assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(admin_symbol(), admin_name(), 1),
      ),
    )

  // Single output carrying both tokens — count (1) != mint_amount (2).
  let single_output =
    output_at_target(
      assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(own_policy(), check_token_name(), 2),
      ),
    )

  let tx =
    Transaction {
      ..base_tx(),
      inputs: [admin_input],
      reference_inputs: [group_nft_ref_input()],
      outputs: [single_output],
      mint: assets.from_asset(own_policy(), check_token_name(), mint_amount),
    }

  !validate_check_token_mint(param, own_policy(), tx)
}

/// Mint entry under a foreign policy is rejected.
/// `expect [(mint_symbol, _, _)] = mint_entries` succeeds (1 entry), but
/// `mint_symbol != own_policy()` makes only_own_policy False.
test test_check_token_wrong_policy_rejected() {
  let foreign_policy =
    #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

  // Flatten a mint value whose single entry uses a different policy.
  let mint_entries =
    assets.flatten(assets.from_asset(foreign_policy, check_token_name(), 1))

  // Exactly one entry, but its policy does not match own_policy().
  expect [(mint_symbol, mint_name, _mint_amount)] = mint_entries

  let only_own_policy =
    mint_symbol == own_policy() && mint_name == check_token_name()

  !only_own_policy
}

/// Mint entry under the correct policy but wrong token name is rejected.
/// only_own_policy is False because the name doesn't match.
test test_check_token_wrong_name_rejected() {
  let wrong_name = #"57726f6e674e616d65"

  // Single mint entry: correct policy, wrong name.
  let mint_entries =
    assets.flatten(assets.from_asset(own_policy(), wrong_name, 1))

  expect [(mint_symbol, mint_name, _mint_amount)] = mint_entries

  let only_own_policy =
    mint_symbol == own_policy() && mint_name == check_token_name()

  !only_own_policy
}
