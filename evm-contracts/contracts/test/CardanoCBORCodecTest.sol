// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../cardano-utils/CBORCodec.sol";

/// @dev Wrapper that exposes RFC8949 encode/decode functions for tests.
/// CborValue is recursive and cannot cross the ABI boundary directly, so we
/// expose helpers that return only primitive fields or round-trip bytes.
contract CardanoCBORCodecTest {

    // ── MajorType constants ─────────────────────────────────────────────────
    uint8 constant MAJOR_UINT   = 0;
    uint8 constant MAJOR_NEGINT = 1;
    uint8 constant MAJOR_BYTES  = 2;
    uint8 constant MAJOR_TEXT   = 3;
    uint8 constant MAJOR_ARRAY  = 4;
    uint8 constant MAJOR_MAP    = 5;
    uint8 constant MAJOR_TAG    = 6;
    uint8 constant MAJOR_SIMPLE = 7;

    // ── decode scalar accessors ─────────────────────────────────────────────

    function decodeMajorType(bytes memory data) external pure returns (uint8) {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return uint8(v.majorType);
    }

    function decodeIntValue(bytes memory data) external pure returns (uint256) {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return v.intValue;
    }

    function decodeData(bytes memory data) external pure returns (bytes memory) {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return v.data;
    }

    function decodeTagNumber(bytes memory data) external pure returns (uint256) {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return v.tagNumber;
    }

    function decodeArrayLength(bytes memory data) external pure returns (uint256) {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return v.arrayValue.length;
    }

    function decodeArrayElemInt(bytes memory data, uint256 idx)
        external
        pure
        returns (uint256)
    {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return v.arrayValue[idx].intValue;
    }

    function decodeArrayElemMajorType(bytes memory data, uint256 idx)
        external
        pure
        returns (uint8)
    {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return uint8(v.arrayValue[idx].majorType);
    }

    function decodeTaggedItemMajorType(bytes memory data)
        external
        pure
        returns (uint8)
    {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return uint8(v.arrayValue[0].majorType);
    }

    function decodeTaggedItemArrayLength(bytes memory data)
        external
        pure
        returns (uint256)
    {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return v.arrayValue[0].arrayValue.length;
    }

    // ── encode helpers (return bytes — no recursive struct needed) ──────────

    function encodeUint(uint256 value) external pure returns (bytes memory) {
        return RFC8949.encodeUint(value);
    }

    function encodeInt(int256 value) external pure returns (bytes memory) {
        return RFC8949.encodeInt(value);
    }

    function encodeBytes(bytes memory data) external pure returns (bytes memory) {
        return RFC8949.encodeBytes(data);
    }

    function encodeString(string memory str) external pure returns (bytes memory) {
        return RFC8949.encodeString(str);
    }

    function encodeBool(bool value) external pure returns (bytes memory) {
        return RFC8949.encodeBool(value);
    }

    function encodeNull() external pure returns (bytes memory) {
        return RFC8949.encodeNull();
    }

    // ── round-trip: decode then re-encode, return bytes ─────────────────────

    function roundtrip(bytes memory data) external pure returns (bytes memory) {
        RFC8949.CborValue memory v = RFC8949.decode(data);
        return RFC8949.encode(v);
    }

    // ── encode unsigned int, then decode and return intValue ────────────────
    function encodeDecodeUint(uint256 n) external pure returns (uint256) {
        bytes memory encoded = RFC8949.encodeUint(n);
        RFC8949.CborValue memory decoded = RFC8949.decode(encoded);
        return decoded.intValue;
    }
}
