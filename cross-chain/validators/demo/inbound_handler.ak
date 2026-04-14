use aiken/cbor.{deserialise}
use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Script, VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use cross_chain/types.{Beneficiary, CrossMsgData, ForeignAddress, LocalAddress}
use cross_chain/utils.{total_input_value, value_at_address}

pub type Redeemer {
  mint_policy: PolicyId,
  remote_contract: ByteArray,
}

validator inbound_handler(inbound_policy: PolicyId) {
  spend(
    datum: Option<CrossMsgData>,
    redeemer: Redeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    let Transaction { inputs, mint, outputs, .. } = self

    expect Some(own_input) =
      list.find(
        inputs,
        fn(input) {
          when input.output.address.payment_credential is {
            Script(script_hash) ->
              input.output_reference == own_ref && assets.quantity_of(
                input.output.value,
                inbound_policy,
                script_hash,
              ) > 0
            VerificationKey(_) -> False
          }
        },
      )
    let inputs_value = total_input_value(inputs, None)

    expect Some(cross_msg_data) = datum
    expect ForeignAddress(source_contract) = cross_msg_data.source_contract
    expect Some(function_args_data) =
      deserialise(cross_msg_data.function_call_data.function_args)
    expect function_args: Beneficiary = function_args_data
    expect LocalAddress(receiver) = function_args.address
    let value_at_target = value_at_address(outputs, receiver)
    expect [Pair(mint_token_name, quantity)] =
      mint |> assets.tokens(redeemer.mint_policy) |> dict.to_pairs()

    expect [Pair(inbound_token_name, _)] =
      own_input.output.value |> assets.tokens(inbound_policy) |> dict.to_pairs()

    (quantity == function_args.amount)? && (source_contract == redeemer.remote_contract)? && (assets.quantity_of(
      value_at_target,
      redeemer.mint_policy,
      mint_token_name,
    ) == quantity)? && (assets.quantity_of(
      inputs_value,
      inbound_policy,
      inbound_token_name,
    ) == 1)?
  }

  else(_) {
    fail
  }
}
