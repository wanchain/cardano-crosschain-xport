// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {CardanoBech32} from "./Betch32.sol";

library CardanoAddressCodec {
    using CardanoBech32 for bytes;
    
    // Address type constant
    uint8 constant ADDR_TYPE_BASE = 0x00;      // Base address Type
    uint8 constant ADDR_TYPE_POINTER = 0x04;   // Pointer address Type
    uint8 constant ADDR_TYPE_ENTERPRISE = 0x06; // Enterprise address Type
    uint8 constant ADDR_TYPE_REWARD = 0x0E;     // Reward address type
    
    // Network ID constant
    uint8 constant NETWORK_TESTNET = 0x00;
    uint8 constant NETWORK_MAINNET = 0x01;
    
    struct DecodedAddress {
        bool isTestnet;
        uint8 addressType;       // address style：0=Base, 2=Enterprise, 4=Reward
        bool paymentIsScript;    // Is the payment a script
        bool stakeIsScript;      // Is the stake part a script（only Base address type）
        bytes paymentKeyHash;    // A 28-byte payment hash
        bytes stakeKeyHash;      // A 28-bytes stake hash（only Base address type）
        bytes pointerData;       // only Pointer address type (reserve)
    }
    
    /**
     * @dev decode Cardano address
     */
    function decodeAddress(
        string memory bech32Addr
    ) internal pure returns (DecodedAddress memory) {
        bytes memory addrBytes = bytes(bech32Addr);
        
        // Find the separator '1'
        int256 separatorPos = -1;
        for (uint256 i = 0; i < addrBytes.length; i++) {
            if (addrBytes[i] == '1') {
                separatorPos = int256(i);
                break;
            }
        }
        require(separatorPos >= 0, "No separator found");
        
        // retrieve HRP
        bytes memory hrp = new bytes(uint256(separatorPos));
        for (uint256 i = 0; i < uint256(separatorPos); i++) {
            hrp[i] = addrBytes[i];
        }
        
        // retrieve data part
        uint256 dataLength = addrBytes.length - uint256(separatorPos) - 1;
        bytes memory dataPart = new bytes(dataLength);
        for (uint256 i = 0; i < dataLength; i++) {
            dataPart[i] = addrBytes[uint256(separatorPos) + 1 + i];
        }

        // verify checksum adn decode the data
        (bool checksumValid, bytes memory decodedBytes) = _decodeBech32(hrp, dataPart);
        require(checksumValid, "Invalid checksum");
        
        return _parseAddressBytes(decodedBytes, hrp);
    }
    
    /**
     * @dev encode Cardano address
     */
    function encodeAddress(
        DecodedAddress memory decoded
    ) internal pure returns (string memory) {
        bytes memory hrp;
        bytes memory rawBytes;
        
        // build the head byte 
        uint8 header = _buildHeaderByte(decoded);
        
        // build data part and HRP
        if (decoded.addressType == ADDR_TYPE_BASE) { // Base
            require(decoded.paymentKeyHash.length == 28 && decoded.stakeKeyHash.length == 28, 
                "Invalid hash length for base address");
            rawBytes = abi.encodePacked(header, decoded.paymentKeyHash, decoded.stakeKeyHash);
            hrp = decoded.isTestnet ? bytes("addr_test") : bytes("addr");
        } 
        else if (decoded.addressType == ADDR_TYPE_ENTERPRISE) { // Enterprise
            require(decoded.paymentKeyHash.length == 28, "Invalid hash length for enterprise address");
            rawBytes = abi.encodePacked(header, decoded.paymentKeyHash);
            hrp = decoded.isTestnet ? bytes("addr_test") : bytes("addr");
        }
        else if (decoded.addressType == ADDR_TYPE_REWARD) { // Reward
            require(decoded.stakeKeyHash.length == 28, "Invalid hash length for reward address");
            rawBytes = abi.encodePacked(header, decoded.stakeKeyHash);
            hrp = decoded.isTestnet ? bytes("stake_test") : bytes("stake");
        }
        else if (decoded.addressType == ADDR_TYPE_POINTER) { // Pointer
            rawBytes = abi.encodePacked(header, decoded.paymentKeyHash, decoded.pointerData);
            hrp = decoded.isTestnet ? bytes("addr_test") : bytes("addr");
        }
        else {
            revert("Unsupported address type");
        }
        
        // encode to Bech32
        return _encodeBech32(string(hrp), rawBytes);
    }

    function _encodeBech32(
        string memory hrp
        ,bytes memory data
    ) internal pure returns (string memory) {

        bytes5[] memory data5 = CardanoBech32.convertTo5Bit(data);
        

        bytes5[] memory checksum = CardanoBech32.createChecksum(
            bytes(hrp),
            data5
        );
        

        bytes5[] memory combined = new bytes5[](data5.length + 6);
        for (uint256 i = 0; i < data5.length; i++) {
            combined[i] = data5[i];
        }
        for (uint256 i = 0; i < 6; i++) {
            combined[data5.length + i] = checksum[i];
        }
        
        // convert to charecters
        bytes memory charset = CardanoBech32.CHARSET;
        bytes memory result = new bytes(bytes(hrp).length + 1 + combined.length);
        
        // add HRP
        for (uint256 i = 0; i < bytes(hrp).length; i++) {
            result[i] = bytes(hrp)[i];
        }
        result[bytes(hrp).length] = '1';
        
        // add encoded data
        for (uint256 i = 0; i < combined.length; i++) {
            uint8 index = uint8(bytes1(combined[i]));
            require(index < 32, "Invalid 5-bit value");
            result[bytes(hrp).length + 1 + i] = charset[index];
        }
        
        return string(result);
    }
    
    /**
     * @dev Build the header byte
     */
    function _buildHeaderByte(DecodedAddress memory decoded) internal pure returns (uint8) {
        uint8 header = decoded.isTestnet ? NETWORK_TESTNET : NETWORK_MAINNET;
        
        // Set the address type bit
        header |= (decoded.addressType << 4);
        if (decoded.addressType == ADDR_TYPE_BASE) { // Base
            if (decoded.stakeIsScript) {
                header |= 0x20; // Set the stake script bit
            }
        } 
        
        // Set the type bit of the payment
        if (decoded.paymentIsScript) {
            header |= 0x10; // Set the payment script bit
        }
        
        return header;
    }
    
    /**
     * @dev Verify and decode BECH32 data
     */
    function _decodeBech32(
        bytes memory hrp,
        bytes memory dataPart
    ) internal pure returns (bool checksumValid, bytes memory decodedBytes) {
        // Convert to a 5-bit value
        bytes5[] memory data5 = new bytes5[](dataPart.length);
        bytes memory charset = CardanoBech32.CHARSET;
        
        for (uint256 i = 0; i < dataPart.length; i++) {
            bool found = false;
            for (uint8 j = 0; j < 32; j++) {
                if (dataPart[i] == charset[j]) {
                    data5[i] = bytes5(bytes1(j));
                    found = true;
                    break;
                }
            }
            require(found, "Invalid character in data part");
        }
        
        // Verify the checksum
        checksumValid = _verifyChecksum(hrp, data5);
        if (!checksumValid) {
            return (false, new bytes(0));
        }
        
        // Remove the checksum (the last 6 characters)
        bytes5[] memory dataWithoutChecksum = new bytes5[](data5.length - 6);
        for (uint256 i = 0; i < dataWithoutChecksum.length; i++) {
            dataWithoutChecksum[i] = data5[i];
        }
        
        // Convert to bytes
        decodedBytes = CardanoBech32.convertFrom5Bit(dataWithoutChecksum);
        return (true, decodedBytes);
    }
    
    /**
     * @dev Verify checksum
     */
    function _verifyChecksum(
        bytes memory hrp,
        bytes5[] memory data5
    ) internal pure returns (bool) {
        require(data5.length >= 6, "Data too short for checksum");
        
        // Separate the data from the checksum
        bytes5[] memory dataWithoutChecksum = new bytes5[](data5.length - 6);
        bytes5[] memory checksumReceived = new bytes5[](6);
        
        // Copy the data section
        for (uint256 i = 0; i < dataWithoutChecksum.length; i++) {
            dataWithoutChecksum[i] = data5[i];
        }
        
        // Copy the received checksum
        for (uint256 i = 0; i < 6; i++) {
            checksumReceived[i] = data5[dataWithoutChecksum.length + i];
        }
        
        // Calculate the expected checksum
        bytes5[] memory checksumCalculated = CardanoBech32.createChecksum(
            hrp,
            dataWithoutChecksum
        );
        
        // Compare checksum
        for (uint256 i = 0; i < 6; i++) {
            if (checksumReceived[i] != checksumCalculated[i]) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * @dev Parse the address byte
     */
    function _parseAddressBytes(
        bytes memory addrBytes,
        bytes memory hrp
    ) internal pure returns (DecodedAddress memory) {
        require(addrBytes.length >= 29, "Address too short");
        
        DecodedAddress memory decoded;
        
        // retrieve network
        string memory hrpStr = string(hrp);
        if (keccak256(bytes(hrpStr)) == keccak256(bytes("addr")) || 
            keccak256(bytes(hrpStr)) == keccak256(bytes("stake"))) {
            decoded.isTestnet = false;
        } else if (keccak256(bytes(hrpStr)) == keccak256(bytes("addr_test")) ||
                   keccak256(bytes(hrpStr)) == keccak256(bytes("stake_test"))) {
            decoded.isTestnet = true;
        } else {
            revert("Unknown HRP");
        }
        
        // Parse the header bytes
        uint8 header = uint8(addrBytes[0]);
        
        // Extract the network ID (the lower 4 digits)
        uint8 networkId = header & 0x0F;
        require(
            (decoded.isTestnet && networkId == NETWORK_TESTNET) || 
            (!decoded.isTestnet && networkId == NETWORK_MAINNET),
            "Network ID mismatch"
        );
        
        // Extract the address type (3 bits out of the high 4 bits)
        decoded.addressType = (header >> 4) & 0x0E;
        
        // 提取支付凭证类型（位4）
        decoded.paymentIsScript = ((header >> 4) & 0x01) == 1;
        
        // Parse based on the address type
        if (decoded.addressType == ADDR_TYPE_BASE) { // Base
            require(addrBytes.length == 57, "Invalid Base address length");
            
            // Type of rights certificate for extraction (Digit 3)
            decoded.stakeIsScript = ((header >> 3) & 0x01) == 1;
            
            // Extract the hash of the payment key (bytes 1-28)
            decoded.paymentKeyHash = new bytes(28);
            for (uint256 i = 0; i < 28; i++) {
                decoded.paymentKeyHash[i] = addrBytes[1 + i];
            }
            
            // Extract the hash of the equity key (bytes 29-56)
            decoded.stakeKeyHash = new bytes(28);
            for (uint256 i = 0; i < 28; i++) {
                decoded.stakeKeyHash[i] = addrBytes[29 + i];
            }
            
        } else if (decoded.addressType == ADDR_TYPE_ENTERPRISE) { // Enterprise
            require(addrBytes.length == 29, "Invalid Enterprise address length");
            
            decoded.paymentKeyHash = new bytes(28);
            for (uint256 i = 0; i < 28; i++) {
                decoded.paymentKeyHash[i] = addrBytes[1 + i];
            }
            
        } else if (decoded.addressType == ADDR_TYPE_REWARD) { // Reward
            require(addrBytes.length == 29, "Invalid Reward address length");
            
            decoded.stakeKeyHash = new bytes(28);
            for (uint256 i = 0; i < 28; i++) {
                decoded.stakeKeyHash[i] = addrBytes[1 + i];
            }
            
        } else if (decoded.addressType == ADDR_TYPE_POINTER) { // Pointer

            uint256 pointerLength = addrBytes.length - 29; // Subtract 1 byte from the header + 28 bytes from the payment hash
            decoded.paymentKeyHash = new bytes(28);
            for (uint256 i = 0; i < 28; i++) {
                decoded.paymentKeyHash[i] = addrBytes[1 + i];
            }
            
            decoded.pointerData = new bytes(pointerLength);
            for (uint256 i = 0; i < pointerLength; i++) {
                decoded.pointerData[i] = addrBytes[29 + i];
            }
            
        } else {
            revert("Unsupported address type");
        }
        
        return decoded;
    }
    
    /**
     * @dev validate the address is valid
     */
    // function validateAddress(
    //     string memory bech32Addr
    // ) internal view returns (bool) {
    //     try decodeAddress(bech32Addr) returns (DecodedAddress memory) {
    //         return true;
    //     } catch {
    //         return false;
    //     }
    // }
    
    /**
     * @dev Create a Base address (testnet) from the hash, just for testing
     */
    function createTestnetBaseAddress(
        bytes28 paymentKeyHash,
        bytes28 stakeKeyHash,
        bool paymentIsScript,
        bool stakeIsScript
    ) internal pure returns (string memory) {
        DecodedAddress memory decoded;
        decoded.isTestnet = true;
        decoded.addressType = 0x00; // Base地址
        decoded.paymentIsScript = paymentIsScript;
        decoded.stakeIsScript = stakeIsScript;
        decoded.paymentKeyHash = abi.encodePacked(paymentKeyHash);
        decoded.stakeKeyHash = abi.encodePacked(stakeKeyHash);
        
        return encodeAddress(decoded);
    }
    
    /**
     * @dev Create a Base address from the hash (mainnet), just for testing
     */
    function createBaseAddress(
        bytes28 paymentKeyHash,
        bytes28 stakeKeyHash,
        bool paymentIsScript,
        bool stakeIsScript,
        bool isTestnet
    ) internal pure returns (string memory) {
        DecodedAddress memory decoded;
        decoded.isTestnet = isTestnet;
        decoded.addressType = 0x00; // Base
        decoded.paymentIsScript = paymentIsScript;
        decoded.stakeIsScript = stakeIsScript;
        decoded.paymentKeyHash = abi.encodePacked(paymentKeyHash);
        decoded.stakeKeyHash = abi.encodePacked(stakeKeyHash);
        
        return encodeAddress(decoded);
    }
}