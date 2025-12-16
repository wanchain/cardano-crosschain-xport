use aiken/collection/list
use aiken/option.{is_none}
use cardano/address.{Address}
use cardano/assets.{Value, merge}
use cardano/transaction.{Input, Output}

pub type MintRedeemer {
  MintViaMsg
  Burn
}

pub type MsgAddress {
  ForeignAddress(ByteArray)
  LocalAddress(Address)
}

pub type Beneficiary {
  address: MsgAddress,
  amount: Int,
}

pub type FunctionCallData {
  functionName: ByteArray,
  functionArgs: ByteArray,
}

pub type CrossMsgData {
  taskId: ByteArray,
  sourceChainId: Int,
  sourceContract: MsgAddress,
  targetChainId: Int,
  targetContract: MsgAddress,
  gasLimit: Int,
  functionCallData: FunctionCallData,
}

pub fn value_at_address(outputs: List<Output>, addr: Address) -> Value {
  outputs
    |> list.foldl(
        assets.zero,
        fn(output, acc) {
          let Output { address, value, .. } = output
          if address == addr {
            merge(value, acc)
          } else {
            acc
          }
        },
      )
}

pub fn outputsAt(outputs: List<Output>, addr: Address) -> List<Output> {
  outputs |> list.filter(fn(output) { output.address == addr })
}

pub fn total_input_value(inputs: List<Input>, addr: Option<Address>) -> Value {
  inputs
    |> list.foldl(
        assets.zero,
        fn(input, acc) {
          let Input { output, .. } = input
          let Output { address, value, .. } = output
          if is_none(addr) || Some(address) == addr {
            merge(value, acc)
          } else {
            acc
          }
        },
      )
}
