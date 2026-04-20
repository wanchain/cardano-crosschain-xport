// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../solidity-cbor/CBORCodec.sol";

/// @dev Wrapper that exposes RFC8949Decoder internal decode for tests.
/// Because CborValue contains a recursive array type it cannot be returned
/// over the ABI directly.  Instead we expose helpers that decode and then
/// return only the primitive fields the tests care about.
contract CBORCodecTest {

    // ── helpers for MajorType enum ──────────────────────────────────────────

    uint8 constant MAJOR_UINT     = 0;
    uint8 constant MAJOR_NEGINT   = 1;
    uint8 constant MAJOR_BYTES    = 2;
    uint8 constant MAJOR_TEXT     = 3;
    uint8 constant MAJOR_ARRAY    = 4;
    uint8 constant MAJOR_MAP      = 5;
    uint8 constant MAJOR_TAG      = 6;
    uint8 constant MAJOR_SIMPLE   = 7;

    // ── scalar accessors ───────────────────────────────────────────────────

    function decodeMajorType(bytes memory data) external pure returns (uint8) {
        RFC8949Decoder.CborValue memory v = RFC8949Decoder.decode(data);
        return uint8(v.majorType);
    }

    function decodeIntValue(bytes memory data) external pure returns (uint256) {
        RFC8949Decoder.CborValue memory v = RFC8949Decoder.decode(data);
        return v.intValue;
    }

    function decodeData(bytes memory data) external pure returns (bytes memory) {
        RFC8949Decoder.CborValue memory v = RFC8949Decoder.decode(data);
        return v.data;
    }

    function decodeTagNumber(bytes memory data) external pure returns (uint256) {
        RFC8949Decoder.CborValue memory v = RFC8949Decoder.decode(data);
        return v.tagNumber;
    }

    function decodeArrayLength(bytes memory data) external pure returns (uint256) {
        RFC8949Decoder.CborValue memory v = RFC8949Decoder.decode(data);
        return v.arrayValue.length;
    }

    /// @notice Returns the intValue of the element at position `idx` in the
    ///         top-level array (or map flat-array).
    function decodeArrayElemInt(bytes memory data, uint256 idx)
        external
        pure
        returns (uint256)
    {
        RFC8949Decoder.CborValue memory v = RFC8949Decoder.decode(data);
        return v.arrayValue[idx].intValue;
    }

    /// @notice Returns the majorType of the element at position `idx`.
    function decodeArrayElemMajorType(bytes memory data, uint256 idx)
        external
        pure
        returns (uint8)
    {
        RFC8949Decoder.CborValue memory v = RFC8949Decoder.decode(data);
        return uint8(v.arrayValue[idx].majorType);
    }

    /// @notice For a Tag value, returns the majorType of the single tagged item.
    function decodeTaggedItemMajorType(bytes memory data)
        external
        pure
        returns (uint8)
    {
        RFC8949Decoder.CborValue memory v = RFC8949Decoder.decode(data);
        return uint8(v.arrayValue[0].majorType);
    }

    /// @notice For a Tag value, returns the arrayValue length of the tagged item.
    function decodeTaggedItemArrayLength(bytes memory data)
        external
        pure
        returns (uint256)
    {
        RFC8949Decoder.CborValue memory v = RFC8949Decoder.decode(data);
        return v.arrayValue[0].arrayValue.length;
    }
}
