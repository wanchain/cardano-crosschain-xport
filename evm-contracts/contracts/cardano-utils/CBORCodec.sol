// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

library SimpleValue {
    uint8 constant False = 20;
    uint8 constant True = 21;
    uint8 constant Null = 22;
    uint8 constant Undefined = 23;
    uint8 constant Simple8Bit = 24;
    uint8 constant HalfFloat = 25;
    uint8 constant SingleFloat = 26;
    uint8 constant DoubleFloat = 27;
    uint8 constant Break = 31;
}

library RFC8949 {
    // CBOR Major Type Enum
    enum MajorType {
        UnsignedInt,    // 0
        NegativeInt,    // 1
        Bytes,          // 2
        Text,           // 3
        Array,          // 4
        Map,            // 5
        Tag,            // 6
        Simple          // 7
    }

    struct CborValue {
        MajorType majorType;
        bytes data; // Used for storing byte strings, text strings or more complex data
        uint256 intValue; // Used for storing integer, simple value
        CborValue[] arrayValue; //  dynamic array for storing array items
        uint256 tagNumber; // tag number
    }

    struct Encoder {
        bytes buffer;
    }
    
    struct Decoder {
        bytes data;
        uint256 index;
    }

    // ==================== decode ====================

    function decode(bytes memory cborData) internal pure returns (CborValue memory) {
        Decoder memory decoder = Decoder(cborData, 0);
        return _decodeItem(decoder);
    }

    function _decodeItem(Decoder memory decoder) private pure returns (CborValue memory value) {
        require(decoder.index < decoder.data.length, "Insufficient data");
        uint8 firstByte = uint8(decoder.data[decoder.index]);
        decoder.index++;

        MajorType majorType = MajorType(firstByte >> 5);
        uint8 additionalInfo = firstByte & 0x1F;

        if (majorType == MajorType.UnsignedInt || majorType == MajorType.NegativeInt) {
            return _decodeInteger(decoder, majorType, additionalInfo);
        } else if (majorType == MajorType.Bytes || majorType == MajorType.Text) {
            return _decodeBytesOrText(decoder, majorType, additionalInfo);
        } else if (majorType == MajorType.Array || majorType == MajorType.Map) {
            return _decodeArrayOrMap(decoder, majorType, additionalInfo);
        } else if (majorType == MajorType.Tag) {
            return _decodeTag(decoder, additionalInfo);
        } else {
            return _decodeSimple(decoder, additionalInfo);
        }
    }

    function _decodeLength(Decoder memory decoder, uint8 additionalInfo) private pure returns (uint64 length) {
        if (additionalInfo < 24) {
            return additionalInfo;
        } else if (additionalInfo == 24) {
            return uint64(uint8(decoder.data[decoder.index++]));
        } else if (additionalInfo == 25) {
            length = (uint64(uint8(decoder.data[decoder.index])) << 8) | uint64(uint8(decoder.data[decoder.index + 1]));
            decoder.index += 2;
        } else if (additionalInfo == 26) {
            length = (uint64(uint8(decoder.data[decoder.index])) << 24) | 
                     (uint64(uint8(decoder.data[decoder.index + 1])) << 16) | 
                     (uint64(uint8(decoder.data[decoder.index + 2])) << 8) | 
                     uint64(uint8(decoder.data[decoder.index + 3]));
            decoder.index += 4;
        } else if (additionalInfo == 27) {
            length = (uint64(uint8(decoder.data[decoder.index])) << 56) |
                     (uint64(uint8(decoder.data[decoder.index + 1])) << 48) |
                     (uint64(uint8(decoder.data[decoder.index + 2])) << 40) |
                     (uint64(uint8(decoder.data[decoder.index + 3])) << 32) |
                     (uint64(uint8(decoder.data[decoder.index + 4])) << 24) |
                     (uint64(uint8(decoder.data[decoder.index + 5])) << 16) |
                     (uint64(uint8(decoder.data[decoder.index + 6])) << 8) |
                     uint64(uint8(decoder.data[decoder.index + 7]));
            decoder.index += 8;
        } else if (additionalInfo == 31) {
            return type(uint64).max;
        }
        return length;
    }

    function _decodeInteger(Decoder memory decoder, MajorType majorType, uint8 additionalInfo) private pure returns (CborValue memory) {
        uint64 length = _decodeLength(decoder, additionalInfo);
        uint256 intVal = uint256(length);
        CborValue memory value;
        value.majorType = majorType;
        
        if (majorType == MajorType.NegativeInt) {

            if (intVal == 0) {
                value.intValue = 0;
            } else {
                value.intValue = intVal - 1;
            }
        } else {
            value.intValue = intVal;
        }
        return value;
    }

    function _decodeBytesOrText(Decoder memory decoder, MajorType majorType, uint8 additionalInfo) private pure returns (CborValue memory) {
        uint64 length = _decodeLength(decoder, additionalInfo);
        require(decoder.index + length <= decoder.data.length, "Data out of bounds");
        
        CborValue memory value;
        value.majorType = majorType;
        bytes memory temp = new bytes(length);
        
        for (uint64 i = 0; i < length; i++) {
            temp[i] = decoder.data[decoder.index + i];
        }
        decoder.index += length;
        value.data = temp;
        return value;
    }

    function _decodeArrayOrMap(Decoder memory decoder, MajorType majorType, uint8 additionalInfo) private pure returns (CborValue memory) {
        uint64 length = _decodeLength(decoder, additionalInfo);
        CborValue memory value;
        value.majorType = majorType;

        if (majorType == MajorType.Array) {
            if (length == type(uint64).max) {
    
                while (true) {
                    if (decoder.index >= decoder.data.length) break;
                    if (uint8(decoder.data[decoder.index]) == 0xFF) {
                        decoder.index++;
                        break;
                    }
                    value.arrayValue = _extendArray(value.arrayValue, _decodeItem(decoder));
                }
            } else {
                value.arrayValue = new CborValue[](length);
                for (uint64 i = 0; i < length; i++) {
                    value.arrayValue[i] = _decodeItem(decoder);
                }
            }
        } else {
            // Map
            if (length == type(uint64).max) {
                while (true) {
                    if (decoder.index >= decoder.data.length) break;
                    if (uint8(decoder.data[decoder.index]) == 0xFF) {
                        decoder.index++;
                        break;
                    }
                    CborValue memory key = _decodeItem(decoder);
                    CborValue memory val = _decodeItem(decoder);
                    value.arrayValue = _extendArray(value.arrayValue, key);
                    value.arrayValue = _extendArray(value.arrayValue, val);
                }
            } else {
                value.arrayValue = new CborValue[](length * 2);
                for (uint64 i = 0; i < length; i++) {
                    value.arrayValue[i * 2] = _decodeItem(decoder);
                    value.arrayValue[i * 2 + 1] = _decodeItem(decoder);
                }
            }
        }
        return value;
    }

    function _decodeTag(Decoder memory decoder, uint8 additionalInfo) private pure returns (CborValue memory) {
        uint64 tagNum = _decodeLength(decoder, additionalInfo);
        CborValue memory value;
        value.majorType = MajorType.Tag;
        value.tagNumber = tagNum;
        
        CborValue[] memory taggedValues = new CborValue[](1);
        taggedValues[0] = _decodeItem(decoder);
        value.arrayValue = taggedValues;
        return value;
    }

    function _decodeSimple(Decoder memory decoder, uint8 additionalInfo) private pure returns (CborValue memory) {
        CborValue memory value;
        value.majorType = MajorType.Simple;
        
        if (additionalInfo == SimpleValue.False) {
            value.intValue = 0;
        } else if (additionalInfo == SimpleValue.True) {
            value.intValue = 1;
        } else if (additionalInfo == SimpleValue.Null) {
            value.intValue = 0;
        } else if (additionalInfo == SimpleValue.Undefined) {
            value.intValue = 0;
        } else if (additionalInfo == SimpleValue.Simple8Bit) {
            uint8 simpleByte = uint8(decoder.data[decoder.index++]);
            value.intValue = simpleByte;
        } else if (additionalInfo == SimpleValue.HalfFloat) {
            bytes memory temp = new bytes(2);
            temp[0] = decoder.data[decoder.index++];
            temp[1] = decoder.data[decoder.index++];
            value.data = temp;
        } else if (additionalInfo == SimpleValue.SingleFloat) {
            bytes memory temp = new bytes(4);
            for (uint i = 0; i < 4; i++) {
                temp[i] = decoder.data[decoder.index++];
            }
            value.data = temp;
        } else if (additionalInfo == SimpleValue.DoubleFloat) {
            bytes memory temp = new bytes(8);
            for (uint i = 0; i < 8; i++) {
                temp[i] = decoder.data[decoder.index++];
            }
            value.data = temp;
        } else if (additionalInfo == SimpleValue.Break) {
            value.intValue = 0;
        } else {
            value.intValue = additionalInfo;
        }
        
        return value;
    }

    function _extendArray(CborValue[] memory arr, CborValue memory newElement) private pure returns (CborValue[] memory) {
        CborValue[] memory newArr = new CborValue[](arr.length + 1);
        for (uint i = 0; i < arr.length; i++) {
            newArr[i] = arr[i];
        }
        newArr[arr.length] = newElement;
        return newArr;
    }

    // ==================== encode ====================

    function encode(CborValue memory value) internal pure returns (bytes memory) {
        Encoder memory encoder = Encoder(new bytes(0));
        _encodeItem(encoder, value);
        return encoder.buffer;
    }

    function _appendByte(Encoder memory encoder, uint8 byteValue) private pure {
        bytes memory newBuffer = new bytes(encoder.buffer.length + 1);
        for (uint i = 0; i < encoder.buffer.length; i++) {
            newBuffer[i] = encoder.buffer[i];
        }
        newBuffer[encoder.buffer.length] = bytes1(byteValue);
        encoder.buffer = newBuffer;
    }

    function _appendBytes(Encoder memory encoder, bytes memory data) private pure {
        bytes memory newBuffer = new bytes(encoder.buffer.length + data.length);
        for (uint i = 0; i < encoder.buffer.length; i++) {
            newBuffer[i] = encoder.buffer[i];
        }
        for (uint i = 0; i < data.length; i++) {
            newBuffer[encoder.buffer.length + i] = data[i];
        }
        encoder.buffer = newBuffer;
    }

    /**
     * @dev Encoded integers (unsigned and negative integers)
     */
    function _encodeInteger(Encoder memory encoder, MajorType majorType, uint256 value) private pure {
        uint8 majorTypeByte = uint8(majorType) << 5;
        
        if (majorType == MajorType.NegativeInt) {
           
            require(value <= type(uint64).max, "Value too large for negative integer");
            uint256 n = value + 1;
            
            if (n < 24) {
                _appendByte(encoder, majorTypeByte | uint8(n));
            } else if (n <= 0xFF) {
                _appendByte(encoder, majorTypeByte | 24);
                _appendByte(encoder, uint8(n));
            } else if (n <= 0xFFFF) {
                _appendByte(encoder, majorTypeByte | 25);
                _appendBytes(encoder, _toBigEndian(uint16(n), 2));
            } else if (n <= 0xFFFFFFFF) {
                _appendByte(encoder, majorTypeByte | 26);
                _appendBytes(encoder, _toBigEndian(uint32(n), 4));
            } else {
                _appendByte(encoder, majorTypeByte | 27);
                _appendBytes(encoder, _toBigEndian(uint64(n), 8));
            }
        } else {
            if (value < 24) {
                _appendByte(encoder, majorTypeByte | uint8(value));
            } else if (value <= 0xFF) {
                _appendByte(encoder, majorTypeByte | 24);
                _appendByte(encoder, uint8(value));
            } else if (value <= 0xFFFF) {
                _appendByte(encoder, majorTypeByte | 25);
                _appendBytes(encoder, _toBigEndian(uint16(value), 2));
            } else if (value <= 0xFFFFFFFF) {
                _appendByte(encoder, majorTypeByte | 26);
                _appendBytes(encoder, _toBigEndian(uint32(value), 4));
            } else if (value <= type(uint64).max) {
                _appendByte(encoder, majorTypeByte | 27);
                _appendBytes(encoder, _toBigEndian(uint64(value), 8));
            } else {
                revert("Value too large for uint64, use Tag 2 for bignum");
            }
        }
    }

    function _toBigEndian(uint256 value, uint8 length) private pure returns (bytes memory) {
        bytes memory result = new bytes(length);
        for (uint8 i = 0; i < length; i++) {
            result[length - 1 - i] = bytes1(uint8(value >> (8 * i)));
        }
        return result;
    }

    function _encodeItem(Encoder memory encoder, CborValue memory value) private pure {
        if (value.majorType == MajorType.UnsignedInt) {
            _encodeInteger(encoder, MajorType.UnsignedInt, value.intValue);
        } else if (value.majorType == MajorType.NegativeInt) {
            _encodeInteger(encoder, MajorType.NegativeInt, value.intValue);
        } else if (value.majorType == MajorType.Bytes) {

            uint8 majorTypeByte = uint8(MajorType.Bytes) << 5;
            uint64 length = uint64(value.data.length);
            
            if (length < 24) {
                _appendByte(encoder, majorTypeByte | uint8(length));
            } else if (length <= 0xFF) {
                _appendByte(encoder, majorTypeByte | 24);
                _appendByte(encoder, uint8(length));
            } else if (length <= 0xFFFF) {
                _appendByte(encoder, majorTypeByte | 25);
                _appendBytes(encoder, _toBigEndian(uint16(length), 2));
            } else if (length <= 0xFFFFFFFF) {
                _appendByte(encoder, majorTypeByte | 26);
                _appendBytes(encoder, _toBigEndian(uint32(length), 4));
            } else {
                _appendByte(encoder, majorTypeByte | 27);
                _appendBytes(encoder, _toBigEndian(uint64(length), 8));
            }
            
            _appendBytes(encoder, value.data);
        } else if (value.majorType == MajorType.Text) {

            uint8 majorTypeByte = uint8(MajorType.Text) << 5;
            uint64 length = uint64(value.data.length);
            
            if (length < 24) {
                _appendByte(encoder, majorTypeByte | uint8(length));
            } else if (length <= 0xFF) {
                _appendByte(encoder, majorTypeByte | 24);
                _appendByte(encoder, uint8(length));
            } else if (length <= 0xFFFF) {
                _appendByte(encoder, majorTypeByte | 25);
                _appendBytes(encoder, _toBigEndian(uint16(length), 2));
            } else if (length <= 0xFFFFFFFF) {
                _appendByte(encoder, majorTypeByte | 26);
                _appendBytes(encoder, _toBigEndian(uint32(length), 4));
            } else {
                _appendByte(encoder, majorTypeByte | 27);
                _appendBytes(encoder, _toBigEndian(uint64(length), 8));
            }
            
            _appendBytes(encoder, value.data);
        } else if (value.majorType == MajorType.Array) {

            uint8 majorTypeByte = uint8(MajorType.Array) << 5;
            uint64 length = uint64(value.arrayValue.length);
            
            if (length < 24) {
                _appendByte(encoder, majorTypeByte | uint8(length));
            } else if (length <= 0xFF) {
                _appendByte(encoder, majorTypeByte | 24);
                _appendByte(encoder, uint8(length));
            } else if (length <= 0xFFFF) {
                _appendByte(encoder, majorTypeByte | 25);
                _appendBytes(encoder, _toBigEndian(uint16(length), 2));
            } else if (length <= 0xFFFFFFFF) {
                _appendByte(encoder, majorTypeByte | 26);
                _appendBytes(encoder, _toBigEndian(uint32(length), 4));
            } else {
                _appendByte(encoder, majorTypeByte | 27);
                _appendBytes(encoder, _toBigEndian(uint64(length), 8));
            }
            
            for (uint i = 0; i < value.arrayValue.length; i++) {
                _encodeItem(encoder, value.arrayValue[i]);
            }
        } else if (value.majorType == MajorType.Map) {
 
            uint8 majorTypeByte = uint8(MajorType.Map) << 5;
            uint64 pairCount = uint64(value.arrayValue.length / 2);
            
            if (pairCount < 24) {
                _appendByte(encoder, majorTypeByte | uint8(pairCount));
            } else if (pairCount <= 0xFF) {
                _appendByte(encoder, majorTypeByte | 24);
                _appendByte(encoder, uint8(pairCount));
            } else if (pairCount <= 0xFFFF) {
                _appendByte(encoder, majorTypeByte | 25);
                _appendBytes(encoder, _toBigEndian(uint16(pairCount), 2));
            } else if (pairCount <= 0xFFFFFFFF) {
                _appendByte(encoder, majorTypeByte | 26);
                _appendBytes(encoder, _toBigEndian(uint32(pairCount), 4));
            } else {
                _appendByte(encoder, majorTypeByte | 27);
                _appendBytes(encoder, _toBigEndian(uint64(pairCount), 8));
            }
            
            for (uint i = 0; i < value.arrayValue.length; i += 2) {
                _encodeItem(encoder, value.arrayValue[i]);
                _encodeItem(encoder, value.arrayValue[i + 1]);
            }
        } else if (value.majorType == MajorType.Tag) {

            uint8 majorTypeByte = uint8(MajorType.Tag) << 5;
            uint256 tagNumber = value.tagNumber;
            
            if (tagNumber < 24) {
                _appendByte(encoder, majorTypeByte | uint8(tagNumber));
            } else if (tagNumber <= 0xFF) {
                _appendByte(encoder, majorTypeByte | 24);
                _appendByte(encoder, uint8(tagNumber));
            } else if (tagNumber <= 0xFFFF) {
                _appendByte(encoder, majorTypeByte | 25);
                _appendBytes(encoder, _toBigEndian(uint16(tagNumber), 2));
            } else if (tagNumber <= 0xFFFFFFFF) {
                _appendByte(encoder, majorTypeByte | 26);
                _appendBytes(encoder, _toBigEndian(uint32(tagNumber), 4));
            } else if (tagNumber <= type(uint64).max) {
                _appendByte(encoder, majorTypeByte | 27);
                _appendBytes(encoder, _toBigEndian(uint64(tagNumber), 8));
            } else {
                revert("Tag number too large");
            }
            
            if (value.arrayValue.length > 0) {
                _encodeItem(encoder, value.arrayValue[0]);
            }
        } else if (value.majorType == MajorType.Simple) {

            uint8 majorTypeByte = uint8(MajorType.Simple) << 5;
            
            if (value.data.length == 0) {
                if (value.intValue == 0) {
                    _appendByte(encoder, majorTypeByte | SimpleValue.False);
                } else if (value.intValue == 1) {
                    _appendByte(encoder, majorTypeByte | SimpleValue.True);
                } else if (value.intValue == 0) {
                    _appendByte(encoder, majorTypeByte | SimpleValue.Null);
                } else {
                    require(value.intValue < 32, "Simple value out of range");
                    _appendByte(encoder, majorTypeByte | uint8(value.intValue));
                }
            } else {
                if (value.data.length == 2) {
                    _appendByte(encoder, majorTypeByte | SimpleValue.HalfFloat);
                } else if (value.data.length == 4) {
                    _appendByte(encoder, majorTypeByte | SimpleValue.SingleFloat);
                } else if (value.data.length == 8) {
                    _appendByte(encoder, majorTypeByte | SimpleValue.DoubleFloat);
                } else {
                    revert("Invalid float length");
                }
                _appendBytes(encoder, value.data);
            }
        }
    }


    function encodeUint(uint256 value) internal pure returns (bytes memory) {
        CborValue memory cborValue;
        cborValue.majorType = MajorType.UnsignedInt;
        cborValue.intValue = value;
        return encode(cborValue);
    }

    function encodeInt(int256 value) internal pure returns (bytes memory) {
        CborValue memory cborValue;
        if (value >= 0) {
            cborValue.majorType = MajorType.UnsignedInt;
            cborValue.intValue = uint256(value);
        } else {
            cborValue.majorType = MajorType.NegativeInt;

            cborValue.intValue = uint256(-value) - 1;
        }
        return encode(cborValue);
    }

    function encodeBytes(bytes memory data) internal pure returns (bytes memory) {
        CborValue memory cborValue;
        cborValue.majorType = MajorType.Bytes;
        cborValue.data = data;
        return encode(cborValue);
    }

    function encodeString(string memory str) internal pure returns (bytes memory) {
        CborValue memory cborValue;
        cborValue.majorType = MajorType.Text;
        cborValue.data = bytes(str);
        return encode(cborValue);
    }

    function encodeArray(CborValue[] memory items) internal pure returns (bytes memory) {
        CborValue memory cborValue;
        cborValue.majorType = MajorType.Array;
        cborValue.arrayValue = items;
        return encode(cborValue);
    }

    function encodeMap(CborValue[] memory pairs) internal pure returns (bytes memory) {
        require(pairs.length % 2 == 0, "Pairs must be even");
        CborValue memory cborValue;
        cborValue.majorType = MajorType.Map;
        cborValue.arrayValue = pairs;
        return encode(cborValue);
    }

    function encodeTag(uint256 tagNumber, CborValue memory taggedValue) internal pure returns (bytes memory) {
        CborValue memory cborValue;
        cborValue.majorType = MajorType.Tag;
        cborValue.tagNumber = tagNumber;
        CborValue[] memory taggedValues = new CborValue[](1);
        taggedValues[0] = taggedValue;
        cborValue.arrayValue = taggedValues;
        return encode(cborValue);
    }

    function encodeBool(bool value) internal pure returns (bytes memory) {
        CborValue memory cborValue;
        cborValue.majorType = MajorType.Simple;
        cborValue.intValue = value ? 1 : 0;
        return encode(cborValue);
    }

    function encodeNull() internal pure returns (bytes memory) {
        CborValue memory cborValue;
        cborValue.majorType = MajorType.Simple;
        cborValue.intValue = 0;
        return encode(cborValue);
    }

    function intToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function toHex(CborValue memory value) internal pure returns (string memory) {
        bytes memory encoded = encode(value);
        bytes memory hexString = new bytes(encoded.length * 2);
        bytes memory hexChars = "0123456789abcdef";
        
        for (uint i = 0; i < encoded.length; i++) {
            hexString[i * 2] = hexChars[uint8(encoded[i] >> 4)];
            hexString[i * 2 + 1] = hexChars[uint8(encoded[i] & 0x0F)];
        }
        
        return string(hexString);
    }
}

