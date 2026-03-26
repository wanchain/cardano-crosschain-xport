use aiken/collection/dict
use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{Transaction}
use cross_chain/types.{KeyParam}

// ─── helpers ──────────────────────────────────────────────────────────────────

/// Unit tests for the xport key-guarded spending validator.
///
/// Rule: the transaction must be signed by the `pkh` stored in KeyParam.
/// The `nonce` field is not checked at runtime.
/// The authorised signing key.
fn signer_pkh() -> ByteArray {
  #"aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd"
}

/// A different key that is NOT authorised.
fn other_pkh() -> ByteArray {
  #"1122334411223344112233441122334411223344112233441122334411223344"
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

/// Core logic mirror of the xport validator (extracted for testability).
fn validate(param: KeyParam, tx: Transaction) -> Bool {
  list.has(tx.extra_signatories, param.pkh)
}

// ─── tests ────────────────────────────────────────────────────────────────────

/// Happy path: the required pkh is listed as an extra signatory.
test test_xport_succeeds_with_correct_signer() {
  let param = KeyParam { pkh: signer_pkh(), nonce: 0 }
  let tx = Transaction { ..base_tx(), extra_signatories: [signer_pkh()] }
  validate(param, tx)
}

/// Failure: no signatories at all.
test test_xport_fails_without_signer() {
  let param = KeyParam { pkh: signer_pkh(), nonce: 0 }
  let tx = Transaction { ..base_tx(), extra_signatories: [] }
  !validate(param, tx)
}

/// Failure: a different key signed – not the one in KeyParam.
test test_xport_fails_with_wrong_signer() {
  let param = KeyParam { pkh: signer_pkh(), nonce: 0 }
  let tx = Transaction { ..base_tx(), extra_signatories: [other_pkh()] }
  !validate(param, tx)
}
