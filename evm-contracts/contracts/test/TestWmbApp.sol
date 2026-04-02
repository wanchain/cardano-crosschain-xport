// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../app/WmbAppV3.sol";

/**
 * @title TestWmbApp
 * @dev Minimal concrete implementation of WmbAppV3 used only in tests.
 *      Both abstract hooks are left as no-ops so the contract compiles and
 *      the gateway can call wmbReceiveNonEvm() without reverting inside the
 *      application logic.
 */
contract TestWmbApp is WmbAppV3 {
    // Storage to record the last received call (useful for integration checks)
    bytes   public lastData;
    bytes32 public lastMessageId;
    uint256 public lastFromChainId;
    bytes   public lastFrom;

    constructor(address _gateway) WmbAppV3(_gateway) {}

    // ── Abstract implementations ─────────────────────────────────────────────

    function _wmbReceive(
        bytes calldata data,
        bytes32 messageId,
        uint256 fromChainId,
        bytes memory from
    ) internal override {
        lastData        = data;
        lastMessageId   = messageId;
        lastFromChainId = fromChainId;
        lastFrom        = from;
    }

    // ── Expose _dispatchMessageNonEvm for integration tests ──────────────────

    function sendNonEvm(
        uint256 toChainId,
        bytes memory to,
        uint256 gasLimit,
        bytes memory data
    ) external payable returns (bytes32) {
        return _dispatchMessageNonEvm(toChainId, to, gasLimit, data);
    }
}
