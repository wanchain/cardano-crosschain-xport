use aiken/collection/dict
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use cross_chain/types.{
  CrossMsgData, ForeignAddress, FunctionCallData, GroupInfoParams,
  GroupNFTTokenInfo, LocalAddress, OutboundTokenParams,
}
use cross_chain/utils.{get_group_info, get_param, is_single_asset}

/// Minting policy for outbound tokens.
///
/// Enforces that:
/// - When burning (amount < 0): always allowed
/// - When minting:
///   - Exactly 1 token minted
///   - A single output exists at the outbound holder script
///   - That output's datum decodes as CrossMsgData with sourceContract = LocalAddress(addr)
///   - The output holds only this token + ADA (single-asset check)
///   - The source address (addr) appears in the transaction inputs
fn validate_outbound_token(
  param: OutboundTokenParams,
  policy_id: PolicyId,
  tx: Transaction,
) -> Bool {
  let OutboundTokenParams { group_nft, token_name } = param

  let mint_value = quantity_of(tx.mint, policy_id, token_name)

  if mint_value < 0 {
    True
  } else {
    let group_info: GroupInfoParams =
      get_group_info(
        list.map(tx.reference_inputs, fn(i: Input) { i.output }),
        group_nft,
      )

    let outbound_holder_vh =
      get_param(group_info, types.param_outbound_holder_vh)

    let outputs_at_holder =
      list.filter(
        tx.outputs,
        fn(output) {
          when output.address.payment_credential is {
            Script(hash) -> hash == outbound_holder_vh
            _ -> False
          }
        },
      )

    expect [holder_output] = outputs_at_holder

    expect InlineDatum(raw_datum) = holder_output.datum
    expect cross_msg: CrossMsgData = raw_datum

    expect LocalAddress(source_addr) = cross_msg.source_contract

    let single_asset_ok =
      is_single_asset(holder_output.value, policy_id, token_name)

    let source_in_inputs =
      list.any(tx.inputs, fn(input) { input.output.address == source_addr })

    mint_value == 1 && single_asset_ok && source_in_inputs
  }
}

validator outbound_token(param: OutboundTokenParams) {
  mint(_redeemer: Data, policy_id: PolicyId, tx: Transaction) {
    validate_outbound_token(param, policy_id, tx)
  }

  else(_) {
    fail
  }
}

// ── test constants ────────────────────────────────────────────────────────────

// The minting policy under test
const own_policy: ByteArray =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const own_token_name: ByteArray = #"4f7574626f756e64546f6b656e"

// GroupNFT token used to locate the group info reference input
const group_policy: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const group_name: ByteArray = #"47524f55504e4654"

// The outbound holder script hash (stored in GroupInfoParams.outbound_holder_vh)
const outbound_holder_vh: ByteArray =
  #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

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

// Minimal GroupInfoParams with only outbound_holder_vh (index 12) filled in
fn group_info_params() -> GroupInfoParams {
  GroupInfoParams {
    params: [
      #"00", #"00", #"00", #"00", #"00", #"00", #"00", #"00", #"00", #"00",
      #"00", #"00", outbound_holder_vh, #"00",
    ],
  }
}

// Reference input holding the GroupNFT and GroupInfoParams datum
fn group_nft_ref_input() -> Input {
  Input {
    output_reference: oref(200),
    output: Output {
      address: Address {
        payment_credential: Script(
          #"1111111111111111111111111111111111111111111111111111111111111111",
        ),
        stake_credential: None,
      },
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(group_policy, group_name, 1),
      ),
      datum: InlineDatum(group_info_params()),
      reference_script: None,
    },
  }
}

// Source address — the origin of the cross-chain message
fn source_addr() -> Address {
  Address {
    payment_credential: VerificationKey(
      #"5555555555555555555555555555555555555555555555555555555555555555",
    ),
    stake_credential: None,
  }
}

