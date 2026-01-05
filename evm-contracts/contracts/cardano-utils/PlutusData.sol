// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;


import {RFC8949} from "./CBORCodec.sol";
import {CardanoAddressCodec} from './CardanoAddress.sol';

library PlutusDataCodec {

    function newConstr(uint alternative, uint fieldsCount) internal pure returns (RFC8949.CborValue memory plutusData){
        plutusData.majorType = RFC8949.MajorType.Tag;
        plutusData.tagNumber = alternative + 121;

        plutusData.arrayValue = new RFC8949.CborValue[](1); //Fields
        plutusData.arrayValue[0] = newArray(fieldsCount);
    }

    function newArray(uint size) internal pure returns (RFC8949.CborValue memory plutusData){
        plutusData.majorType = RFC8949.MajorType.Array;
        plutusData.arrayValue = new RFC8949.CborValue[](size);
    }

    function addConstrField(RFC8949.CborValue memory plutusData, RFC8949.CborValue memory field,uint index) internal pure {
        require(plutusData.majorType == RFC8949.MajorType.Tag,"not constr");
        require(plutusData.arrayValue.length == 1, "bad constr");
        appendArray(plutusData.arrayValue[0],field,index);
    }

    function fieldSize(RFC8949.CborValue memory plutusData) internal pure returns (uint){
        require(plutusData.majorType == RFC8949.MajorType.Tag,"not constr");
        require(plutusData.arrayValue.length == 1,"plutusData.arrayValue.length == 1");
        RFC8949.CborValue memory fileds = plutusData.arrayValue[0];
        require(fileds.majorType == RFC8949.MajorType.Array,"fileds.majorType == RFC8949.MajorType.Array");
        return fileds.arrayValue.length;
    }

    function getConstrField(RFC8949.CborValue memory plutusData, uint index) internal pure returns (RFC8949.CborValue memory){
        require(plutusData.majorType == RFC8949.MajorType.Tag,"not constr");
        uint length = plutusData.arrayValue[0].arrayValue.length;
        require(index < length,"index out of bound");

        return plutusData.arrayValue[0].arrayValue[index];
    }

    function toPlutusDataInteger(uint64 n) internal pure returns (RFC8949.CborValue memory ret){
        ret.majorType = RFC8949.MajorType.UnsignedInt;
        ret.intValue = n;
    }

    function toPlutusDataBytes(bytes memory data) internal pure returns (RFC8949.CborValue memory ret){
        ret.majorType = RFC8949.MajorType.Bytes;
        ret.data = data;
    }

    function appendArray(RFC8949.CborValue memory arrayPlutusData, RFC8949.CborValue memory item, uint index) internal pure {
        require(arrayPlutusData.majorType == RFC8949.MajorType.Array,"not a arrayplutusdata");
        require(arrayPlutusData.arrayValue.length > index, "index out of bound");
        arrayPlutusData.arrayValue[index] = item;
    }

    function plutusDataAsAdaAddress(RFC8949.CborValue memory plutusData) internal pure returns (CardanoAddressCodec.DecodedAddress memory ret){
        require(plutusData.majorType == RFC8949.MajorType.Tag,"not Ada address plutusData 1");
        require(plutusData.tagNumber == 121,"not Ada address plutusData 2");
        uint length = fieldSize(plutusData);
        require(length == 2,"not Ada address plutusData 3");

        RFC8949.CborValue memory paymentCredentialPlutusData = getConstrField(plutusData,0);
        RFC8949.CborValue memory stakeMaybeCredentialPlutusData = getConstrField(plutusData,1);


        (ret.paymentKeyHash,ret.paymentIsScript) = plutusDataAsCredential(paymentCredentialPlutusData);
        (ret.stakeKeyHash,ret.stakeIsScript) = plutusDataAsMaybeStakeCredential(stakeMaybeCredentialPlutusData);

    }

    function plutusDataAsCredential(RFC8949.CborValue memory plutusData) internal pure returns (bytes memory hash, bool isScriptHash){
        require(plutusData.majorType == RFC8949.MajorType.Tag,"not Ada credential plutusData 1");
        require(plutusData.tagNumber == 121 || plutusData.tagNumber == 122,"not Ada credential plutusData 2");
        uint length = fieldSize(plutusData);
        require(length == 1,"not Ada credential plutusData 3");

        RFC8949.CborValue memory hashCborValue = getConstrField(plutusData, 0);
        require(hashCborValue.majorType == RFC8949.MajorType.Bytes,"not Ada credential plutusData 4");
        require(hashCborValue.data.length == 28,"not Ada credential plutusData 5");

        isScriptHash = plutusData.tagNumber == 122? true : false;
        hash = hashCborValue.data;
    }

    function toPlutusDataCredential(bytes memory pubKeyOrScriptHash, bool isScriptHash) internal pure returns (RFC8949.CborValue memory){
        uint alternative = isScriptHash?1:0;
        RFC8949.CborValue memory credential = newConstr(alternative,1);

        RFC8949.CborValue memory hash;
        hash.majorType = RFC8949.MajorType.Bytes;
        hash.data = pubKeyOrScriptHash;

        addConstrField(credential,hash,0);

        return credential;
    }

    function plutusDataAsStakeCredential(RFC8949.CborValue memory plutusData) internal pure returns (bytes memory hash, bool isScriptHash){
        require(plutusData.majorType == RFC8949.MajorType.Tag,"not Ada stakecredential plutusData 1");
        uint length = fieldSize(plutusData);
        require(length == 1,"not Ada stakecredential plutusData 3");

        RFC8949.CborValue memory credentialPlutusData = getConstrField(plutusData, 0);
        (hash, isScriptHash) = plutusDataAsCredential(credentialPlutusData);
    }

    function toPlutusDataStakeCredential(bytes memory pubKeyOrScriptHash, bool isScript) internal pure returns (RFC8949.CborValue memory ){
        RFC8949.CborValue memory stakingCredential = newConstr(0, 1);//only supports StakingHash Credential not StakingPtr Integer Integer Integer
        addConstrField(stakingCredential, toPlutusDataCredential(pubKeyOrScriptHash,isScript),0);

        return stakingCredential;
    }

    function plutusDataAsMaybeStakeCredential(RFC8949.CborValue memory plutusData) internal pure returns (bytes memory hash, bool isScriptHash){
        require(plutusData.majorType == RFC8949.MajorType.Tag,"not Ada stakeMaybecredential plutusData 1");
        if(plutusData.tagNumber == 121){
            uint length = fieldSize(plutusData);
            require(length == 1,"not Ada stakeMaybecredential plutusData 2");
            RFC8949.CborValue memory stakingCredential = getConstrField(plutusData, 0);
            (hash, isScriptHash) = plutusDataAsStakeCredential(stakingCredential);
        }else{
            hash = new bytes(0);
            isScriptHash = false;
        }
    }

    function toPlutuMaybeStakeCredential(bytes memory pubKeyOrScriptHash, bool isScript)internal pure returns (RFC8949.CborValue memory){
        uint alternative = pubKeyOrScriptHash.length == 0 ? 1: 0;
        uint fieldsCount = alternative == 1 ? 0 : 1;
        RFC8949.CborValue memory maybeStakingCredential = newConstr(alternative, fieldsCount);
       
        if(alternative == 0){
            addConstrField(maybeStakingCredential,toPlutusDataStakeCredential(pubKeyOrScriptHash,isScript),0);
        }
        
        return maybeStakingCredential;
    }
    
    function toPlutusDataAdaAddress(string memory addr) internal pure returns (RFC8949.CborValue memory){
        CardanoAddressCodec.DecodedAddress memory decodeAddr = CardanoAddressCodec.decodeAddress(addr);
        return toPlutusDataAdaAddress(decodeAddr);
    }

    function toPlutusDataAdaAddress(CardanoAddressCodec.DecodedAddress memory decodeAddr) internal pure returns (RFC8949.CborValue memory){
        RFC8949.CborValue memory addrPlutus = newConstr(0, 2);
        
        if(decodeAddr.addressType == CardanoAddressCodec.ADDR_TYPE_BASE || decodeAddr.addressType == CardanoAddressCodec.ADDR_TYPE_ENTERPRISE) {
            addConstrField(addrPlutus,toPlutusDataCredential(decodeAddr.paymentKeyHash,decodeAddr.paymentIsScript),0);
            addConstrField(addrPlutus,toPlutuMaybeStakeCredential(decodeAddr.stakeKeyHash,decodeAddr.stakeIsScript),1);
        }else{
            revert("bad ada address type");
        }

        return addrPlutus;
    }
}

