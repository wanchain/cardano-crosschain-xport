// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

library CardanoBech32 {
    // BECH32 character set
    bytes constant CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    
    /**
     * @dev Generate the BECH32 checksum
     * @param hrp address prefix
     * @param data address payment and stake part
     * @return  - checksum
     */
    function createChecksum(
        bytes memory hrp,
        bytes5[] memory data
    ) internal pure returns (bytes5[] memory) {
        uint256[] memory values = new uint256[](data.length + hrp.length * 2 + 7);
        uint256 index = 0;
        
        for (uint256 i = 0; i < hrp.length; i++) {
            values[index++] = uint256(uint8(hrp[i])) >> 5;
        }
        values[index++] = 0;
        for (uint256 i = 0; i < hrp.length; i++) {
            values[index++] = uint256(uint8(hrp[i])) & 31;
        }
        
        for (uint256 i = 0; i < data.length; i++) {
            values[index++] = uint256(uint8(bytes1(data[i])));
        }
        
        for (uint256 i = 0; i < 6; i++) {
            values[index++] = 0;
        }
        
        // caculate checksum
        uint256 polymod = 1;
        for (uint256 i = 0; i < values.length; i++) {
            uint256 b = polymod >> 25;
            polymod = ((polymod & 0x1FFFFFF) << 5) ^ values[i];
            
            if (b & 1 != 0) polymod ^= 0x3B6A57B2;
            if (b & 2 != 0) polymod ^= 0x26508E6D;
            if (b & 4 != 0) polymod ^= 0x1EA119FA;
            if (b & 8 != 0) polymod ^= 0x3D4233DD;
            if (b & 16 != 0) polymod ^= 0x2A1462B3;
        }
        polymod ^= 1;
        
        // format checksum
        bytes5[] memory checksum = new bytes5[](6);
        for (uint256 i = 0; i < 6; i++) {
            checksum[i] = bytes5(bytes1(uint8((polymod >> (5 * (5 - i))) & 31)));
        }
        
        return checksum;
    }
    
    /**
     * @dev Convert bytes to a 5-bit array
     */
    function convertTo5Bit(bytes memory data) internal pure returns (bytes5[] memory) {
        // uint256 bitCount = 0;
        uint256 maxV = (1 << 5) - 1;
        bytes5[] memory result = new bytes5[]((data.length * 8 + 4) / 5);
        uint256 resultIndex = 0;
        uint256 buffer = 0;
        uint256 bits = 0;
        
        for (uint256 i = 0; i < data.length; i++) {
            buffer = (buffer << 8) | uint256(uint8(data[i]));
            bits += 8;
            
            while (bits >= 5) {
                bits -= 5;
                result[resultIndex++] = bytes5(bytes1(uint8((buffer >> bits) & maxV)));
            }
        }
        
        if (bits > 0) {
            result[resultIndex++] = bytes5(bytes1(uint8((buffer << (5 - bits)) & maxV)));
        }
        
        return result;
    }
    
    /**
     * @dev Convert a 5-bit array to bytes
     */
    function convertFrom5Bit(bytes5[] memory data5) internal pure returns (bytes memory) {
        uint256 buffer = 0;
        uint256 bits = 0;
        bytes memory result = new bytes((data5.length * 5 + 7) / 8 -1);
        uint256 resultIndex = 0;
        
        for (uint256 i = 0; i < data5.length; i++) {
            buffer = (buffer << 5) | uint256(uint8(bytes1(data5[i])));
            bits += 5;
            
            while (bits >= 8) {
                bits -= 8;
                result[resultIndex++] = bytes1(uint8((buffer >> bits) & 0xFF));
            }
        }
        
        return result;
    }
}
