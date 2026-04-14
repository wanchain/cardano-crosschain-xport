use aiken/cbor.{deserialise}
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{InlineDatum, Transaction}
use cross_chain/types.{Beneficiary, CrossMsgData}

validator bridge_token(owner: ScriptHash, token_name: AssetName) {
  mint(_: Data, mint_policy: PolicyId, self: Transaction) {
    let Transaction { inputs, mint, .. } = self

    expect [Pair(asset_name, quantity)] =
      mint |> assets.tokens(mint_policy) |> dict.to_pairs()

    if quantity < 0 {
      // Burns are unrestricted — users can burn their own tokens
      asset_name == token_name
    } else {
      // Minting: require exactly 1 owner (inbound handler) input, and verify
      // the minted amount matches the CrossMsgData beneficiary amount in the
      // handler's inline datum.
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

      expect [owner_input] = owner_inputs

      // Extract the beneficiary amount from the owner input's datum
      expect InlineDatum(raw) = owner_input.output.datum
      expect cross_msg_data: CrossMsgData = raw
      expect Some(function_args_data) =
        deserialise(cross_msg_data.function_call_data.function_args)
      expect function_args: Beneficiary = function_args_data

      (asset_name == token_name)? && (quantity == function_args.amount)?
    }
  }

  else(_) {
    fail
  }
}
