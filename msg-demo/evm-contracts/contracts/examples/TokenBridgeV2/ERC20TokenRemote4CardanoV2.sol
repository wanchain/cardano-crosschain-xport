// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {RFC8949Decoder} from "../../solidity-cbor/CBORCodec.sol";
import "../../app/WmbAppV3.sol";

contract ERC20TokenRemote4Cardano is WmbAppV3, ERC20 {
    using SafeERC20 for IERC20;

    bytes public tokenAddress;
    bytes public homeAddress;
    uint256 public homeChainId;

    struct AdaAddress {
        bytes paymentKey;
        bool isPaymentScipt;
        bool hasStakeKey;
        bytes stackeKey;
        bool isStakeScript;
    }

    struct CCMesssage {
        AdaAddress receiverAda;
        bytes receiverEvm;
        bool isEvmChain;
        uint amount;
    }

    event SendTokenToHome(
        uint256 indexed homeChainId,
        address indexed from,
        uint256 amount
    );
    event ReceiveTokenFromHome(
        uint256 indexed fromChainId,
        bytes indexed from,
        address indexed to,
        uint256 amount
    );

    constructor(
        address _wmbGateway,
        bytes memory _tokenAddress,
        bytes memory _homeAddress,
        uint256 _homeChainId,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) WmbAppV3(_wmbGateway) {
        tokenAddress = _tokenAddress;
        homeAddress = _homeAddress;
        homeChainId = _homeChainId;

        setTrustedRemoteNonEvm(_homeChainId, _homeAddress, true);
    }

    function send(bytes memory plutusData) external {
        require(homeAddress.length != 0, "homeAddress not set");

        // decode plutusData
        CCMesssage memory msgData = parseToMsg(plutusData);
        require(
            msgData.isEvmChain == false,
            "The Target Should be Cardano Chain! "
        );

        uint256 amount = msgData.amount;
        require(amount > 0, "Amount must be greater than 0");

        // to lock the token amount
        _burn(msg.sender, amount);

        // dispatch msg
        _dispatchMessageNonEvm(homeChainId, homeAddress, 300_000, plutusData);
        emit SendTokenToHome(homeChainId, msg.sender, amount);
    }

    function _wmbReceive(
        bytes calldata data,
        bytes32 /*messageId*/,
        uint256 fromChainId,
        bytes memory from
    ) internal override {
        CCMesssage memory msgData = parseToMsg(data);
        require(
            msgData.isEvmChain == true,
            "The Target Should be EVM ChainType! "
        );

        uint256 amount = msgData.amount;
        address to = address(uint160(uint256(bytes32(msgData.receiverEvm))));

        _mint(to, amount);
        emit ReceiveTokenFromHome(fromChainId, from, to, amount);
    }

    function parseToMsg(
        bytes memory cbor
    ) public pure returns (CCMesssage memory msgInfo) {
        RFC8949Decoder.CborValue memory cb = RFC8949Decoder.decode(cbor);
        require(cb.arrayValue.length == 1, "cb.arrayValue.length == 1");
        RFC8949Decoder.CborValue memory fields = cb.arrayValue[0];
        require(
            fields.majorType == RFC8949Decoder.MajorType.Array,
            "fields.majorType == RFC8949Decoder.MajorType.Array"
        );
        require(
            fields.arrayValue.length == 2,
            "error fields.arrayValue.length == 2"
        );
        RFC8949Decoder.CborValue memory msgAddress = fields.arrayValue[0];
        require(
            msgAddress.tagNumber == 121 || msgAddress.tagNumber == 122,
            "tag neither 121 nor 122"
        );
        require(
            msgAddress.arrayValue.length == 1,
            "msgAddress.arrayValue.length == 1"
        );
        msgInfo.isEvmChain = msgAddress.tagNumber == 121;
        RFC8949Decoder.CborValue memory msgAddressFields = msgAddress
            .arrayValue[0];
        require(
            msgAddressFields.arrayValue.length == 1,
            "msgAddressFields.arrayValue.length == 1"
        );
        RFC8949Decoder.CborValue memory receiver = msgAddressFields.arrayValue[
            0
        ];
        if (msgInfo.isEvmChain) {
            require(
                receiver.majorType == RFC8949Decoder.MajorType.Bytes,
                "receiver.majorType == RFC8949Decoder.MajorType.Bytes"
            );
            require(receiver.data.length >= 20, "receiver.data.length");
            msgInfo.receiverEvm = receiver.data; //address(uint160(uint256(bytes32(receiver.data))));
        } else {
            require(
                receiver.majorType == RFC8949Decoder.MajorType.Tag,
                "receiver.majorType == RFC8949Decoder.MajorType.Tag"
            );
            require(
                receiver.arrayValue.length == 1,
                "receiver.arrayValue.length == 1"
            );
            RFC8949Decoder.CborValue memory adaAddress = receiver.arrayValue[0];
            require(
                adaAddress.arrayValue.length == 2,
                "adaAddress.arrayValue.length == 2"
            );
        }

        if (
            fields.arrayValue[1].majorType ==
            RFC8949Decoder.MajorType.UnsignedInt
        ) {
            msgInfo.amount = fields.arrayValue[1].intValue;
        } else if (
            fields.arrayValue[1].majorType == RFC8949Decoder.MajorType.Tag
        ) {
            require(
                fields.arrayValue[1].tagNumber == 2,
                "fields.arrayValue[1].tagNumber == 2"
            );
            require(
                fields.arrayValue[1].arrayValue.length == 1,
                "fields.arrayValue[1].arrayValue.length == 1"
            );
            require(
                fields.arrayValue[1].arrayValue[0].majorType ==
                    RFC8949Decoder.MajorType.Bytes,
                "fields.arrayValue[1].arrayValue[0].majorType == RFC8949Decoder.MajorType.Bytes"
            );
            require(
                fields.arrayValue[1].arrayValue[0].data.length >= 1,
                "fields.arrayValue[1].arrayValue[0].data.length"
            );
            uint len = fields.arrayValue[1].arrayValue[0].data.length;
            for (uint i = 0; i < len; i++) {
                msgInfo.amount =
                    (msgInfo.amount << 8) |
                    uint8(fields.arrayValue[1].arrayValue[0].data[i]);
            }
        }
    }

}
