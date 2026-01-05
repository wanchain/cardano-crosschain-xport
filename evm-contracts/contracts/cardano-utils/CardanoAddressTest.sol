
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {CardanoBech32} from "./Betch32.sol";
import {CardanoAddressCodec} from './CardanoAddress.sol';

contract CardanoAddressExample {

    
    /**
     * @dev Example: Decoding address
     */
    function decodeAddressExample(string memory bech32Addr, bool f) public pure returns (
        bool isTestnet,
        uint8 addressType,
        bytes28 paymentKeyHash,
        bool paymentIsScript,
        bytes28 stakeKeyHash,
        bool stakeIsScript,
        string memory addr
    ) {
        CardanoAddressCodec.DecodedAddress memory decoded = CardanoAddressCodec.decodeAddress(bech32Addr);
        isTestnet = decoded.isTestnet;
        addressType = decoded.addressType;
        paymentKeyHash = bytes28(decoded.paymentKeyHash);
        paymentIsScript = decoded.paymentIsScript;
        stakeKeyHash = bytes28(decoded.stakeKeyHash);
        stakeIsScript = decoded.stakeIsScript;

        if(f) addr = CardanoAddressCodec.encodeAddress(decoded);

        
    }
    
    /**
     * @dev Generate the reward address
     */
    function generateRewardAddress(
        bytes28 stakeKeyHash,
        bool isTestnet,
        bool stakeIsScript
    ) public pure returns (string memory) {
        CardanoAddressCodec.DecodedAddress memory decoded;
        decoded.isTestnet = isTestnet;
        decoded.addressType = 0x0E; // Reward地址
        decoded.paymentIsScript = false;
        decoded.stakeIsScript = stakeIsScript;
        // decoded.paymentKeyHash = abi.encodePacked(paymentKeyHash);
        decoded.stakeKeyHash = abi.encodePacked(stakeKeyHash); 
        return CardanoAddressCodec.encodeAddress(decoded);
    }
    
    /**
     * @dev Verify the address and extract the information
     */
    function extractAddressInfo(string memory addr) external pure returns (
        string memory network,
        string memory typeStr,
        bytes memory keyHash
    ) {
        // require(this.validateAddress(addr), "Invalid address");
        
        CardanoAddressCodec.DecodedAddress memory decoded = CardanoAddressCodec.decodeAddress(addr);
        
        // 网络信息
        network = decoded.isTestnet ? "Testnet" : "Mainnet";
        
        // 地址类型
        if (decoded.addressType == 0x01) {
            typeStr = "Base Address";
            keyHash = abi.encodePacked(decoded.paymentKeyHash, decoded.stakeKeyHash);
        } else if (decoded.addressType == 0x06) {
            typeStr = "Enterprise Address";
            keyHash = abi.encodePacked(decoded.paymentKeyHash);
        } else if (decoded.addressType == 0x0E) {
            typeStr = "Reward Address";
            keyHash = abi.encodePacked(decoded.stakeKeyHash);
        } else if (decoded.addressType == 0x04) {
            typeStr = "Pointer Address";
            keyHash = decoded.pointerData;
        } else {
            typeStr = "Unknown";
            keyHash = new bytes(0);
        }
    }
}