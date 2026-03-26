use aiken/collection/list
use cardano/assets
use cardano/transaction.{Transaction}
use cross_chain/types.{CheckTokenInfo}

/// InboundToken — minting policy for inbound bridge tokens
///
/// Parameter: CheckTokenInfo { check_token_symbol, check_token_name }
///   Identifies the check token that must be present when minting.
///
/// Rules
///   Exactly one token name under this policy may be minted/burned per tx.
///   Burn (quantity < 0): always succeeds.
///   Mint (quantity > 0): requires exactly 1 check token in tx inputs.
validator inbound_token(param: CheckTokenInfo) {
  mint(_redeemer: Data, policy_id: ByteArray, tx: Transaction) {
    // Exactly one entry under this policy (matches Haskell single-element pattern).
    let own_mint_entries =
      assets.flatten(tx.mint)
        |> list.filter(
            fn(entry) {
              let (cs, _, _) = entry
              cs == policy_id
            },
          )

    expect [single_entry] = own_mint_entries
    let (_, _, amt) = single_entry

    if amt < 0 {
      // Burn: unconditionally allowed
      True
    } else {
      // Mint: require exactly 1 check token in inputs
      let total_input_value =
        list.foldl(
          tx.inputs,
          assets.zero,
          fn(input, acc) { assets.merge(acc, input.output.value) },
        )

      let check_amount =
        assets.quantity_of(
          total_input_value,
          param.check_token_symbol,
          param.check_token_name,
        )

      check_amount == 1
    }
  }

  else(_) {
    fail
  }
}
