use aiken/cbor.{deserialise}
use aiken/collection/dict
use aiken/collection/list
// use aiken/primitive/string
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{Output, OutputReference, Transaction}
use utils.{
  Beneficiary, CrossMsgData, ForeignAddress, FunctionCallData, LocalAddress,
  total_input_value, value_at_address,
}

pub type Redeemer {
  mint_policy: PolicyId,
  remoteContract: ByteArray,
}

validator inbound(inbound_policy: PolicyId) {
  spend(
    datum: Option<CrossMsgData>,
    redeemer: Redeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    // trace @"redeemer": string.from_bytearray(mint_policy)
    let Transaction { inputs, mint, outputs, .. } = self

    // Select the first input and concatenate its output reference and index to
    // generate the expected token name
    expect Some(own_input) =
      list.find(
        inputs,
        fn(input) {
          // expect Script(script_hash) = input.output.address.payment_credential
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
    let total_input_value = total_input_value(inputs, None)

    expect Some(cross_msg_data) = datum
    expect ForeignAddress(sourceContract) = cross_msg_data.sourceContract
    // expect functionArgs: Beneficiary =
    //   cross_msg_data.functionCallData.functionArgs
    expect Some(functionArgsData) =
      deserialise(cross_msg_data.functionCallData.functionArgs)
    expect functionArgs: Beneficiary = functionArgsData
    expect LocalAddress(receiver) = functionArgs.address
    let value_at_target = value_at_address(outputs, receiver)
    expect [Pair(mint_token_name, quantity)] =
      mint |> assets.tokens(redeemer.mint_policy) |> dict.to_pairs()

    // expect [Pair(inbound_token_name, inbound_token_quantity)] =
    //   mint |> assets.tokens(inbound_policy) |> dict.to_pairs()
    expect [Pair(inbound_token_name, _)] =
      own_input.output.value |> assets.tokens(inbound_policy) |> dict.to_pairs()
    // 1. check mint amount is equal to functionArgs.amount
    (quantity == functionArgs.amount)? && // && (assets.quantity_of(
    //   own_input.output.value,
    //   inbound_policy,
    //   inbound_token_name,
    // ) == -inbound_token_quantity)? 
    (sourceContract == redeemer.remoteContract)? && (assets.quantity_of(
      value_at_target,
      redeemer.mint_policy,
      mint_token_name,
    ) == quantity)? && (assets.quantity_of(
      total_input_value,
      inbound_policy,
      inbound_token_name,
    ) == 1)?
  }

  else(_) {
    fail
  }
}
// test hello_world_example() {
//   let userAddress =
//     Address {
//       payment_credential: VerificationKey(
//         #"0000000000000000000000000000000000000000000000000000000000000000",
//       ),
//       stake_credential: None,
//     }

//   let demoInboundContract =
//     LocalAddress(
//       Address {
//         payment_credential: Script(
//           #"0000000000000000000000000000000000000000000000000000000000000000",
//         ),
//         stake_credential: None,
//       },
//     )

//   let args = Beneficiary { address: userAddress, amount: 1000 }

//   let datum =
//     CrossMsgData {
//       taskId: "task-0001",
//       sourceChainId: 1,
//       sourceContract: ForeignAddress(
//         #"1d1e18e1a484d0a10623661546ba97defab7a7ae",
//       ),
//       targetChainId: 2,
//       targetContract: demoInboundContract,
//       gasLimit: 100,
//       functionCallData: FunctionCallData {
//         functionName: "test_function",
//         functionArgs: args,
//       },
//     }

//   //   datum.taskId == "task-0001"
//   //   let redeemer = Redeemer { msg: "Aiken Rocks!" }
//   //   let placeholder_utxo = OutputReference { transaction_id: "", output_index: 0 }
//   let inbound_policy =
//     #"00000000000000000000000000000000000000000000000000000000"
//   let placeholder_utxo = OutputReference { transaction_id: "", output_index: 0 }
//   let inbound_output =
//     Output {
//       address: VerificationKey(
//         #"0000000000000000000000000000000000000000000000000000000000000000",
//       ),
//       value: Value { assets: dict.empty(), coins: 0 },
//       datum: Some(datum),
//     }

//   let transaction =
//     Transaction {
//       ..transaction.placeholder,
//       inputs: [
//         Input { output_reference: placeholder_utxo, output: inbound_output },
//       ],
//     }
//   inbound.spend(
//     inbound_policy,
//     Some(datum),
//     inbound_policy,
//     placeholder_utxo,
//     transaction,
//   )
// }
