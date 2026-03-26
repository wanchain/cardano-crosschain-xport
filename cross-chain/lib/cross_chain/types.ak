use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference}

/// Configuration parameters for the storeman group.
/// Stored as datum in the GroupNFT holder UTxO.
pub type GroupInfoParams {
  version: ScriptHash,
  admin: ByteArray,
  gpk: ByteArray,
  balance_worker: ByteArray,
  treasury_check_vh: ByteArray,
  oracle_worker: ByteArray,
  mint_check_vh: ByteArray,
  stk_vh: ByteArray,
  stake_check_vh: ByteArray,
  nft_ref_holder_vh: ByteArray,
  nft_treasury_check_vh: ByteArray,
  nft_mint_check_vh: ByteArray,
  outbound_holder_vh: ByteArray,
  inbound_check_vh: ByteArray,
}

/// Admin multi-sig datum
pub type AdminDatum {
  signatories: List<ByteArray>,
  min_num_signatures: Int,
}

/// Placeholder datum for state-tracking UTxOs
pub type NonsenseDatum {
  data_reserve: Int,
}

/// Identifies a GroupNFT token
pub type GroupNFTTokenInfo {
  group_nft_symbol: PolicyId,
  group_nft_name: AssetName,
}

/// Identifies an AdminNFT token
pub type AdminNftTokenInfo {
  admin_nft_symbol: PolicyId,
  admin_nft_name: AssetName,
}

/// Identifies a check token
pub type CheckTokenInfo {
  check_token_symbol: PolicyId,
  check_token_name: AssetName,
}

/// Combined GroupNFT + AdminNFT identifiers
pub type GroupAdminNFTInfo {
  group: GroupNFTTokenInfo,
  admin: AdminNftTokenInfo,
}

/// Combined GroupNFT + AdminNFT + CheckToken identifiers
pub type GroupAdminNFTCheckTokenInfo {
  group_nft: GroupNFTTokenInfo,
  admin_nft: AdminNftTokenInfo,
  check_token: CheckTokenInfo,
}

/// Parameters for the InboundMintCheck validator
pub type InboundMintCheckInfo {
  gact: GroupAdminNFTCheckTokenInfo,
  mint_policy: PolicyId,
}

/// Address type for cross-chain messaging
pub type MsgAddress {
  ForeignAddress(ByteArray)
  LocalAddress(Address)
}

/// Function call data for cross-chain messages
pub type FunctionCallData {
  function_name: ByteArray,
  function_args: ByteArray,
}

/// Cross-chain message data
pub type CrossMsgData {
  task_id: ByteArray,
  source_chain_id: Int,
  source_contract: MsgAddress,
  target_chain_id: Int,
  target_contract: MsgAddress,
  gas_limit: Int,
  function_call_data: FunctionCallData,
}

/// Parameters for the outbound token minting policy
pub type OutboundTokenParams {
  group_nft: GroupNFTTokenInfo,
  token_name: AssetName,
}

/// Parameters for the XPort spending validator
pub type KeyParam {
  pkh: VerificationKeyHash,
  nonce: Int,
}

/// Parameters for the CheckToken minting policy
pub type CheckTokenParam {
  group_nft: GroupNFTTokenInfo,
  admin_nft: AdminNftTokenInfo,
  check_token_name: AssetName,
  /// Which field in GroupInfoParams points to the target validator
  group_info_index: GroupInfoIndex,
}

/// Index into GroupInfoParams for check token target
pub type GroupInfoIndex {
  TreasuryCheckVH
  MintCheckVH
  StakeCheckVH
  NFTRefHolderVH
  NFTTreasuryCheckVH
  NFTMintCheckVH
  OutboundHolderVH
  InboundCheckVH
}

/// Redeemer for AdminNFTHolder
pub type AdminActionRedeemer {
  Use
  Update
  Upgrade
}

/// Inbound proof data for cross-chain message verification
pub type InboundProofData {
  cross_msg_data: CrossMsgData,
  ttl: Int,
  /// Signature mode: 0=ECDSA secp256k1, 1=Schnorr secp256k1, 2=Ed25519
  mode: Int,
  nonce: OutputReference,
}

/// Inbound proof with signature
pub type InboundProof {
  proof_data: InboundProofData,
  signature: ByteArray,
}

/// Redeemer for InboundMintCheck
pub type InboundCheckRedeemer {
  BurnInboundCheckToken
  InboundCheckRedeemer(InboundProof)
}
