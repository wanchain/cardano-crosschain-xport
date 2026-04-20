/**
 * Shared configuration for cross-chain E2E tests.
 */

// Chain endpoints
export const HARDHAT_RPC = 'http://localhost:8545';
export const YACI_STORE_URL = 'http://localhost:8080/api/v1';
export const YACI_ADMIN_URL = 'http://localhost:10000';

// Chain IDs
export const CARDANO_CHAIN_ID = 2147485463; // BIP-44 Cardano Preprod
export const HARDHAT_CHAIN_ID = 31337;

// Default gas limits / fees
export const BASE_FEE_GWEI = 1; // 1 gwei per gas unit
export const OUTBOUND_GAS_LIMIT = 300_000;
export const INBOUND_GAS_LIMIT = 1_000_000;

// Deployer wallet seed (shared — deploys validators once in beforeAll)
export const CARDANO_SEED1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
