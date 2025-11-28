# cardano-crosschain-xport
Cardano scripts for XPort crosschain.

## Overview
This repository contains the scripts for implementing the XPort cross-chain protocol on the Cardano blockchain. XPort is a protocol used for transmitting messages between Cardano and various other blockchains, such as Ethereum, etc.


## Usage
When third-party applications integrate XPort, the following rules must be followed:
### Message Format
Third-party applications need to follow the message format defined by the XPort protocol as follows
``` haskell
data CrossMsgData = CrossMsgData
  {
    taskId :: BuiltinByteString
    , sourceChainId :: Integer
    , sourceContract :: MsgAddress
    , targetChainId :: Integer
    , targetContract :: MsgAddress
    , gasLimit :: Integer
    , functionCallData :: FunctionCallData
  }deriving (Show,  Prelude.Eq)
  
  data MsgAddress = ForeignAddress BuiltinByteString | LocalAddress Address deriving (Show, Prelude.Eq)
  
  data FunctionCallData = FunctionCallData
  {
    functionName :: BuiltinByteString
    , functionArgs :: BuiltinByteString
  }deriving (Show, Prelude.Eq)
  ```

1. taskId：Unique identifier for the message。
2. sourceChainId：The source blockchain id of the message
3. sourceContract：The contract address of the initiator of the message
4. targetChainId：The destination blockchain id of the message
5. targetContract：The contract address of the destination of this message。
6. gasLimit: The upper limit of gas required for the message to be executed on the target chain。
7. functionCallData：Message execution parameters，including：
    functionName：The name of the function that executes the message on the target chain，ascii
    functionArgs：The parameters of the calling function are encoded in cbor。

### InBound Message:
The Xport system will mint an InboundToken to the address of the third-party contract specified in the message. This Utxo containing Inbound tokens is defined as Inbound UTXO, and its datum is CrossMsgData, which is the message.The third-party is responsible for verifying the legitimacy of the Inbount Token when excuting the message, both the Inbound Token policy and token name.The token name must be the scriptHash of the targetcontract addresst.
### OutBound Message:
When a third-party application initiates an Outbound message:
1. Should call the OutboundToken contract to Mint an OutboundToken to the address of the XPort contract. This output is defined as an Outbound UTXO.
2. The datum of an Outbound UTXO is CrossMsgData, which is the message. The taskId is a fixed empty string, and the final value of taskId will be generated based on the outbound Tx hash after tx submited.
3. The contract of the third-party application is responsible for verifying the legitimacy of the datum of the Outbound UTXO, including the source, destination, gasLimit, functionCallData, etc. of the message.


