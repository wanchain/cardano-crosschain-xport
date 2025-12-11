// use cardano/address.{Address, Script, VerificationKey}
// use cardano/transaction.{OutputReference}
// use demo_inbound.{
//   Beneficiary, CrossMsgData, ForeignAddress, FunctionCallData, LocalAddress,
// }

// fn add_one(n: Int) -> Int {
//   n + 1
// }

// test add_one_1() {
//   add_one(0) == 1
// }

// test add_one_2() {
//   add_one(-42) == -41
// }
// // test hello_world_example() {
// //   let userAddress =
// //     Address {
// //       payment_credential: VerificationKey(
// //         #"0000000000000000000000000000000000000000000000000000000000000000",
// //       ),
// //       stake_credential: None,
// //     }

// //   let demoInboundContract =
// //     LocalAddress(
// //       Address {
// //         payment_credential: Script(
// //           #"0000000000000000000000000000000000000000000000000000000000000000",
// //         ),
// //         stake_credential: None,
// //       },
// //     )

// //   let args = Beneficiary { address: userAddress, amount: 1000 }

// //   let datum =
// //     CrossMsgData {
// //       taskId: "task-0001",
// //       sourceChainId: 1,
// //       sourceContract: ForeignAddress(
// //         #"1d1e18e1a484d0a10623661546ba97defab7a7ae",
// //       ),
// //       targetChainId: 2,
// //       targetContract: demoInboundContract,
// //       gasLimit: 100,
// //       functionCallData: FunctionCallData {
// //         functionName: "test_function",
// //         functionArgs: args,
// //       },
// //     }

// //   //   datum.taskId == "task-0001"
// //   //   let redeemer = Redeemer { msg: "Aiken Rocks!" }
// //   //   let placeholder_utxo = OutputReference { transaction_id: "", output_index: 0 }
// //   let inbound_policy =
// //     #"00000000000000000000000000000000000000000000000000000000"
// //   let placeholder_utxo =
// //     OutputReference {
// //       transaction_id: #"00000000000000000000000000000000000000000000000000000000",
// //       output_index: 0,
// //     }

// //   // let transaction = Transaction { ..transaction.placeholder, }
// //   inbound.spend(
// //     inbound_policy,
// //     Some(datum),
// //     inbound_policy,
// //     placeholder_utxo,
// //     transaction.placeholder,
// //   )
// // }
