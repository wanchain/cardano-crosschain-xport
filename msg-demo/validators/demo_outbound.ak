use aiken/cbor.{deserialise}
use aiken/collection/dict
// use aiken/primitive/string
// use aiken/crypto.{Blake2b_224, Hash, VerificationKey}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
// use cardano/assets.{lovelace_of, merge}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use utils.{
  Beneficiary, CrossMsgData, ForeignAddress, FunctionCallData, LocalAddress,
  outputsAt,
}

pub type Redeemer {
  burn_policy: PolicyId,
  burn_token_name: AssetName,
  xport: Address,
}

validator outbound(outbound_policy: PolicyId, remoteContract: ByteArray) {
  spend(
    datum: Option<Beneficiary>,
    redeemer: Redeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    // trace @"redeemer": string.from_bytearray(redeemer.burn_policy)
    let Transaction { inputs, mint, outputs, .. } = self

    let output_own_input = inputs |> transaction.resolve_input(own_ref)
    expect [outputXport] = outputsAt(outputs, redeemer.xport)
    expect InlineDatum(data) = outputXport.datum
    expect cross_msg_data: CrossMsgData = data

    expect Some(beneficiary) = datum

    expect LocalAddress(sourceContract) = cross_msg_data.sourceContract
    expect ForeignAddress(targetContract) = cross_msg_data.targetContract
    expect Some(functionArgsData) =
      deserialise(cross_msg_data.functionCallData.functionArgs)
    expect functionArgs: Beneficiary = functionArgsData
    expect ForeignAddress(_) = functionArgs.address
    expect [Pair(_, burn_quantity)] =
      mint |> assets.tokens(redeemer.burn_policy) |> dict.to_pairs()
    expect [Pair(_, _)] =
      outputXport.value |> assets.tokens(outbound_policy) |> dict.to_pairs()

    (sourceContract == output_own_input.address)? && (targetContract == remoteContract)? && (cross_msg_data.functionCallData.functionName == "wmbReceive")? && (burn_quantity == -functionArgs.amount)? && (assets.quantity_of(
      output_own_input.value,
      redeemer.burn_policy,
      redeemer.burn_token_name,
    ) >= burn_quantity)? && (functionArgs == beneficiary)?
  }

  else(_) {
    fail
  }
}
