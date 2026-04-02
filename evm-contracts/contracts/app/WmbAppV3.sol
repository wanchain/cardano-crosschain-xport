// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IWmbGatewayV2 {

    function dispatchMessageV2(uint256 toChainId, address to, uint256 gasLimit, bytes calldata data) external payable returns (bytes32 messageId);
    function dispatchMessageNonEvm(uint256 toChainId, bytes memory to, uint256 gasLimit, bytes calldata data) external payable returns (bytes32 messageId);
}

abstract contract WmbAppV3 is Ownable {

    address public wmbGateway;
    // mapping (uint => mapping(bytes32 => bool)) public trustedRemotes;
    mapping (uint => mapping(bytes => bool)) public trustedRemotes;

    event SetTrustedRemote(uint256 fromChainId, bytes from, bool trusted);

    constructor(address _wmbGateway) {
        require(_wmbGateway != address(0), "WmbAppV3: gateway cannot be zero address");
        wmbGateway = _wmbGateway;
    }

    function wmbReceiveNonEvm(
        bytes calldata data,
        bytes32 messageId,
        uint256 fromChainId,
        bytes memory from
    ) virtual external {
        
        // Only the WMB gateway can call this function
        require(msg.sender == wmbGateway, "WmbApp: Only WMB gateway can call this function");
        require(trustedRemotes[fromChainId][from], "WmbApp: Remote is not trusted");
        
        _wmbReceive(data, messageId, fromChainId, from);
    }

    function _wmbReceive(
        bytes calldata data,
        bytes32 messageId,
        uint256 fromChainId,
        bytes memory from
    ) virtual internal;

    function _dispatchMessageNonEvm(uint256 toChainId, bytes memory to, uint256 gasLimit, bytes memory data) internal returns (bytes32 messageId) {
        return IWmbGatewayV2(wmbGateway).dispatchMessageNonEvm{value: msg.value}(toChainId, to, gasLimit, data);
    }


    function setTrustedRemoteNonEvm(uint fromChainId, bytes memory from, bool trusted) external onlyOwner {
        _setTrustedRemoteNonEvm(fromChainId, from, trusted);
    }

    function _setTrustedRemoteNonEvm(uint fromChainId, bytes memory from, bool trusted) internal {
        // bytes32 fromHash = keccak256(from);
        trustedRemotes[fromChainId][from] = trusted;

        emit SetTrustedRemote(fromChainId, from, trusted);
    }
}