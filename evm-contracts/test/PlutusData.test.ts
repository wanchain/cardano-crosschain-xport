/**
 * Tests for contracts/cardano-utils/PlutusData.sol  (library PlutusDataCodec)
 *
 * Wrapper contract: PlutusDataTest
 *
 * Plutus Constr tag numbers:
 *   alternative 0  →  tag 121  (0xd8 0x79)
 *   alternative 1  →  tag 122  (0xd8 0x7a)
 *   ...
 *   alternative 6  →  tag 127  (0xd8 0x7f)   — maximum valid
 *   alternative 7+ →  revert
 *
 * MajorType enum:  UInt=0  NegInt=1  Bytes=2  Text=3  Array=4  Map=5  Tag=6  Simple=7
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";

const MAJOR_UINT  = 0;
const MAJOR_BYTES = 2;
const MAJOR_ARRAY = 4;
const MAJOR_TAG   = 6;

describe("PlutusData (cardano-utils / PlutusDataCodec)", function () {
    let wrapper: Contract;

    before(async function () {
        const PlutusDataTest = await ethers.getContractFactory("PlutusDataTest");
        wrapper = await PlutusDataTest.deploy();
        await wrapper.deployed();
    });

    // ── newConstr ───────────────────────────────────────────────────────────

    describe("newConstr", function () {
        it("newConstr(0, 2) — tag=121, 2 field slots", async function () {
            const [majorType, tagNumber, outerLen, innerLen] =
                await wrapper.newConstrInfo(0, 2);
            expect(majorType).to.equal(MAJOR_TAG);
            expect(tagNumber).to.equal(121); // 0 + 121
            expect(outerLen).to.equal(1);    // one wrapper array
            expect(innerLen).to.equal(2);    // two field slots
        });

        it("newConstr(1, 0) — tag=122, 0 field slots", async function () {
            const [majorType, tagNumber, outerLen, innerLen] =
                await wrapper.newConstrInfo(1, 0);
            expect(majorType).to.equal(MAJOR_TAG);
            expect(tagNumber).to.equal(122);
            expect(outerLen).to.equal(1);
            expect(innerLen).to.equal(0);
        });

        it("newConstr(6, 1) — tag=127 (maximum valid)", async function () {
            const [majorType, tagNumber, outerLen, innerLen] =
                await wrapper.newConstrInfo(6, 1);
            expect(majorType).to.equal(MAJOR_TAG);
            expect(tagNumber).to.equal(127);
            expect(outerLen).to.equal(1);
            expect(innerLen).to.equal(1);
        });

        it("newConstr(7, 1) — should revert (alternative >= 7)", async function () {
            await expect(wrapper.newConstrEncoded(7, 1)).to.be.revertedWith(
                "PlutusData: alternative >= 7 requires tag 1280+"
            );
        });

        it("newConstr(10, 0) — should revert", async function () {
            await expect(wrapper.newConstrEncoded(10, 0)).to.be.revertedWith(
                "PlutusData: alternative >= 7 requires tag 1280+"
            );
        });
    });

    // ── fieldSize ───────────────────────────────────────────────────────────

    describe("fieldSize", function () {
        it("fieldSize of newConstr(0, 2) === 2", async function () {
            expect(await wrapper.testFieldSize(0, 2)).to.equal(2);
        });

        it("fieldSize of newConstr(3, 0) === 0", async function () {
            expect(await wrapper.testFieldSize(3, 0)).to.equal(0);
        });

        it("fieldSize of newConstr(0, 5) === 5", async function () {
            expect(await wrapper.testFieldSize(0, 5)).to.equal(5);
        });
    });

    // ── addConstrField + getConstrField (integer field) ────────────────────

    describe("addConstrField / getConstrField — integer", function () {
        it("stores and retrieves an integer field", async function () {
            const [intVal, majorType] = await wrapper.testAddGetIntField(0, 42);
            expect(majorType).to.equal(MAJOR_UINT);
            expect(intVal).to.equal(42);
        });

        it("stores and retrieves integer 0", async function () {
            const [intVal, majorType] = await wrapper.testAddGetIntField(0, 0);
            expect(majorType).to.equal(MAJOR_UINT);
            expect(intVal).to.equal(0);
        });

        it("stores and retrieves max uint64", async function () {
            const MAX_UINT64: BigNumber = ethers.BigNumber.from("18446744073709551615");
            const [intVal, majorType] = await wrapper.testAddGetIntField(0, MAX_UINT64);
            expect(majorType).to.equal(MAJOR_UINT);
            expect(intVal).to.equal(MAX_UINT64);
        });
    });

    // ── addConstrField + getConstrField (bytes field) ──────────────────────

    describe("addConstrField / getConstrField — bytes", function () {
        it("stores and retrieves empty bytes field", async function () {
            const [data, majorType] = await wrapper.testAddGetBytesField(0, "0x");
            expect(majorType).to.equal(MAJOR_BYTES);
            expect(data).to.equal("0x");
        });

        it("stores and retrieves a 4-byte field", async function () {
            const [data, majorType] = await wrapper.testAddGetBytesField(0, "0xdeadbeef");
            expect(majorType).to.equal(MAJOR_BYTES);
            expect(data).to.equal("0xdeadbeef");
        });

        it("stores and retrieves a 28-byte credential hash", async function () {
            const hash28 = "0x" + "ab".repeat(28);
            const [data, majorType] = await wrapper.testAddGetBytesField(0, hash28);
            expect(majorType).to.equal(MAJOR_BYTES);
            expect(data).to.equal(hash28);
        });
    });

    // ── toPlutusDataInteger ─────────────────────────────────────────────────

    describe("toPlutusDataInteger", function () {
        it("creates UInt CborValue with intValue 100", async function () {
            const [majorType, intVal] = await wrapper.testToPlutusDataInteger(100);
            expect(majorType).to.equal(MAJOR_UINT);
            expect(intVal).to.equal(100);
        });

        it("creates UInt CborValue with intValue 0", async function () {
            const [majorType, intVal] = await wrapper.testToPlutusDataInteger(0);
            expect(majorType).to.equal(MAJOR_UINT);
            expect(intVal).to.equal(0);
        });
    });

    // ── toPlutusDataBytes ───────────────────────────────────────────────────

    describe("toPlutusDataBytes", function () {
        it("creates Bytes CborValue with correct data", async function () {
            const [majorType, storedData] = await wrapper.testToPlutusDataBytes("0xcafebabe");
            expect(majorType).to.equal(MAJOR_BYTES);
            expect(storedData).to.equal("0xcafebabe");
        });

        it("creates Bytes CborValue with empty data", async function () {
            const [majorType, storedData] = await wrapper.testToPlutusDataBytes("0x");
            expect(majorType).to.equal(MAJOR_BYTES);
            expect(storedData).to.equal("0x");
        });
    });

    // ── Full round-trip: build → encode CBOR → decode ──────────────────────

    describe("Constr round-trip (encode → decode)", function () {
        it("Constr(0, intField=99) survives encode/decode", async function () {
            const [encoded, decodedTagNumber, decodedFieldInt] =
                await wrapper.testConstrRoundtrip(0, 99);

            expect(decodedTagNumber).to.equal(121); // alt 0 + 121
            expect(decodedFieldInt).to.equal(99);

            // Also verify the encoded bytes start with the right tag header
            // 0xd8 = major 6, additionalInfo 24; 0x79 = 121
            expect(encoded.slice(0, 6)).to.equal("0xd879");
        });

        it("Constr(3, intField=0) survives encode/decode — tag 124", async function () {
            const [encoded, decodedTagNumber, decodedFieldInt] =
                await wrapper.testConstrRoundtrip(3, 0);

            expect(decodedTagNumber).to.equal(124); // alt 3 + 121
            expect(decodedFieldInt).to.equal(0);
        });

        it("Constr(6, intField=1000) survives encode/decode — tag 127", async function () {
            const [encoded, decodedTagNumber, decodedFieldInt] =
                await wrapper.testConstrRoundtrip(6, 1000);

            expect(decodedTagNumber).to.equal(127); // alt 6 + 121
            expect(decodedFieldInt).to.equal(1000);
        });
    });

    // ── toPlutusDataCredential ──────────────────────────────────────────────

    describe("toPlutusDataCredential", function () {
        const hash28 = "0x" + "aa".repeat(28);

        it("payment key hash (isScriptHash=false) — tag=121", async function () {
            const [tagNumber, fieldMajorType, fieldData] =
                await wrapper.testToPlutusDataCredential(hash28, false);
            expect(tagNumber).to.equal(121); // PubKey credential = alt 0 = tag 121
            expect(fieldMajorType).to.equal(MAJOR_BYTES);
            expect(fieldData).to.equal(hash28);
        });

        it("script hash (isScriptHash=true) — tag=122", async function () {
            const [tagNumber, fieldMajorType, fieldData] =
                await wrapper.testToPlutusDataCredential(hash28, true);
            expect(tagNumber).to.equal(122); // Script credential = alt 1 = tag 122
            expect(fieldMajorType).to.equal(MAJOR_BYTES);
            expect(fieldData).to.equal(hash28);
        });
    });

    // ── Known CBOR encoding of Constr 0 with empty fields ──────────────────

    describe("Known CBOR vectors", function () {
        it("Constr 0 with empty fields === 0xd87980", async function () {
            // tag(121, []) — Plutus Constr 0 no fields
            // 0xd8 0x79 = tag 121; 0x80 = empty array
            const encoded: string = await wrapper.newConstrEncoded(0, 0);
            expect(encoded).to.equal("0xd87980");
        });

        it("Constr 1 with empty fields === 0xd87a80", async function () {
            const encoded: string = await wrapper.newConstrEncoded(1, 0);
            expect(encoded).to.equal("0xd87a80");
        });
    });
});
