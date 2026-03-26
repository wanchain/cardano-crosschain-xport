use aiken/collection/list
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}

/// GroupNFT — one-shot minting policy
///
/// Parameter: OutputReference — the UTXO that must be consumed to authorise
/// the initial mint.  After that UTXO is spent the policy can never fire again,
/// making this a true one-shot NFT.
///
/// Rules
///   1. An input whose output-reference equals the parameter must be present.
///   2. Exactly one token is minted (flattenValue of the mint field has a
///      single entry whose quantity is 1).
validator group_nft(oref: OutputReference) {
  mint(_redeemer: Data, _policy_id: ByteArray, tx: Transaction) {
    let has_utxo =
      list.any(tx.inputs, fn(input) { input.output_reference == oref })

    let check_minted_amount =
      when assets.flatten(tx.mint) is {
        [(_, _, amt)] -> amt == 1
        _ -> False
      }

    has_utxo && check_minted_amount
  }

  else(_) {
    fail
  }
}
