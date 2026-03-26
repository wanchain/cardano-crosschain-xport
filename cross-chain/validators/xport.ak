use aiken/collection/list
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
    list.has(tx.extra_signatories, param.pkh)
  }

  else(_) {
    fail
  }
}
