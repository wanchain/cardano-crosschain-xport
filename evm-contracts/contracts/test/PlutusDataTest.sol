// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../cardano-utils/PlutusData.sol";
import "../cardano-utils/CBORCodec.sol";

/// @dev Wrapper that exposes PlutusDataCodec internal functions for tests.
/// Results are returned as primitives or encoded bytes to avoid the
/// recursive-struct ABI limitation.
contract PlutusDataTest {

    // ── newConstr: return scalar fields ─────────────────────────────────────

    /// @notice Returns (majorType, tagNumber, outerArrayLen, innerArrayLen).
    /// outerArrayLen is always 1 (the fields array wrapper).
    /// innerArrayLen is fieldsCount.
    function newConstrInfo(uint alternative, uint fieldsCount)
        external
        pure
        returns (
            uint8 majorType,
            uint256 tagNumber,
            uint256 outerArrayLen,
            uint256 innerArrayLen
        )
    {
        RFC8949.CborValue memory pd = PlutusDataCodec.newConstr(alternative, fieldsCount);
        majorType     = uint8(pd.majorType);
        tagNumber     = pd.tagNumber;
        outerArrayLen = pd.arrayValue.length;
        innerArrayLen = pd.arrayValue[0].arrayValue.length;
    }

    /// @notice Returns the CBOR encoding of a newConstr value.
    function newConstrEncoded(uint alternative, uint fieldsCount)
        external
        pure
        returns (bytes memory)
    {
        RFC8949.CborValue memory pd = PlutusDataCodec.newConstr(alternative, fieldsCount);
        return RFC8949.encode(pd);
    }

    // ── newConstr reverts when alternative >= 7 ──────────────────────────────
    // (just call newConstrEncoded(7, 1) from JS and expect a revert)

    // ── fieldSize ───────────────────────────────────────────────────────────

    /// @notice Build a Constr with fieldsCount slots, return fieldSize result.
    function testFieldSize(uint alternative, uint fieldsCount)
        external
        pure
        returns (uint)
    {
        RFC8949.CborValue memory pd = PlutusDataCodec.newConstr(alternative, fieldsCount);
        return PlutusDataCodec.fieldSize(pd);
    }

    // ── addConstrField + getConstrField ─────────────────────────────────────

    /// @notice Build Constr(alternative, 1), set field 0 to an unsigned int,
    ///         then retrieve and return that int via getConstrField.
    function testAddGetIntField(uint alternative, uint64 fieldValue)
        external
        pure
        returns (uint256 retrievedIntValue, uint8 retrievedMajorType)
    {
        RFC8949.CborValue memory pd = PlutusDataCodec.newConstr(alternative, 1);
        RFC8949.CborValue memory intField = PlutusDataCodec.toPlutusDataInteger(fieldValue);
        PlutusDataCodec.addConstrField(pd, intField, 0);

        RFC8949.CborValue memory got = PlutusDataCodec.getConstrField(pd, 0);
        retrievedIntValue  = got.intValue;
        retrievedMajorType = uint8(got.majorType);
    }

    /// @notice Build Constr(alternative, 1), set field 0 to a bytes value,
    ///         then retrieve and return that bytes via getConstrField.
    function testAddGetBytesField(uint alternative, bytes memory fieldData)
        external
        pure
        returns (bytes memory retrievedData, uint8 retrievedMajorType)
    {
        RFC8949.CborValue memory pd = PlutusDataCodec.newConstr(alternative, 1);
        RFC8949.CborValue memory bytesField = PlutusDataCodec.toPlutusDataBytes(fieldData);
        PlutusDataCodec.addConstrField(pd, bytesField, 0);

        RFC8949.CborValue memory got = PlutusDataCodec.getConstrField(pd, 0);
        retrievedData      = got.data;
        retrievedMajorType = uint8(got.majorType);
    }

    // ── toPlutusDataInteger ─────────────────────────────────────────────────

    function testToPlutusDataInteger(uint64 n)
        external
        pure
        returns (uint8 majorType, uint256 intValue)
    {
        RFC8949.CborValue memory v = PlutusDataCodec.toPlutusDataInteger(n);
        majorType = uint8(v.majorType);
        intValue  = v.intValue;
    }

    // ── toPlutusDataBytes ───────────────────────────────────────────────────

    function testToPlutusDataBytes(bytes memory data)
        external
        pure
        returns (uint8 majorType, bytes memory storedData)
    {
        RFC8949.CborValue memory v = PlutusDataCodec.toPlutusDataBytes(data);
        majorType  = uint8(v.majorType);
        storedData = v.data;
    }

    // ── full round-trip: build Constr, encode to CBOR, re-decode ───────────

    /// @notice Encode a Constr(alternative, 1) with an integer field, decode
    ///         it back and verify the tag number and field value survive.
    function testConstrRoundtrip(uint alternative, uint64 fieldValue)
        external
        pure
        returns (
            bytes memory encoded,
            uint256 decodedTagNumber,
            uint256 decodedFieldInt
        )
    {
        RFC8949.CborValue memory pd = PlutusDataCodec.newConstr(alternative, 1);
        PlutusDataCodec.addConstrField(pd, PlutusDataCodec.toPlutusDataInteger(fieldValue), 0);

        encoded = RFC8949.encode(pd);

        RFC8949.CborValue memory decoded = RFC8949.decode(encoded);
        decodedTagNumber = decoded.tagNumber;
        decodedFieldInt  = decoded.arrayValue[0].arrayValue[0].intValue;
    }

    // ── toPlutusDataCredential ──────────────────────────────────────────────

    /// @notice Returns (tagNumber, fieldMajorType, fieldData) for a credential.
    function testToPlutusDataCredential(bytes memory pubKeyOrScriptHash, bool isScriptHash)
        external
        pure
        returns (uint256 tagNumber, uint8 fieldMajorType, bytes memory fieldData)
    {
        RFC8949.CborValue memory cred = PlutusDataCodec.toPlutusDataCredential(pubKeyOrScriptHash, isScriptHash);
        tagNumber      = cred.tagNumber;
        RFC8949.CborValue memory field = PlutusDataCodec.getConstrField(cred, 0);
        fieldMajorType = uint8(field.majorType);
        fieldData      = field.data;
    }
}