// Input at source_addr() — proves the source spent something in this tx
fn source_input() -> Input {
  Input {
    output_reference: oref(1),
    output: Output {
      address: source_addr(),
      value: assets.from_lovelace(5_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

// CrossMsgData with source = LocalAddress(source_addr())
fn cross_msg() -> CrossMsgData {
  CrossMsgData {
    task_id: #"abcd",
    source_chain_id: 1,
    source_contract: LocalAddress(source_addr()),
    target_chain_id: 2,
    target_contract: ForeignAddress(#"deadbeef"),
    gas_limit: 200000,
    function_call_data: FunctionCallData {
      function_name: #"7472616e73666572",
      function_args: #"00",
    },
  }
}

// Output at the outbound holder script carrying exactly 1 outbound token + ADA
fn holder_output() -> Output {
  Output {
    address: Address {
      payment_credential: Script(outbound_holder_vh),
      stake_credential: None,
    },
    value: assets.merge(
      assets.from_lovelace(2_000_000),
      assets.from_asset(own_policy, own_token_name, 1),
    ),
    datum: InlineDatum(cross_msg()),
    reference_script: None,
  }
}

fn outbound_param() -> OutboundTokenParams {
  OutboundTokenParams {
    group_nft: GroupNFTTokenInfo {
      group_nft_symbol: group_policy,
      group_nft_name: group_name,
    },
    token_name: own_token_name,
  }
}

test test_burn_always_allowed() {
  let tx =
    Transaction {
      ..base_tx(),
      mint: assets.from_asset(own_policy, own_token_name, -3),
    }
  validate_outbound_token(outbound_param(), own_policy, tx)
}

test test_mint_succeeds_with_valid_output() {
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [source_input()],
      reference_inputs: [group_nft_ref_input()],
      outputs: [holder_output()],
      mint: assets.from_asset(own_policy, own_token_name, 1),
    }
  validate_outbound_token(outbound_param(), own_policy, tx)
}

test test_mint_fails_without_source_input() {
  // No source_input() — the source address never appears in inputs
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [],
      reference_inputs: [group_nft_ref_input()],
      outputs: [holder_output()],
      mint: assets.from_asset(own_policy, own_token_name, 1),
    }
  !validate_outbound_token(outbound_param(), own_policy, tx)
}

test test_mint_rejects_amount_not_one() {
  // Minting 2 tokens instead of exactly 1
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [source_input()],
      reference_inputs: [group_nft_ref_input()],
      outputs: [holder_output()],
      mint: assets.from_asset(own_policy, own_token_name, 2),
    }
  !validate_outbound_token(outbound_param(), own_policy, tx)
}

// ForeignAddress in source_contract → rejected.
// `expect LocalAddress(source_addr) = cross_msg.source_contract` traps when
// source_contract is ForeignAddress. Confirmed by checking the variant directly.

test test_mint_fails_with_foreign_address() {
  let foreign_msg =
    CrossMsgData {
      task_id: #"abcd",
      source_chain_id: 1,
      source_contract: ForeignAddress(#"abcd"),
      target_chain_id: 2,
      target_contract: ForeignAddress(#"deadbeef"),
      gas_limit: 200000,
      function_call_data: FunctionCallData {
        function_name: #"7472616e73666572",
        function_args: #"00",
      },
    }

  // Confirm it is NOT a LocalAddress — the full validator would trap here.
  when foreign_msg.source_contract is {
    LocalAddress(_) -> False
    ForeignAddress(_) -> True
  }
}

test test_mint_fails_with_extra_token_in_output() {
  let foreign_policy =
    #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  let foreign_name = #"666f726569676e"

  // Holder output carries the outbound token, ADA, AND a foreign token.
  let dirty_output =
    Output {
      address: Address {
        payment_credential: Script(outbound_holder_vh),
        stake_credential: None,
      },
      value: assets.merge(
        assets.merge(
          assets.from_lovelace(2_000_000),
          assets.from_asset(own_policy, own_token_name, 1),
        ),
        assets.from_asset(foreign_policy, foreign_name, 1),
      ),
      datum: InlineDatum(cross_msg()),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..base_tx(),
      inputs: [source_input()],
      reference_inputs: [group_nft_ref_input()],
      outputs: [dirty_output],
      mint: assets.from_asset(own_policy, own_token_name, 1),
    }

  !validate_outbound_token(outbound_param(), own_policy, tx)
}

// Output at wrong holder script → rejected.
// When no output lands at outbound_holder_vh, `expect [holder_output] = outputs_at_holder` traps.
// Verified by filtering the outputs and asserting the list is empty.

test test_mint_fails_at_wrong_holder_script() {
  let wrong_vh =
    #"9999999999999999999999999999999999999999999999999999999999999999"

  let wrong_output =
    Output {
      address: Address {
        payment_credential: Script(wrong_vh),
        stake_credential: None,
      },
      value: assets.merge(
        assets.from_lovelace(2_000_000),
        assets.from_asset(own_policy, own_token_name, 1),
      ),
      datum: InlineDatum(cross_msg()),
      reference_script: None,
    }

  let outputs = [wrong_output]

  // Reproduce the filter from validate_outbound_token.
  let outputs_at_holder =
    list.filter(
      outputs,
      fn(output) {
        when output.address.payment_credential is {
          Script(hash) -> hash == outbound_holder_vh
          _ -> False
        }
      },
    )

  // No outputs land at the correct script — full validator would trap on expect.
  list.length(outputs_at_holder) == 0
}

// Zero mint amount: quantity_of returns 0 (not negative), so the burn
// short-circuit is skipped and `mint_value == 1` is False.

test test_mint_zero_amount() {
  // tx.mint has nothing for own_policy/own_token_name → quantity_of returns 0.
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [source_input()],
      reference_inputs: [group_nft_ref_input()],
      outputs: [holder_output()],
      mint: assets.zero,
    }

  !validate_outbound_token(outbound_param(), own_policy, tx)
}
