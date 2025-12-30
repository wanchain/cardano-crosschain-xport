# Wanchain Message Bridge (WMB)

Wanchain Message Bridge (WMB) is a decentralized messaging protocol that allows messages to be transmitted between different blockchain networks, including Wanchain and other networks.

The protocol is implemented through the Wanchain Message Bridge smart contracts, which enable the transmission of messages between different chains.

# Contracts

The contract code for demo mainly consists of three part: XToken, WMB Gateway and TokenHome.

## XToken(./contracts/examples/XToken.sol)

The XToken is Erc20 contract just for testing message crosschain between Wanchain(testnet) and Cardano(preprod).

## WMB Gateway (./contracts/WmbGateway.sol)

The WMB Gateway is a smart contract that acts as an intermediary between the Wanchain Message Bridge and the external blockchain networks. It provides a secure and efficient mechanism for transferring messages between the different networks. 

NOTE： The WMB Gateway contract can only be deployed by the official Wanchain team.

## TokenHome (./contracts/examples/TokenBridgeV2/ERC20TokenHome4CardanoV2.sol)

The TokenHome is a smart contract for user in Wanchain to send token to Cardano address, and also can receicve token from Cardano.


# Deployment

The smart contracts in this project are compiled and deployed using Hardhat. We have prepared the ABI files for the relevant contracts for you, and the related contracts have already been deployed on the Wanchain testnet. The corresponding information are as follows:

## Contract ABI

1. TokenHome SC ABI:   

./deployed/scAbi/ERC20TokenHome4CardanoV2.json

2. Erc20 SC ABI:       

./deployed/scAbi/XToken.json

## Deployed Contracts Config

1. Deployed Contracts in Wanchain Testnet (./deployed/wanTestnet.json)

{

  "XToken": "0x0B40EF8f0bA69C39f8dD7Eeab073275c72593aa2",
  
  "WmbGateway": "0xDDddd58428706FEdD013b3A761c6E40723a7911d",
  
  "TokenHome": "0xd6Ed4F1F50Cae0c5c7F514F3D0B1220c4a78F71d"
  
}

2. Deployed Contracts in Cardano Preprod (./deployed/cardanoPreprod.json)

{

  "PEER_TOKENREMOTE_INBOUND": "addr_test1wqzjepm5l3jepgqv42h292u56l5fcsuz8q6j6qtwyvldusq4qmy4n",
  
  "PEER_TOKENREMOTE_OUTBOUND": "addr_test1wzu6ldpnxd7gdc0h5fyrt53utrk6ynudl6w304wc2sh7u9c3vl5le"
  
}

# Test Script

In this project, you can cross GXToken from Wanchain to Cardano, You can update the “targetAddr” and “amount” parameters in the test script, then run: 

yarn hardhat --network wanchainTestnet test  test/TestMsgTask4Outbound.js

## Demo transactions (From Wanchain To Cardano)

https://testnet.wanscan.org/tx/0x5120c402cf2b3e5065d5fa5f5b07a94c00b003c0df57c730c243419a12c65161?type=msg

https://testnet.wanscan.org/tx/0x7c1d28e7c30bf866caa010a25cd72843b6dd6daf8a315d60af7206df32da8c2c?type=msg

https://testnet.wanscan.org/tx/0x5f5f386b902ea4b157e8fd615b48e4c5b38e93a9833a1f7dfc506b795380941a?type=msg

## Demo transactions (From Cardano To Wanchain)

https://testnet.wanscan.org/tx/d9faa3ee8779f61539a9dd4626212c8be5572fca2ced3d11432d4e8e63c61a79?type=msg

https://testnet.wanscan.org/tx/51e04e670a4aefd9c580e1f3e1200e0da561b11c2dd3d0da2c9581e173a9904c?type=msg


