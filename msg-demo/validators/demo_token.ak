use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, AssetName}
use cardano/transaction.{Transaction}

validator demo_token(owner: ScriptHash,token_name: AssetName) {
  mint(_: Data, mint_policy: PolicyId, self: Transaction) {
    let Transaction { inputs, mint, .. } = self

    expect [Pair(asset_name, quantity)] =
      mint |> assets.tokens(mint_policy) |> dict.to_pairs()
    let owner_inputs =
      list.filter(
        inputs,
        fn(input) {
          expect Script(script_hash) = input.output.address.payment_credential
          owner == script_hash
        },
      )

    (list.length(owner_inputs) == 1 || quantity < 0) && asset_name == token_name
  }

  // If needs be, remove any of unneeded handlers above, and use:
  else(_) {
    // todo @"fallback logic if none of the other purposes match"
    fail
  }

  // You will also need an additional import:
  //
  // use cardano/script_context.{ScriptContext}
}
