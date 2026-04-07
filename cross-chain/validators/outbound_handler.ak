use aiken/cbor.{deserialise}
use aiken/collection/dict
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use cross_chain/types.{Beneficiary, CrossMsgData, ForeignAddress, LocalAddress}
use cross_chain/utils.{outputs_at}

pub type Redeemer {
  burn_policy: PolicyId,
  burn_token_name: AssetName,
  xport: Address,
  remote_contract: ByteArray,
}

validator outbound_handler(outbound_policy: PolicyId) {
  spend(
    datum: Option<Beneficiary>,
    redeemer: Redeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    let Transaction { inputs, mint, outputs, .. } = self

    let output_own_input = inputs |> transaction.resolve_input(own_ref)
    expect [output_xport] = outputs_at(outputs, redeemer.xport)
    expect InlineDatum(data) = output_xport.datum
    expect cross_msg_data: CrossMsgData = data

    expect Some(beneficiary) = datum

    expect LocalAddress(source_contract) = cross_msg_data.source_contract
    expect ForeignAddress(target_contract) = cross_msg_data.target_contract
    expect Some(function_args_data) =
      deserialise(cross_msg_data.function_call_data.function_args)
    expect function_args: Beneficiary = function_args_data
    expect ForeignAddress(_) = function_args.address
    expect [Pair(_, burn_quantity)] =
      mint |> assets.tokens(redeemer.burn_policy) |> dict.to_pairs()
    expect [Pair(_, _)] =
      output_xport.value |> assets.tokens(outbound_policy) |> dict.to_pairs()

    (source_contract == output_own_input.address)? && (target_contract == redeemer.remote_contract)? && (cross_msg_data.function_call_data.function_name == "wmbReceiveNonEvm")? && (burn_quantity == -function_args.amount)? && (assets.quantity_of(
      output_own_input.value,
      redeemer.burn_policy,
      redeemer.burn_token_name,
    ) >= burn_quantity)? && (function_args == beneficiary)?
  }

  else(_) {
    fail
  }
}
