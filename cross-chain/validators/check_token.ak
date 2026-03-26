use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId, flatten, quantity_of}
use cardano/transaction.{Input, Transaction}
use cross_chain/types.{AdminNftTokenInfo, CheckTokenParam}
use cross_chain/utils.{get_group_info, get_target_vh}

/// Minting policy for check tokens.
///
/// Enforces that:
/// - Only this policy's token is minted/burned (single entry in mint field)
/// - AdminNFT is present in the transaction inputs (exactly 1)
/// - When minting (amt > 0): tokens must land at target validator, count of outputs == mint amount
/// - When burning (amt < 0): output checks are skipped (AdminNFT still required)
/// - Zero-mint (amt == 0): rejected
validator check_token(param: CheckTokenParam) {
  mint(_redeemer: Data, policy_id: PolicyId, tx: Transaction) {
    let CheckTokenParam {
      group_nft,
      admin_nft,
      check_token_name,
      group_info_index,
    } = param

    let AdminNftTokenInfo { admin_nft_symbol, admin_nft_name } = admin_nft

    // Collect total value spent across all inputs
    let total_input_value =
      list.foldl(
        tx.inputs,
        assets.zero,
        fn(input, acc) { assets.merge(acc, input.output.value) },
      )

    // AdminNFT must appear exactly once in total inputs
    let has_admin_nft =
      quantity_of(total_input_value, admin_nft_symbol, admin_nft_name) == 1

    // The mint field must contain exactly one entry: (policy_id, check_token_name, amt)
    // Any other token being minted/burned in the same tx is rejected.
    let mint_entries = flatten(tx.mint)

    expect [(mint_symbol, mint_name, mint_amount)] = mint_entries

    let only_own_policy =
      mint_symbol == policy_id && mint_name == check_token_name

    let check_output =
      if mint_amount < 0 {
        // Burning: output checks skipped (AdminNFT + single-policy still required)
        True
      } else if mint_amount == 0 {
        // Zero-mint: rejected
        False
      } else {
        // Minting: total tokens at target == mint amount, output count == mint amount
        let group_info =
          get_group_info(
            list.map(tx.reference_inputs, fn(i: Input) { i.output }),
            group_nft,
          )

        let target_vh = get_target_vh(group_info, group_info_index)

        // Outputs at the target script hash
        let outputs_at_target =
          list.filter(
            tx.outputs,
            fn(output) {
              when output.address.payment_credential is {
                Script(hash) -> hash == target_vh
                _ -> False
              }
            },
          )

        // Total check tokens sent to the target
        let total_check_tokens_at_target =
          list.foldl(
            outputs_at_target,
            0,
            fn(output, acc) {
              acc + quantity_of(output.value, policy_id, check_token_name)
            },
          )

        // Each output must carry exactly 1 check token, so count == amount
        let num_outputs_at_target = list.length(outputs_at_target)

        total_check_tokens_at_target == mint_amount && num_outputs_at_target == mint_amount
      }

    has_admin_nft && only_own_policy && check_output
  }

  else(_) {
    fail
  }
}
