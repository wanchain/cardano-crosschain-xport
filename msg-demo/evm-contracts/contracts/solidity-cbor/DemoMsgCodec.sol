// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;


import {RFC8949Decoder} from "./CBORCodec.sol";

contract DemoMsgCodec {

    struct AdaAddress{
        bytes paymentKey;
        bool isPaymentScipt;
        bool hasStakeKey;
        bytes stackeKey;
        bool isStakeScript;
        }

    struct DemoMsg{
        AdaAddress receiverAda;
        bytes receiverEvm;
        bool isEvmChain;
        uint amount;
    }

    function bytesToString(bytes memory data) internal pure returns (string memory) {
        bytes memory strBytes = new bytes(data.length);
        for (uint i = 0; i < data.length; i++) {
            strBytes[i] = data[i];
        }
        return string(strBytes);
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

    function concatenate(string memory a, string memory b) public pure returns (string memory) {
        // 获取字符串长度
        uint256 aLength = bytes(a).length;
        uint256 bLength = bytes(b).length;
        
        // 创建新字符串缓冲区
        bytes memory result = new bytes(aLength + bLength);
        
        // 复制第一个字符串
        for (uint256 i = 0; i < aLength; i++) {
            result[i] = bytes(a)[i];
        }
        
        // 复制第二个字符串
        for (uint256 i = 0; i < bLength; i++) {
            result[aLength + i] = bytes(b)[i];
        }
        
        // 返回拼接结果
        return string(result);
    }

    function test2(bytes memory cbor) public pure returns (DemoMsg memory msgInfo){
        RFC8949Decoder.CborValue memory cb = RFC8949Decoder.decode(cbor);
        // msgInfo.tagNumber = len.tagNumber;
        msgInfo.amount = cb.arrayValue[0].arrayValue[1].intValue;
        // msgInfo.common = len.arrayValue[0].arrayValue[0].arrayValue[0].arrayValue[0].data;
        // require(len.arrayValue[0].arrayValue[0].arrayValue[0].arrayValue[0].majorType == RFC8949Decoder.MajorType.Bytes,"1eeeee");
    }


    // function decodeCborToMsg

    function parseToMsg(bytes memory cbor) public pure returns (DemoMsg memory msgInfo) {
        RFC8949Decoder.CborValue memory cb = RFC8949Decoder.decode(cbor);
        require(cb.arrayValue.length == 1,"cb.arrayValue.length == 1");
        RFC8949Decoder.CborValue memory fields = cb.arrayValue[0];
        require(fields.majorType == RFC8949Decoder.MajorType.Array,"fields.majorType == RFC8949Decoder.MajorType.Array");
        require(fields.arrayValue.length == 2,"error fields.arrayValue.length == 2");
        RFC8949Decoder.CborValue memory msgAddress = fields.arrayValue[0];
        require(msgAddress.tagNumber == 121 || msgAddress.tagNumber == 122,"tag neither 121 nor 122");
        require(msgAddress.arrayValue.length == 1,"msgAddress.arrayValue.length == 1");
        msgInfo.isEvmChain = msgAddress.tagNumber == 121;
        RFC8949Decoder.CborValue memory msgAddressFields = msgAddress.arrayValue[0];
        require(msgAddressFields.arrayValue.length == 1,"msgAddressFields.arrayValue.length == 1");
        RFC8949Decoder.CborValue memory receiver = msgAddressFields.arrayValue[0];
        if(msgInfo.isEvmChain){
            require(receiver.majorType == RFC8949Decoder.MajorType.Bytes,"receiver.majorType == RFC8949Decoder.MajorType.Bytes");
            require(receiver.data.length >= 20,"receiver.data.length");
            msgInfo.receiverEvm = receiver.data;//address(uint160(uint256(bytes32(receiver.data))));
        }else{
            require(receiver.majorType == RFC8949Decoder.MajorType.Tag,"receiver.majorType == RFC8949Decoder.MajorType.Tag");
            require(receiver.arrayValue.length == 1,"receiver.arrayValue.length == 1");
            RFC8949Decoder.CborValue memory adaAddress = receiver.arrayValue[0];
            require(adaAddress.arrayValue.length == 2,"adaAddress.arrayValue.length == 2");
        }
        
        require(fields.arrayValue[1].majorType == RFC8949Decoder.MajorType.UnsignedInt,"fields.arrayValue[1].majorType == RFC8949Decoder.MajorType.UnsignedInt");
        msgInfo.amount = fields.arrayValue[1].intValue;
        
    }

}
