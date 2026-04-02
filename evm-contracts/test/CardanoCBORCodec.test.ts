/**
 * Tests for contracts/cardano-utils/CBORCodec.sol  (library RFC8949)
 *
 * Wrapper contract: CardanoCBORCodecTest
 *
 * Notes on negative-integer encoding in RFC8949:
 *   intValue = n - 1  for n > 0, where n is the CBOR-encoded value.
 *   CBOR encodes -x as (x - 1).
 *   -1  => n=0  => intValue = 0  (special-cased in _decodeInteger)
 *   -100 => n=99 => intValue = 98
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

describe("CardanoCBORCodec (cardano-utils / RFC8949)", function () {
    let codec: Contract;

    before(async function () {
        const CardanoCBORCodecTest = await ethers.getContractFactory("CardanoCBORCodecTest");
        codec = await CardanoCBORCodecTest.deploy();
        await codec.deployed();
    });

    // ── Unsigned integers — decode ──────────────────────────────────────────

    describe("Unsigned integers — decode", function () {
        it("decodes 0 (0x00)", async function () {
            expect(await codec.decodeMajorType("0x00")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x00")).to.equal(0);
        });

        it("decodes 1 (0x01)", async function () {
            expect(await codec.decodeMajorType("0x01")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x01")).to.equal(1);
        });

        it("decodes 23 (0x17)", async function () {
            expect(await codec.decodeMajorType("0x17")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x17")).to.equal(23);
        });

        it("decodes 24 (0x1818) — 1-byte extension", async function () {
            expect(await codec.decodeMajorType("0x1818")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x1818")).to.equal(24);
        });

        it("decodes 255 (0x18ff)", async function () {
            expect(await codec.decodeMajorType("0x18ff")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x18ff")).to.equal(255);
        });

        it("decodes 1000 (0x1903e8) — 2-byte extension", async function () {
            expect(await codec.decodeMajorType("0x1903e8")).to.equal(MAJOR_UINT);
            expect(await codec.decodeIntValue("0x1903e8")).to.equal(1000);
        });
    });

    // ── Negative integers — decode ──────────────────────────────────────────

    describe("Negative integers — decode", function () {
        // _decodeInteger: intValue = n == 0 ? 0 : n - 1
        it("decodes -1 (0x20)  =>  intValue = 0", async function () {
            expect(await codec.decodeMajorType("0x20")).to.equal(MAJOR_NEGINT);
            // CBOR -1 = 0x20, n=0, intValue=0
            expect(await codec.decodeIntValue("0x20")).to.equal(0);
        });

        it("decodes -100 (0x3863)  =>  intValue = 98", async function () {
            // 0x38 = major 1, additionalInfo 24 (1-byte follows); 0x63 = 99
            // -100 = -1-99, n=99, intValue = 99-1 = 98
            expect(await codec.decodeMajorType("0x3863")).to.equal(MAJOR_NEGINT);
            expect(await codec.decodeIntValue("0x3863")).to.equal(98);
        });
    });

    // ── Byte strings — decode ──────────────────────────────────────────────

    describe("Byte strings — decode", function () {
        it("decodes empty bytes (0x40)", async function () {
            expect(await codec.decodeMajorType("0x40")).to.equal(MAJOR_BYTES);
            expect(await codec.decodeData("0x40")).to.equal("0x");
        });

        it("decodes h'68656c6c6f' (0x4568656c6c6f)", async function () {
            expect(await codec.decodeMajorType("0x4568656c6c6f")).to.equal(MAJOR_BYTES);
            expect(await codec.decodeData("0x4568656c6c6f")).to.equal("0x68656c6c6f");
        });
    });

    // ── Text strings — decode ──────────────────────────────────────────────

    describe("Text strings — decode", function () {
        it("decodes empty text (0x60)", async function () {
            expect(await codec.decodeMajorType("0x60")).to.equal(MAJOR_TEXT);
            expect(await codec.decodeData("0x60")).to.equal("0x");
        });

        it("decodes \"hello\" (0x6568656c6c6f)", async function () {
            expect(await codec.decodeMajorType("0x6568656c6c6f")).to.equal(MAJOR_TEXT);
            const data: string = await codec.decodeData("0x6568656c6c6f");
            expect(Buffer.from(data.slice(2), "hex").toString("utf8")).to.equal("hello");
        });
    });

    // ── Arrays — decode ────────────────────────────────────────────────────

    describe("Arrays — decode", function () {
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

    // ── Maps — decode ──────────────────────────────────────────────────────

    describe("Maps — decode", function () {
        it("decodes empty map (0xa0)", async function () {
            expect(await codec.decodeMajorType("0xa0")).to.equal(MAJOR_MAP);
            expect(await codec.decodeArrayLength("0xa0")).to.equal(0);
        });

        it("decodes {1: 2} (0xa10102) — flat pair array has 2 entries", async function () {
            const cbor = "0xa10102";
            expect(await codec.decodeMajorType(cbor)).to.equal(MAJOR_MAP);
            expect(await codec.decodeArrayLength(cbor)).to.equal(2); // [key, value]
            expect(await codec.decodeArrayElemInt(cbor, 0)).to.equal(1);
            expect(await codec.decodeArrayElemInt(cbor, 1)).to.equal(2);
        });
    });

    // ── Tags — decode ──────────────────────────────────────────────────────

    describe("Tags — decode", function () {
        it("decodes Plutus Constr 0  tag(121, [])  (0xd87980)", async function () {
            const cbor = "0xd87980";
            expect(await codec.decodeMajorType(cbor)).to.equal(MAJOR_TAG);
            expect(await codec.decodeTagNumber(cbor)).to.equal(121);
            expect(await codec.decodeTaggedItemMajorType(cbor)).to.equal(MAJOR_ARRAY);
            expect(await codec.decodeTaggedItemArrayLength(cbor)).to.equal(0);
        });
    });

    // ── Simple values — decode ─────────────────────────────────────────────

    describe("Simple values — decode", function () {
        it("decodes true (0xf5)  =>  intValue = 1", async function () {
            expect(await codec.decodeMajorType("0xf5")).to.equal(MAJOR_SIMPLE);
            expect(await codec.decodeIntValue("0xf5")).to.equal(1);
        });

        it("decodes false (0xf4)  =>  intValue = 0", async function () {
            expect(await codec.decodeMajorType("0xf4")).to.equal(MAJOR_SIMPLE);
            expect(await codec.decodeIntValue("0xf4")).to.equal(0);
        });
    });

    // ── Encode helpers ─────────────────────────────────────────────────────

    describe("Encode helpers", function () {
        it("encodeUint(0) => 0x00", async function () {
            expect(await codec.encodeUint(0)).to.equal("0x00");
        });

        it("encodeUint(1) => 0x01", async function () {
            expect(await codec.encodeUint(1)).to.equal("0x01");
        });

        it("encodeUint(23) => 0x17", async function () {
            expect(await codec.encodeUint(23)).to.equal("0x17");
        });

        it("encodeUint(24) => 0x1818", async function () {
            expect(await codec.encodeUint(24)).to.equal("0x1818");
        });

        it("encodeUint(255) => 0x18ff", async function () {
            expect(await codec.encodeUint(255)).to.equal("0x18ff");
        });

        it("encodeUint(1000) => 0x1903e8", async function () {
            expect(await codec.encodeUint(1000)).to.equal("0x1903e8");
        });

        it("encodeBytes(empty) => 0x40", async function () {
            expect(await codec.encodeBytes("0x")).to.equal("0x40");
        });

        it("encodeBytes(h'deadbeef') => 0x44deadbeef", async function () {
            expect(await codec.encodeBytes("0xdeadbeef")).to.equal("0x44deadbeef");
        });

        it("encodeString('') => 0x60", async function () {
            expect(await codec.encodeString("")).to.equal("0x60");
        });

        it("encodeString('hello') => 0x6568656c6c6f", async function () {
            expect(await codec.encodeString("hello")).to.equal("0x6568656c6c6f");
        });

        it("encodeBool(true) => 0xf5", async function () {
            expect(await codec.encodeBool(true)).to.equal("0xf5");
        });

        it("encodeBool(false) => 0xf4", async function () {
            expect(await codec.encodeBool(false)).to.equal("0xf4");
        });

        it("encodeNull() => 0xf6", async function () {
            // CBOR null = 0xf6 (simple value 22)
            expect(await codec.encodeNull()).to.equal("0xf6");
        });
    });

    // ── Round-trip: decode then re-encode should give back original bytes ───

    describe("Round-trip (decode → re-encode)", function () {
        const vectors: [string, string][] = [
            ["uint 0",      "0x00"],
            ["uint 1",      "0x01"],
            ["uint 23",     "0x17"],
            ["uint 24",     "0x1818"],
            ["uint 255",    "0x18ff"],
            ["uint 1000",   "0x1903e8"],
            ["bytes empty", "0x40"],
            ["bytes hello", "0x4568656c6c6f"],
            ["text empty",  "0x60"],
            ["text hello",  "0x6568656c6c6f"],
            ["array []",    "0x80"],
            ["array 123",   "0x83010203"],
            ["map empty",   "0xa0"],
            ["map {1:2}",   "0xa10102"],
            ["tag 121 []",  "0xd87980"],
            ["bool true",   "0xf5"],
            ["bool false",  "0xf4"],
        ];

        for (const [label, hex] of vectors) {
            it(`round-trips ${label} (${hex})`, async function () {
                expect(await codec.roundtrip(hex)).to.equal(hex);
            });
        }
    });

    // ── encodeDecodeUint convenience ────────────────────────────────────────

    describe("encodeDecodeUint", function () {
        it("encodes and decodes 42", async function () {
            expect(await codec.encodeDecodeUint(42)).to.equal(42);
        });

        it("encodes and decodes 65535", async function () {
            expect(await codec.encodeDecodeUint(65535)).to.equal(65535);
        });
    });
});
