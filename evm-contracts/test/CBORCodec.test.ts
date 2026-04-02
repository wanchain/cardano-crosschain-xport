/**
 * Tests for contracts/solidity-cbor/CBORCodec.sol  (library RFC8949Decoder)
 *
 * Wrapper contract: CBORCodecTest
 *
 * Notes on negative-integer encoding in RFC8949Decoder:
 *   The library stores negatives as (type(uint256).max - n), which is
 *   different from the Cardano-utils library.  This matches the original
 *   Solidity comment "CBOR -1 - n".
 *   -1  => n=0  => intValue = MAX
 *   -100 => n=99 => intValue = MAX - 99
 *
 * MajorType enum values: UInt=0 NegInt=1 Bytes=2 Text=3 Array=4 Map=5 Tag=6 Simple=7
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";

const MAJOR_UINT   = 0;
const MAJOR_NEGINT = 1;
const MAJOR_BYTES  = 2;
const MAJOR_TEXT   = 3;
const MAJOR_ARRAY  = 4;
const MAJOR_MAP    = 5;
const MAJOR_TAG    = 6;
const MAJOR_SIMPLE = 7;

// uint256 max — used by RFC8949Decoder for negative integers
const UINT256_MAX = ethers.constants.MaxUint256;

describe("CBORCodec (solidity-cbor / RFC8949Decoder)", function () {
    let codec: Contract;

    before(async function () {
        const CBORCodecTest = await ethers.getContractFactory("CBORCodecTest");
        codec = await CBORCodecTest.deploy();
        await codec.deployed();
    });

    // ── Unsigned integers ──────────────────────────────────────────────────

    describe("Unsigned integers", function () {
        it("decodes 0 (0x00)", async function () {
            expect(await codec.decodeMajorType("0x00")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x00")).to.equal(0);
        });

        it("decodes 1 (0x01)", async function () {
            expect(await codec.decodeMajorType("0x01")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x01")).to.equal(1);
        });

        it("decodes 23 (0x17)", async function () {
            // 23 fits in additionalInfo directly
            expect(await codec.decodeMajorType("0x17")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x17")).to.equal(23);
        });

        it("decodes 24 (0x1818) — 1-byte length extension", async function () {
            expect(await codec.decodeMajorType("0x1818")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x1818")).to.equal(24);
        });

        it("decodes 255 (0x18ff)", async function () {
            expect(await codec.decodeMajorType("0x18ff")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x18ff")).to.equal(255);
        });

        it("decodes 1000 (0x1903e8) — 2-byte length extension", async function () {
            expect(await codec.decodeMajorType("0x1903e8")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x1903e8")).to.equal(1000);
        });
    });

    // ── Negative integers ──────────────────────────────────────────────────

    describe("Negative integers", function () {
        // RFC8949Decoder encodes negatives as type(uint256).max - n
        it("decodes -1 (0x20) — stored as MAX", async function () {
            expect(await codec.decodeMajorType("0x20")).to.equal(MAJOR_NEGINT);
            // n=0  =>  intValue = MAX - 0 = MAX
            expect(await codec.decodeIntValue("0x20")).to.equal(UINT256_MAX);
        });

        it("decodes -100 (0x3863) — stored as MAX - 99", async function () {
            expect(await codec.decodeMajorType("0x3863")).to.equal(MAJOR_NEGINT);
            // -100 = -1 - 99  =>  n = 99  =>  intValue = MAX - 99
            expect(await codec.decodeIntValue("0x3863")).to.equal(UINT256_MAX.sub(99));
        });
    });

    // ── Byte strings ───────────────────────────────────────────────────────

    describe("Byte strings", function () {
        it("decodes empty bytes (0x40)", async function () {
            expect(await codec.decodeMajorType("0x40")).to.equal(MAJOR_BYTES);
            expect(await codec.decodeData("0x40")).to.equal("0x");
        });

        it("decodes h'68656c6c6f' (0x4568656c6c6f)", async function () {
            // 0x45 = major 2, length 5; followed by 'hello'
            expect(await codec.decodeMajorType("0x4568656c6c6f")).to.equal(MAJOR_BYTES);
            expect(await codec.decodeData("0x4568656c6c6f")).to.equal("0x68656c6c6f");
        });
    });

    // ── Text strings ───────────────────────────────────────────────────────

    describe("Text strings", function () {
        it("decodes empty text (0x60)", async function () {
            expect(await codec.decodeMajorType("0x60")).to.equal(MAJOR_TEXT);
            expect(await codec.decodeData("0x60")).to.equal("0x");
        });

        it("decodes \"hello\" (0x6568656c6c6f)", async function () {
            // 0x65 = major 3, length 5; followed by 'hello'
            expect(await codec.decodeMajorType("0x6568656c6c6f")).to.equal(MAJOR_TEXT);
            const data: string = await codec.decodeData("0x6568656c6c6f");
            expect(Buffer.from(data.slice(2), "hex").toString("utf8")).to.equal("hello");
        });
    });

    // ── Arrays ─────────────────────────────────────────────────────────────

    describe("Arrays", function () {
        it("decodes empty array (0x80)", async function () {
            expect(await codec.decodeMajorType("0x80")).to.equal(MAJOR_ARRAY);
            expect(await codec.decodeArrayLength("0x80")).to.equal(0);
        });

        it("decodes [1, 2, 3] (0x83010203)", async function () {
            const cbor = "0x83010203";
            expect(await codec.decodeMajorType(cbor)).to.equal(MAJOR_ARRAY);
            expect(await codec.decodeArrayLength(cbor)).to.equal(3);
            expect(await codec.decodeArrayElemInt(cbor, 0)).to.equal(1);
            expect(await codec.decodeArrayElemInt(cbor, 1)).to.equal(2);
            expect(await codec.decodeArrayElemInt(cbor, 2)).to.equal(3);
        });
    });

    // ── Maps ───────────────────────────────────────────────────────────────

    describe("Maps", function () {
        it("decodes empty map (0xa0)", async function () {
            expect(await codec.decodeMajorType("0xa0")).to.equal(MAJOR_MAP);
            // flat array of key-value pairs — empty map has 0 entries
            expect(await codec.decodeArrayLength("0xa0")).to.equal(0);
        });

        it("decodes {1: 2} (0xa10102) — flat pair array has 2 entries", async function () {
            // 0xa1 = major 5, 1 pair; then key=0x01, value=0x02
            const cbor = "0xa10102";
            expect(await codec.decodeMajorType(cbor)).to.equal(MAJOR_MAP);
            // Map is stored as flat key/value pairs: [key0, val0]
            expect(await codec.decodeArrayLength(cbor)).to.equal(2);
            expect(await codec.decodeArrayElemInt(cbor, 0)).to.equal(1); // key
            expect(await codec.decodeArrayElemInt(cbor, 1)).to.equal(2); // value
        });
    });

    // ── Tags ───────────────────────────────────────────────────────────────

    describe("Tags", function () {
        it("decodes Plutus Constr 0 tag(121, []) (0xd87980)", async function () {
            // 0xd8 = major 6, additionalInfo=24  →  next byte is tag number
            // 0x79 = 121  (decimal)
            // 0x80 = empty array
            const cbor = "0xd87980";
            expect(await codec.decodeMajorType(cbor)).to.equal(MAJOR_TAG);
            expect(await codec.decodeTagNumber(cbor)).to.equal(121);
            // tagged item is an array
            expect(await codec.decodeTaggedItemMajorType(cbor)).to.equal(MAJOR_ARRAY);
            expect(await codec.decodeTaggedItemArrayLength(cbor)).to.equal(0);
        });
    });

    // ── Simple values ──────────────────────────────────────────────────────

    // NOTE: RFC8949Decoder._decodeSimpleOrFloat is a stub — it returns an
    // empty CborValue for all simple values.  We test that decode doesn't
    // revert and returns majorType=Simple (7).
    describe("Simple values (stub decoder)", function () {
        it("decodes true (0xf5) without reverting", async function () {
            expect(await codec.decodeMajorType("0xf5")).to.equal(MAJOR_SIMPLE);
        });

        it("decodes false (0xf4) without reverting", async function () {
            expect(await codec.decodeMajorType("0xf4")).to.equal(MAJOR_SIMPLE);
        });
    });
});
