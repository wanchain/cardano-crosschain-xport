use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Transaction}

validator bridge_token(owner: ScriptHash, token_name: AssetName) {
  mint(_: Data, mint_policy: PolicyId, self: Transaction) {
    let Transaction { inputs, mint, .. } = self

    expect [Pair(asset_name, quantity)] =
      mint |> assets.tokens(mint_policy) |> dict.to_pairs()
    let owner_inputs =
      list.filter(
        inputs,
        fn(input) {
          when input.output.address.payment_credential is {
            Script(script_hash) -> owner == script_hash
            VerificationKey(_) -> False
          }
        },
      )

    (list.length(owner_inputs) == 1 || quantity < 0)? && (asset_name == token_name)?
  }

  else(_) {
    fail
  }
}