library DemoMsgCodec {

    struct DemoMsg{
        address receiverEvm;
        string receiverAda;
        bool isEvmChain;
        uint64 amount;
    }

    function msgToCbor(string memory receiver, uint64 amount) internal pure returns (bytes memory msgCbor){
        RFC8949.CborValue memory msgplutus = PlutusDataCodec.newConstr(0, 2);

        RFC8949.CborValue memory msgAddress = PlutusDataCodec.newConstr(1, 1);
        RFC8949.CborValue memory adaAddress = PlutusDataCodec.toPlutusDataAdaAddress(receiver);
        PlutusDataCodec.addConstrField(msgAddress, adaAddress, 0);

        RFC8949.CborValue memory amountPlutus;
        amountPlutus.majorType = RFC8949.MajorType.UnsignedInt;
        amountPlutus.intValue = amount;

        PlutusDataCodec.addConstrField(msgplutus, msgAddress, 0);
        PlutusDataCodec.addConstrField(msgplutus, amountPlutus, 1);

        msgCbor = RFC8949.encode(msgplutus);
    }

    function parseToMsg(bytes memory cbor,bool isTestnet) internal pure returns (DemoMsg memory msgInfo) {
        RFC8949.CborValue memory cb = RFC8949.decode(cbor);
        require(cb.majorType == RFC8949.MajorType.Tag,"bad msg cbor 1");
        require(PlutusDataCodec.fieldSize(cb) == 2,"bad msg cbor 2");
        RFC8949.CborValue memory msgAddress = PlutusDataCodec.getConstrField(cb,0);
        RFC8949.CborValue memory amount = PlutusDataCodec.getConstrField(cb,1);

        require(PlutusDataCodec.fieldSize(msgAddress) == 1,"bad msg cbor 3");
        require(msgAddress.tagNumber == 121 || msgAddress.tagNumber == 122,"bad msg cbor 4");
        RFC8949.CborValue memory receiverAddr = PlutusDataCodec.getConstrField(msgAddress,0);
        if(msgAddress.tagNumber == 121){
            msgInfo.isEvmChain = true;
            require(receiverAddr.majorType == RFC8949.MajorType.Bytes,"bad msg cbor 5");
            msgInfo.receiverEvm = address(uint160(bytes20(receiverAddr.data)));
        }else if(msgAddress.tagNumber == 122){
            msgInfo.isEvmChain = false;
            require(receiverAddr.majorType == RFC8949.MajorType.Tag,"bad msg cbor 6");

            CardanoAddressCodec.DecodedAddress memory decodedAddr = PlutusDataCodec.plutusDataAsAdaAddress(receiverAddr);
            decodedAddr.isTestnet = isTestnet;
            msgInfo.receiverAda = CardanoAddressCodec.encodeAddress(decodedAddr);
        }
        
        require(amount.majorType == RFC8949.MajorType.UnsignedInt,"bad msg cbor 7");

        msgInfo.amount = uint64(amount.intValue);

    }

}


