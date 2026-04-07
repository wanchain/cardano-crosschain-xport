use aiken/collection/list
use aiken/option.{is_none}
use cardano/address.{Address}
use cardano/assets.{
  AssetName, PolicyId, Value, ada_asset_name, ada_policy_id, flatten, merge,
  quantity_of,
}
use cardano/transaction.{Input, Output}
use cross_chain/types.{GroupInfoIndex, GroupInfoParams, GroupNFTTokenInfo}

/// Sum values at all outputs matching the given address.
pub fn value_at_address(outputs: List<Output>, addr: Address) -> Value {
  list.foldl(
    outputs,
    assets.zero,
    fn(output, acc) {
      if output.address == addr {
        merge(output.value, acc)
      } else {
        acc
      }
    },
  )
}

/// Filter outputs at a specific address.
pub fn outputs_at(outputs: List<Output>, addr: Address) -> List<Output> {
  list.filter(outputs, fn(output) { output.address == addr })
}

/// Sum values across all inputs (optionally filtered by address).
pub fn total_input_value(inputs: List<Input>, addr: Option<Address>) -> Value {
  list.foldl(
    inputs,
    assets.zero,
    fn(input, acc) {
      if is_none(addr) || Some(input.output.address) == addr {
        merge(input.output.value, acc)
      } else {
        acc
      }
    },
  )
}

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
