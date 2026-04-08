/**
 * Pre-computed CBOR test vectors for EVM E2E tests.
 *
 * These represent PlutusData-encoded Beneficiary structs used by
 * ERC20TokenHome4CardanoV2's parseToMsg().
 *
 * EVM receivers use tag 121 (Constr 0 = isEvmChain):
 *   Constr(0, [Constr(0, [<20-byte raw EVM address>]), amount])
 *
 * Cardano receivers use tag 122 (Constr 1 = !isEvmChain):
 *   Constr(0, [Constr(1, [<AdaAddress>]), amount])
 *
 * Sources:
 * - EVM vector from evm-contracts/test/TestMsgTask4Inboundjs (line 53)
 * - Cardano vectors from evm-contracts/utils/plutusDataTool.js genBeneficiaryData()
 */

// ── Inbound: Cardano → EVM (EVM receiver, raw 20-byte address) ──────────────

/**
 * EVM receiver 0x1d1e18e1a484d0a10623661546ba97defab7a7ae, amount 10000
 * Known-good vector from TestMsgTask4Inboundjs.
 */
export const EVM_RECEIVER_10000 = "0xd8799fd8799f541d1e18e1a484d0a10623661546ba97defab7a7aeff192710ff";
export const EVM_RECEIVER_10000_ADDR = "0x1d1e18e1a484d0a10623661546ba97DEfAB7a7AE";
export const EVM_RECEIVER_10000_AMOUNT = 10000;

/**
 * EVM receiver 0x70997970C51812dc3A010C7d01b50e0d17dc79C8, amount 1
 * (Hardhat default signer #1 address, raw 20-byte encoding)
 *
 * CBOR: d879 9f d879 9f 54 <20 bytes> ff 01 ff
 */
export const EVM_RECEIVER_1 = "0xd8799fd8799f5470997970c51812dc3a010c7d01b50e0d17dc79c8ff01ff";
export const EVM_RECEIVER_1_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const EVM_RECEIVER_1_AMOUNT = 1;

// ── Outbound: EVM → Cardano (Cardano receiver) ─────────────────────────────

/**
 * Cardano receiver addr_test1qpm0q3dmc0cq4ea75dum0dgpz4x5jsdf6jk0we04yktpuxnk7pzmhslsptnmagmek76sz92df9q6n49v7ajl2fvkrcdq9semsd
 * Amount: 10000
 *
 * Generated via: plutusDataTool.js genBeneficiaryData(addr, 10000)
 */
export const CARDANO_RECEIVER_10000 = "0xd8799fd87a9fd8799fd8799f581c76f045bbc3f00ae7bea379b7b501154d4941a9d4acf765f525961e1affd8799fd8799fd8799f581c76f045bbc3f00ae7bea379b7b501154d4941a9d4acf765f525961e1affffffffff192710ff";
export const CARDANO_RECEIVER_10000_AMOUNT = 10000;
