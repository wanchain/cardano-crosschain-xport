# Wanchain Message Bridge (WMB)

Wanchain Message Bridge (WMB) is a decentralized messaging protocol that allows messages to be transmitted between different blockchain networks, including Wanchain and other networks.

The protocol is implemented through the Wanchain Message Bridge smart contracts, which enable the transmission of messages between different chains.

1. Contracts
The contract code mainly consists of two parts: one part is WmbGateway, and the other part is WmbApp and WmbRetryableApp.

1.1 XToken(./contracts/examples/XToken.sol)
The XToken is Erc20 contract just for testing message crosschain between Wanchain(testnet) and Cardano(preprod).

1.2 WMB Gateway (./contracts/WmbGateway.sol)
The WMB Gateway is a smart contract that acts as an intermediary between the Wanchain Message Bridge and the external blockchain networks. It provides a secure and efficient mechanism for transferring messages between the different networks. 

1.3 TokenHome (./contracts/examples/TokenBridgeV2/ERC20TokenHome4CardanoV2.sol)
The TokenHome is a smart contract for user in Wanchain to send token to Cardano address, and also can receicve token from Cardano.


2. Deployment
The smart contracts in this project are compiled and deployed using Hardhat. We have prepared the ABI files for the relevant contracts for you, and the related contracts have already been deployed on the Wanchain testnet. The corresponding information are as follows:

2.1 Contract ABI
TokenHome SC ABI: ./deployed/scAbi/ERC20TokenHome4CardanoV2.json
Erc20 SC ABI: ./deployed/scAbi/XToken.json

2.2 Deployed Contracts Config
1) Contracts in Wanchain Testnet
./deployed/wanTestnet.json

2) Contracts in Cardano Preprod
./deployed/cardanoPreprod.json


3. Test Script
In this project, you can cross GXToken from Wanchain to Cardano, You can modify the “targetAddr” and “amount” parameters in the test script, then run: 

yarn hardhat --network wanchainTestnet test  test/TestMsgTask4Outbound.js

