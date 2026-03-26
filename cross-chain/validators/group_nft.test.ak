use aiken/collection/dict
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, VerificationKey}
use cardano/assets
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction}

// ─── helpers ──────────────────────────────────────────────────────────────────

/// Unit tests for the group_nft one-shot minting policy.
///
/// The validator has two requirements:
///   1. An input whose output_reference matches the policy parameter exists.
///   2. Exactly one token is minted (flattenValue has a single entry with qty 1).
fn mock_oref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000001",
    output_index: 0,
  }
}

fn mock_addr() -> Address {
  Address {
    payment_credential: VerificationKey(
      #"aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd",
    ),
    stake_credential: None,
  }
}

/// A bare-minimum transaction that satisfies neither validator requirement.
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

fn mock_input(oref: OutputReference) -> Input {
  Input {
    output_reference: oref,
    output: Output {
      address: mock_addr(),
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

// ─── logic extracted for testability ─────────────────────────────────────────

fn validate(oref: OutputReference, tx: Transaction) -> Bool {
  let has_utxo =
    tx.inputs
      |> list.any(fn(input) { input.output_reference == oref })

  let check_minted_amount =
    when assets.flatten(tx.mint) is {
      [(_, _, amt)] -> amt == 1
      _ -> False
    }

  has_utxo && check_minted_amount
}

// ─── tests ────────────────────────────────────────────────────────────────────

/// Happy path: the required UTXO is consumed and exactly 1 token is minted.
test test_group_nft_succeeds_with_valid_utxo_and_single_mint() {
  let oref = mock_oref()
  let policy_id =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let token_name = #"47726f75704e4654"
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [mock_input(oref)],
      mint: assets.from_asset(policy_id, token_name, 1),
    }
  validate(oref, tx)
}

/// Failure: no input matches the required output reference.
test test_group_nft_fails_without_utxo() {
  let oref = mock_oref()
  let different_oref =
    OutputReference {
      transaction_id: #"ffff000000000000000000000000000000000000000000000000000000000000",
      output_index: 0,
    }
  let policy_id =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let token_name = #"47726f75704e4654"
  // Input has a *different* oref – the required one is not consumed.
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [mock_input(different_oref)],
      mint: assets.from_asset(policy_id, token_name, 1),
    }
  !validate(oref, tx)
}

/// Failure: the correct UTXO is present but 2 tokens are minted instead of 1.
test test_group_nft_fails_with_wrong_mint_amount() {
  let oref = mock_oref()
  let policy_id =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let token_name = #"47726f75704e4654"
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [mock_input(oref)],
      mint: assets.from_asset(policy_id, token_name, 2),
    }
  !validate(oref, tx)
}

/// Failure: two distinct tokens are minted under the same policy (flatten has 2 entries).
test test_group_nft_fails_with_multiple_tokens() {
  let oref = mock_oref()
  let policy_id =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let token_a = #"41"
  let token_b = #"42"
  let mint_value =
    assets.merge(
      assets.from_asset(policy_id, token_a, 1),
      assets.from_asset(policy_id, token_b, 1),
    )
  let tx =
    Transaction { ..base_tx(), inputs: [mock_input(oref)], mint: mint_value }
  !validate(oref, tx)
}

/// Failure: attempting to burn (quantity -1) is rejected – qty must be exactly 1.
test test_group_nft_fails_with_burn() {
  let oref = mock_oref()
  let policy_id =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let token_name = #"47726f75704e4654"
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [mock_input(oref)],
      mint: assets.from_asset(policy_id, token_name, -1),
    }
  !validate(oref, tx)
}

/// Failure: tx.mint is assets.zero (no tokens at all).
/// `assets.flatten(assets.zero)` returns `[]`, which matches the `_ -> False`
/// arm of the `when` in validate, so the validator returns False.
test test_group_nft_zero_mint() {
  let oref = mock_oref()
  let tx =
    Transaction { ..base_tx(), inputs: [mock_input(oref)], mint: assets.zero }
  // flatten yields [] → check_minted_amount is False → validate returns False.
  !validate(oref, tx)
}
