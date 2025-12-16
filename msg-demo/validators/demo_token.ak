use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
// use aiken/primitive/string
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Transaction}

validator demo_token(owner: ScriptHash, token_name: AssetName) {
  mint(_: Data, mint_policy: PolicyId, self: Transaction) {
    // trace @"mint_policy": string.from_bytearray(mint_policy)
    let Transaction { inputs, mint, .. } = self

    expect [Pair(asset_name, quantity)] =
      mint |> assets.tokens(mint_policy) |> dict.to_pairs()
    let owner_inputs =
      list.filter(
        inputs,
        fn(input) {
          // expect Script(script_hash) = input.output.address.payment_credential
          when input.output.address.payment_credential is {
            Script(script_hash) -> owner == script_hash
            VerificationKey(_) -> False
          }
        },
      )

    (list.length(owner_inputs) == 1 || quantity < 0)? && (asset_name == token_name)?
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
