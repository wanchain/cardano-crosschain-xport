/**
 * EVM→Cardano relay for cross-chain E2E tests.
 *
 * Watches for MessageDispatchedNonEvm events on the WmbGateway contract.
 * When detected, creates an inbound proof transaction on Cardano using
 * the same Ed25519 signing logic as msg-agent/test/helpers/inbound.ts.
 *
 * This simulates what the Wanchain Storeman Group relay does in production:
 * observing EVM events → creating signed proofs on Cardano → the msg-agent
 * then processes them (burns inbound token, mints bridge tokens).
 */

import { ethers } from 'ethers';

/**
 * Placeholder: The actual EVM→Cardano relay requires:
 *
 * 1. Listen for MessageDispatchedNonEvm events on the gateway
 * 2. Parse the event to extract: messageId, sender, toChainId, to, gasLimit, data
 * 3. If toChainId == CARDANO_CHAIN_ID:
 *    a. Build CrossMsgData datum from the event data
 *    b. Create an Ed25519 proof (same as createInboundTask)
 *    c. Submit the inbound proof tx on Cardano
 *
 * This is more complex than the Cardano→EVM relay because it requires:
 * - Access to the Cardano deployment (check tokens, inbound mint check)
 * - Ed25519 signing with the deployed GPK
 * - Building a Cardano transaction (MeshTxBuilder)
 *
 * For Phase 2 MVP, we'll implement this as a direct function call
 * from the test (not a background watcher), since the test controls
 * both the EVM send and the Cardano proof creation.
 */

export interface EvmToCardanoRelayConfig {
    gateway: ethers.Contract;
    cardanoChainId: number;
}

/**
 * Extract MessageDispatchedNonEvm events from a transaction receipt.
 */
export function extractDispatchedMessages(
    gateway: ethers.Contract,
    receipt: ethers.providers.TransactionReceipt,
): Array<{
    messageId: string;
    sender: string;
    toChainId: number;
    to: string;
    gasLimit: number;
    data: string;
}> {
    const eventTopic = gateway.interface.getEventTopic('MessageDispatchedNonEvm');
    const messages: Array<{
        messageId: string;
        sender: string;
        toChainId: number;
        to: string;
        gasLimit: number;
        data: string;
    }> = [];

    for (const log of receipt.logs) {
        if (log.topics[0] !== eventTopic) continue;
        try {
            const parsed = gateway.interface.parseLog(log);
            messages.push({
                messageId: parsed.args.messageId,
                sender: parsed.args.sender,
                toChainId: parsed.args.toChainId.toNumber(),
                to: parsed.args.to,
                gasLimit: parsed.args.gasLimit.toNumber(),
                data: parsed.args.data,
            });
        } catch {
            // Skip unparseable logs
        }
    }

    return messages;
}
