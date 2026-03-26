use aiken/collection/list
use cardano/assets.{
  AssetName, PolicyId, Value, ada_asset_name, ada_policy_id, flatten,
  quantity_of,
}
use cardano/transaction.{Output}
use cross_chain/types.{GroupInfoIndex, GroupInfoParams, GroupNFTTokenInfo}

/// Check if a Value contains only the specified token and ADA.
/// No other tokens are allowed.
pub fn is_single_asset(v: Value, cs: PolicyId, tk: AssetName) -> Bool {
  flatten(v)
    |> list.all(
        fn(entry) {
          let (cs2, tk2, _) = entry
          cs2 == cs && tk2 == tk || cs2 == ada_policy_id && tk2 == ada_asset_name
        },
      )
}

/// Find the GroupInfoParams from a reference input holding the GroupNFT.
pub fn get_group_info(
  reference_inputs: List<Output>,
  group_nft: GroupNFTTokenInfo,
) -> GroupInfoParams {
  let GroupNFTTokenInfo { group_nft_symbol, group_nft_name } = group_nft
  expect [matching_output] =
    reference_inputs
      |> list.filter(
          fn(output) {
            quantity_of(output.value, group_nft_symbol, group_nft_name) > 0
          },
        )
  expect datum: GroupInfoParams =
    when matching_output.datum is {
      transaction.InlineDatum(d) -> d
      _ -> fail @"Expected inline datum on GroupNFT reference input"
    }
  datum
}

/// Look up the target validator hash from GroupInfoParams by index.
pub fn get_target_vh(
  params: GroupInfoParams,
  index: GroupInfoIndex,
) -> ByteArray {
  when index is {
    types.TreasuryCheckVH -> params.treasury_check_vh
    types.MintCheckVH -> params.mint_check_vh
    types.StakeCheckVH -> params.stake_check_vh
    types.NFTRefHolderVH -> params.nft_ref_holder_vh
    types.NFTTreasuryCheckVH -> params.nft_treasury_check_vh
    types.NFTMintCheckVH -> params.nft_mint_check_vh
    types.OutboundHolderVH -> params.outbound_holder_vh
    types.InboundCheckVH -> params.inbound_check_vh
  }
}
