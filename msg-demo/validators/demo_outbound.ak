use aiken/collection/dict
// use aiken/collection/list
use aiken/primitive/string
// use aiken/crypto.{Blake2b_224, Hash, VerificationKey}
use cardano/address.{Address}
use cardano/assets.{PolicyId,AssetName}
// use cardano/assets.{lovelace_of, merge}
use cardano/transaction.{Output, OutputReference, Transaction,InlineDatum}
use utils.{Beneficiary,ForeignAddress,LocalAddress,FunctionCallData,CrossMsgData,outputsAt}

pub type Redeemer {
  burn_policy: PolicyId,
  burn_token_name: AssetName,
  xport: Address,
}


validator outbound(outbound_policy: PolicyId,remoteContract: ByteArray) {
  spend(
    _: Option<Data>,
    redeemer: Redeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    trace @"redeemer": string.from_bytearray(redeemer.burn_policy)
    let Transaction { inputs, mint, outputs, .. } = self

    let output_own_input =
      inputs |> transaction.resolve_input(own_ref)

    expect [outputXport] = outputsAt(outputs,redeemer.xport)
    expect InlineDatum(data) = outputXport.datum
    expect cross_msg_data: CrossMsgData = data
    expect LocalAddress(sourceContract) = cross_msg_data.sourceContract
    expect ForeignAddress(targetContract) = cross_msg_data.targetContract
    // expect ForeignAddress(receiver) = cross_msg_data.functionCallData.functionArgs.address
    
    
    expect [Pair(_, burn_quantity)] =
      mint |> assets.tokens(redeemer.burn_policy) |> dict.to_pairs()
    expect [Pair(_, _)] =
      outputXport.value |> assets.tokens(outbound_policy) |> dict.to_pairs()

    
    sourceContract == output_own_input.address
    && targetContract == remoteContract
    && cross_msg_data.functionCallData.functionName == "wmbReceive"
    && burn_quantity == cross_msg_data.functionCallData.functionArgs.amount
  }

  else(_) {
    fail
  }
}