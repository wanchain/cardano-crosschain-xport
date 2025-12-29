// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {RFC8949Decoder} from "../../solidity-cbor/CBORCodec.sol";
import "../../app/WmbAppV3.sol";

contract ERC20TokenHome4CardanoV2 is WmbAppV3 {
    using SafeERC20 for IERC20;

    address public tokenAddress;
    bytes public inboundTokenRemote;
    bytes public outboundTokenRemote;
    uint256 public remoteChainId;

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

    event SendTokenToRemote(
        uint256 indexed toChainId,
        address indexed from,
        uint256 amount
    );
    event ReceiveTokenFromRemote(
        uint256 indexed fromChainId,
        bytes indexed from,
        address indexed to,
        uint256 amount
    );
    event ConfigTokenRemote(bytes tokenRemote);

    constructor(
        address _wmbGateway,
        address _tokenAddress
    ) WmbAppV3(_wmbGateway) {
        tokenAddress = _tokenAddress;
    }

    function configInboundTokenRemote(
        uint256 _remoteChainId,
        bytes memory _tokenRemote
    ) external onlyOwner {
        inboundTokenRemote = _tokenRemote;
        remoteChainId = _remoteChainId;

        setTrustedRemoteNonEvm(remoteChainId, inboundTokenRemote, true);
        emit ConfigTokenRemote(inboundTokenRemote);
    }

    function configOutBoundTokenRemote(
        uint256 _remoteChainId,
        bytes memory _tokenRemote
    ) external onlyOwner {
        outboundTokenRemote = _tokenRemote;
        remoteChainId = _remoteChainId;

        setTrustedRemoteNonEvm(remoteChainId, outboundTokenRemote, true);
        emit ConfigTokenRemote(outboundTokenRemote);
    }

    function send(bytes memory plutusData) external {
        require(outboundTokenRemote.length != 0, "tokenRemote not set");

        // decode plutusData
        CCMesssage memory msgData = parseToMsg(plutusData);
        require(
            msgData.isEvmChain == false,
            "The Target Should be Cardano Chain! "
        );

        uint256 amount = msgData.amount;
        require(amount > 0, "Amount must be greater than 0");

        // to lock the token amount
        uint balance = IERC20(tokenAddress).balanceOf(address(this));
        IERC20(tokenAddress).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        uint newBalance = IERC20(tokenAddress).balanceOf(address(this));
        uint receivedAmount = newBalance - balance;

        // dispatch msg
        _dispatchMessageNonEvm(remoteChainId, outboundTokenRemote, 300_000, plutusData);
        emit SendTokenToRemote(remoteChainId, msg.sender, receivedAmount);
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

        bytes32 hashInbound = keccak256(inboundTokenRemote);
        bytes32 hashFrom = keccak256(from);
        require(hashInbound == hashFrom, "TokenHome4Cardano: msgSender is not trusted inbound contract");

        uint256 amount = msgData.amount;
        address to = address(uint160(bytes20(msgData.receiverEvm)));

        IERC20(tokenAddress).safeTransfer(to, amount);
        emit ReceiveTokenFromRemote(fromChainId, from, to, amount);
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
