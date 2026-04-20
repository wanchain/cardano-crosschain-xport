use aiken/collection/dict
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, VerificationKey}
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}
use cross_chain/types.{KeyParam}

/// XPort — key-guarded spending validator
///
/// Parameter: KeyParam { pkh, nonce }
///   pkh   — the VerificationKeyHash that must sign the transaction.
///   nonce — an arbitrary integer used to make each deployment unique;
///           it is not checked at runtime.
///
/// Rule: the transaction must be signed by `pkh`.
validator xport(param: KeyParam) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _own_ref: OutputReference,
    tx: Transaction,
  ) {
    validate_xport(param, tx)
  }

  else(_) {
    fail
  }
}

/// Verify that the required pkh is in the transaction's extra signatories.
fn validate_xport(param: KeyParam, tx: Transaction) -> Bool {
  list.has(tx.extra_signatories, param.pkh)
}

/// The authorised signing key.
fn signer_pkh() -> ByteArray {
  #"aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd"
}

/// A different key that is NOT authorised.
fn other_pkh() -> ByteArray {
  #"1122334411223344112233441122334411223344112233441122334411223344"
}

/// Base transaction with all required fields initialized.
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

/// Happy path: the required pkh is listed as an extra signatory.
test test_xport_succeeds_with_correct_signer() {
  let param = KeyParam { pkh: signer_pkh(), nonce: 0 }
  let tx = Transaction { ..base_tx(), extra_signatories: [signer_pkh()] }
  validate_xport(param, tx)
}

/// Failure: no signatories at all.
test test_xport_fails_without_signer() {
  let param = KeyParam { pkh: signer_pkh(), nonce: 0 }
  let tx = Transaction { ..base_tx(), extra_signatories: [] }
  !validate_xport(param, tx)
}

/// Failure: a different key signed – not the one in KeyParam.
test test_xport_fails_with_wrong_signer() {
  let param = KeyParam { pkh: signer_pkh(), nonce: 0 }
  let tx = Transaction { ..base_tx(), extra_signatories: [other_pkh()] }
  !validate_xport(param, tx)
}