contract CborExample {
    using RFC8949 for RFC8949.CborValue;
    
    function testEncodeDecodeUint(uint256 num) public pure returns (uint256) {
        bytes memory encoded = RFC8949.encodeUint(num);
        RFC8949.CborValue memory decoded = RFC8949.decode(encoded);
        
        require(decoded.majorType == RFC8949.MajorType.UnsignedInt, "Should be unsigned int");
        require(decoded.intValue == num, "Value mismatch");
        return decoded.intValue;
    }
    
    function testEncodeDecodeString(string memory str) public pure returns (string memory) {
        bytes memory encoded = RFC8949.encodeString(str);
        RFC8949.CborValue memory decoded = RFC8949.decode(encoded);
        
        require(decoded.majorType == RFC8949.MajorType.Text, "Should be text");
        return string(decoded.data);
    }
    
    function sampleTest(bytes memory cbor) public pure returns(bool) {
        RFC8949.CborValue memory ret = RFC8949.decode(cbor);
        bytes memory cbor2 = RFC8949.encode(ret);
        return keccak256(cbor) == keccak256(cbor2);
    }
    
    function encodeUintTest(uint256 n) public pure returns (bytes memory) {
        bytes memory encoded = RFC8949.encodeUint(n);
        
        RFC8949.CborValue memory decoded = RFC8949.decode(encoded);
        
        require(decoded.majorType == RFC8949.MajorType.UnsignedInt, "Should be UnsignedInt");
        require(decoded.intValue == n, "Value mismatch");
        return encoded;
    }
    
    function testEncodeDecodeArray(uint256[] memory numbers) public pure returns (uint256[] memory) {
        RFC8949.CborValue[] memory items = new RFC8949.CborValue[](numbers.length);
        for (uint i = 0; i < numbers.length; i++) {
            items[i].majorType = RFC8949.MajorType.UnsignedInt;
            items[i].intValue = numbers[i];
        }
        
        bytes memory encoded = RFC8949.encodeArray(items);
        RFC8949.CborValue memory decoded = RFC8949.decode(encoded);
        
        require(decoded.majorType == RFC8949.MajorType.Array, "Should be array");
        
        uint256[] memory result = new uint256[](decoded.arrayValue.length);
        for (uint i = 0; i < decoded.arrayValue.length; i++) {
            result[i] = decoded.arrayValue[i].intValue;
        }
        
        return result;
    }
    
    function testComplexStructure() public pure returns (bytes memory) {
        RFC8949.CborValue[] memory arrayItems = new RFC8949.CborValue[](4);
        

        arrayItems[0].majorType = RFC8949.MajorType.UnsignedInt;
        arrayItems[0].intValue = 1;
        

        arrayItems[1].majorType = RFC8949.MajorType.Text;
        arrayItems[1].data = bytes("hello");
        

        arrayItems[2].majorType = RFC8949.MajorType.Simple;
        arrayItems[2].intValue = 1; // true
        
        // null
        arrayItems[3].majorType = RFC8949.MajorType.Simple;
        arrayItems[3].intValue = 0; 
        
        return RFC8949.encodeArray(arrayItems);
    }

    function eq_cbor_value(RFC8949.CborValue memory a, RFC8949.CborValue memory b) internal pure returns (bool){
        bool sub1 = a.majorType == b.majorType 
        && a.intValue == b.intValue 
        && keccak256(abi.encodePacked(a.data)) == keccak256(abi.encodePacked(b.data))
        && a.tagNumber == b.tagNumber
        && a.arrayValue.length == b.arrayValue.length;
        if(!sub1) return false;

        if(a.arrayValue.length > 0){
            for (uint i; i < a.arrayValue.length; i++) {
                if(!eq_cbor_value(a.arrayValue[i],b.arrayValue[i])) return false;
            }
        }
        return true;
    }
    function test(bytes memory cbor) public pure returns (bool){
        RFC8949.CborValue memory cborValue = RFC8949.decode(cbor);
        bytes memory cbor2 = RFC8949.encode(cborValue);
        RFC8949.CborValue memory cborValue2 = RFC8949.decode(cbor2);
        // return keccak256(abi.encodePacked(cbor)) == keccak256(abi.encodePacked(cbor2));
        return eq_cbor_value(cborValue, cborValue2);
    }

    function test2(bytes memory cbor1, bytes memory cbor2) public pure returns(bool){
        RFC8949.CborValue memory cborValue1 = RFC8949.decode(cbor1);
        RFC8949.CborValue memory cborValue2 = RFC8949.decode(cbor2);
        return eq_cbor_value(cborValue1, cborValue2);
    }

    function test3(bytes memory cbor) public pure returns (bytes memory){
        RFC8949.CborValue memory cborValue = RFC8949.decode(cbor);
        return RFC8949.encode(cborValue);
    }
}