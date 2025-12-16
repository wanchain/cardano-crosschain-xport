<!--
 * @Author: liulin blue-sky-dl5@163.com
 * @Date: 2025-12-16 14:26:25
 * @LastEditors: liulin blue-sky-dl5@163.com
 * @LastEditTime: 2025-12-16 19:52:46
 * @FilePath: /cardano-crosschain-xport/msg-agent/README.md
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
-->
# msg-agent

## Description

Msg-agent is a message broker base on xport used to handle token cross-chain transfer. It receives messages from other chains via "xport" and mint demo token to user account specified by address field.
And it also sends the message to the other chain for token cross-chain transfer via xport.

## Functions

- Receive messages from other chains:
  - xport will mint a inbountToken utxo to inbountDemo contract when a cross-chain transfer message is sent on other chain.The msg-agent monitors the utxos at the inbountDemo contract address to detect the cross-chain transfer message, and then to mint demo token to user account specified by address field, and the minting amount specified by amount field.
- Forward messages to other chains:
  - The msg-agent monitors the utxos with the demo token at the outbountDemo contract address to detect the cross-chain transfer message to other chain, and the msg-agent will burn the demo token of the utxo , which will forward the message to be the other chain via xport, and the other chain will mint a demo token the receiver account on target chain.
- User initiates a cross-chain transfer message:
  - User sends a cross-chain transfer message to the msg-agent by send a utxo with demo token to the outbount contract address.

## how to use

1. install dependencies

```bash
yarn install

```
2. config .evn 
```txt
BLOCKFROST_API_KEY=<YOUR BLOCKFROST API KEY>
ACCOUNT_SEED1=<inbound monitor account privateKey 32 bytes> // like 0000000000000000000000000000000000000000000000000000000000000000
ACCOUNT_SEED2=<outbound monitor account privateKey 32 bytes>
ACCOUNT_SEED3=<user account privateKey 32 bytes>

```
3. Run: cd /PATH_msg-agent/
- Monitor: node --experimental-network-inspection -r ts-node/register ./src/index.ts monitor
- UserClient: node --experimental-network-inspection -r ts-node/register ./src/index.ts client