contract DemoTest {
    function addressTest(string memory addrBetch32,bool isTestnet) public pure returns (bool){
        RFC8949.CborValue memory plutusData = PlutusDataCodec.toPlutusDataAdaAddress(addrBetch32);
        CardanoAddressCodec.DecodedAddress memory decodedAddr = PlutusDataCodec.plutusDataAsAdaAddress(plutusData);
        decodedAddr.isTestnet = isTestnet;
        string memory ret = CardanoAddressCodec.encodeAddress(decodedAddr);
        return keccak256(abi.encodePacked(bytes(addrBetch32))) == keccak256(abi.encodePacked(bytes(ret)));
    }

    function msgTest(string memory addrBetch32, uint64 amount) public pure returns (bytes memory cbor, DemoMsgCodec.DemoMsg memory msgInfo, bool ok){
        cbor = DemoMsgCodec.msgToCbor(addrBetch32, amount);
        CardanoAddressCodec.DecodedAddress memory decodedAddr = CardanoAddressCodec.decodeAddress(addrBetch32);
        msgInfo = DemoMsgCodec.parseToMsg(cbor, decodedAddr.isTestnet);
        ok = msgInfo.amount == amount && keccak256(abi.encodePacked(bytes(addrBetch32))) == keccak256(abi.encodePacked(bytes(msgInfo.receiverAda)));
    }

    function msgTest(bytes memory cbor, bool isTestnet) public pure returns (DemoMsgCodec.DemoMsg memory msgInfo){
        msgInfo = DemoMsgCodec.parseToMsg(cbor, isTestnet);
    }
}