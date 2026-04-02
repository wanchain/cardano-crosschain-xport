// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

library RFC8949Decoder {
    // CBOR主类型 (Major Type) 枚举
    enum MajorType {
        UnsignedInt,    // 0
        NegativeInt,    // 1
        Bytes,          // 2
        Text,           // 3
        Array,          // 4
        Map,            // 5
        Tag,            // 6 - 你关注的语义标签
        Simple          // 7 - 包含浮点数和布尔值等
    }

    // 浮点数类型 (属于主类型7)
    enum FloatType {
        False,
        True,
        Null,
        Undefined,
        HalfPrecision, // 16-bit
        SinglePrecision, // 32-bit
        DoublePrecision, // 64-bit
        Break, // 用于中断无限长数组/映射
        Unassigned,
        SimpleValue // 1字节简单值（如0-255）
    }

    // 解码后的值容器（模拟联合体）
    struct CborValue {
        MajorType majorType;
        bytes data; // 用于存储字节串、文本串或更复杂数据的原始CBOR字节
        uint256 intValue; // 用于存储（负）整数、标签号、简单值
        // FloatType floatType;
        CborValue[] arrayValue; // 动态数组用于存储数组元素
        // // 映射的存储更复杂，此处用数组对模拟
        // // struct MapEntry {
        // //     CborValue key;
        // //     CborValue value;
        // // }
        // // MapEntry[] mapValue;
        // // 语义标签的额外信息
        uint256 tagNumber; // 标签号，例如102, 121
        // CborValue taggedValue; // 标签所包裹的数据项
    }

    // 解码状态
    struct Decoder {
        bytes data;
        uint256 index;
    }

    function decode(bytes memory cborData) internal pure returns (CborValue memory) {
        Decoder memory decoder = Decoder(cborData, 0);
        return _decodeItem(decoder);
    }

    // 递归解码单个数据项
    function _decodeItem(Decoder memory decoder) private pure returns (CborValue memory value) {
        require(decoder.index < decoder.data.length, "Insufficient data");
        uint8 firstByte = uint8(decoder.data[decoder.index]);
        decoder.index++;

        MajorType majorType = MajorType(firstByte >> 5); // 取高3位
        uint8 additionalInfo = firstByte & 0x1F; // 取低5位

        // 根据主类型和附加信息进行解码分配
        if (majorType == MajorType.UnsignedInt || majorType == MajorType.NegativeInt) {
            return _decodeInteger(decoder, majorType, additionalInfo);
        } else if (majorType == MajorType.Bytes || majorType == MajorType.Text) {
            return _decodeBytesOrText(decoder, majorType, additionalInfo);
        } else if (majorType == MajorType.Array || majorType == MajorType.Map) {
            return _decodeArrayOrMap(decoder, majorType, additionalInfo);
        } else if (majorType == MajorType.Tag) {
            return _decodeTag(decoder, additionalInfo);
        } else { // MajorType.Simple
            return _decodeSimpleOrFloat(decoder, additionalInfo);
        }
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

    function _decodeLength(Decoder memory decoder, uint8 additionalInfo) private pure returns (uint64 length) {
        if (additionalInfo < 24) {
            return additionalInfo;
        } else if (additionalInfo == 24) {
            return uint64(uint8(decoder.data[decoder.index++]));
        } else if (additionalInfo == 25) {
            length = (uint64(uint8(decoder.data[decoder.index])) << 8) | uint64(uint8(decoder.data[decoder.index + 1]));
            decoder.index += 2;
        } else if (additionalInfo == 26) {
            length = (uint64(uint8(decoder.data[decoder.index])) << 24) |  (uint64(uint8(decoder.data[decoder.index+1 ])) << 16) | (uint64(uint8(decoder.data[decoder.index+2])) << 8) | uint64(uint8(decoder.data[decoder.index + 3]));
            decoder.index += 4;
            // ... 处理4字节长度，以此类推
        } else if (additionalInfo == 27) {
            // ... 处理8字节长度
            length = (uint64(uint8(decoder.data[decoder.index])) << 56) 
            |(uint64(uint8(decoder.data[decoder.index+1])) << 48) 
            |  (uint64(uint8(decoder.data[decoder.index+2 ])) << 40) 
            | (uint64(uint8(decoder.data[decoder.index+3])) << 32) 
            |(uint64(uint8(decoder.data[decoder.index+ 4])) << 24) 
            |  (uint64(uint8(decoder.data[decoder.index+5 ])) << 16) 
            | (uint64(uint8(decoder.data[decoder.index+6])) << 8) 
            | uint64(uint8(decoder.data[decoder.index + 7]));
            decoder.index += 8;
        } else if (additionalInfo == 31) {
            // 特殊值31表示“无限长”，用于数组和映射
            return type(uint64).max; // 用最大值作为“无限长”的标记
        }
        return length;
    }

    function _decodeInteger(Decoder memory decoder, MajorType majorType, uint8 additionalInfo) private pure returns (CborValue memory) {
        uint64 length = _decodeLength(decoder, additionalInfo);
        uint256 intVal = uint256(length);
        CborValue memory value;
        value.majorType = majorType;
        if (majorType == MajorType.NegativeInt) {
            // CBOR负整数编码为 -1 - n
            value.intValue = type(uint256).max - intVal;
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

    function extendArray(CborValue[] memory arr, CborValue memory newElement) internal pure returns (CborValue[] memory) {
        CborValue[] memory newArr = new CborValue[](arr.length + 1);
        for (uint i = 0; i < arr.length; i++) {
            newArr[i] = arr[i];
        }
        newArr[arr.length] = newElement;
        return newArr;
    }

    function _decodeArrayOrMap(Decoder memory decoder, MajorType majorType, uint8 additionalInfo) private pure returns (CborValue memory) {
        uint64 length = _decodeLength(decoder, additionalInfo);
        CborValue memory value;
        value.majorType = majorType;

        if (majorType == MajorType.Array) {
            if (length == type(uint64).max) { // 无限长数组
                while (true) {
                    // 检查是否遇到Break停止码（0xFF）
                    if (decoder.index < decoder.data.length && uint8(decoder.data[decoder.index]) == 0xFF) {
                        decoder.index++;
                        break;
                    }
                    value.arrayValue = extendArray(value.arrayValue,_decodeItem(decoder));
                }
            } else {
                value.arrayValue = new CborValue[](length);
                for (uint64 i = 0; i < length; i++) {
                    value.arrayValue[i] = _decodeItem(decoder);
                }
            }
        } else { // Map
            if (length == type(uint64).max) {
                while (true) {
                    if (decoder.index >= decoder.data.length) break;
                    if (uint8(decoder.data[decoder.index]) == 0xFF) {
                        decoder.index++;
                        break;
                    }
                    CborValue memory key = _decodeItem(decoder);
                    CborValue memory val = _decodeItem(decoder);
                    value.arrayValue = extendArray(value.arrayValue, key);
                    value.arrayValue = extendArray(value.arrayValue, val);
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

    // 核心：语义标签解码
    function _decodeTag(Decoder memory decoder, uint8 additionalInfo) private pure returns (CborValue memory) {
        uint64 tagNum = _decodeLength(decoder, additionalInfo);
        CborValue memory value;
        value.majorType = MajorType.Tag;
        value.tagNumber = tagNum;
        // 递归解码标签所包裹的数据项
        value.arrayValue = extendArray(value.arrayValue,_decodeItem(decoder));
        return value;
    }

    function _decodeSimpleOrFloat(Decoder memory decoder, uint8 additionalInfo) private pure returns (CborValue memory) {
        CborValue memory value;
        value.majorType = MajorType.Simple;
        // ... 处理布尔值、Null、Undefined以及各种精度的浮点数
        // 例如，附加信息为 20, 21 分别代表 false, true
        // 附加信息为 25, 26, 27 分别代表半、单、双精度浮点数
        return value;
    }
}