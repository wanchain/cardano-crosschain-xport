# msg-agent

## Description

Msg-agent is a message broker base on xport used to handle token cross-chain transfer. It receives messages from other chains via "xport" and mint demo token to user account specified by address field.
And it also sends the message to the other chain for token cross-chain transfer via xport.

## Functions

- Receive messages from other chains:
  - xport will mint a inbountToken utxo to inbountDemo contract when a cross-chain transfer message is sent on other chain.The msg-agent monitors the utxos at the inbountDemo contract address to detect the cross-chain transfer message, and then to mint demo token to user account specified by address field, and the minting amount specified by amount field.
- User initiates a cross-chain transfer message:
  - User sends a cross-chain transfer message to the msg-agent by send a utxo with demo token to the outbount contract address, and the msg-agent will burn the demo token of the utxo , which will make the message to be sent the other chain via xport, and the other chain will mint a demo token the receiver account on target chain.

## how to use

1. install dependencies

```bash
yarn install

```
2. Run: node --experimental-network-inspection -r ts-node/register ./src/index.ts msg-agent/src/index.ts