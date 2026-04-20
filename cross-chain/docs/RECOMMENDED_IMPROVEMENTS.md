# Recommended Future Improvements

Improvements identified during the Aiken migration that were NOT implemented in order to preserve behavioral equivalence with the original Haskell/Plutus validators. These should be considered for future work.

## CheckToken: Enforce exactly 1 token per output
**File:** `validators/check_token.ak`
**Severity:** Low

The current check is `num_outputs_at_target == mint_amount && total_check_tokens_at_target == mint_amount`. This allows skewed distributions (e.g., one output with 2 tokens and another with 0). A per-output assertion would be stronger:

```aiken
list.all(outputs_at_target, fn(o) {
  quantity_of(o.value, policy_id, check_token_name) == 1
})
```

**Why not done now:** The original Haskell had the same aggregate check. Changing this would alter which transactions are accepted.

## OutboundToken: Restrict other token names under same policy
**File:** `validators/outbound_token.ak`
**Severity:** Medium

The validator only checks `quantity_of(tx.mint, policy_id, token_name)` — it doesn't verify that no other token names under the same policy are being minted/burned. An attacker could mint additional token names alongside the legitimate one.

**Suggested fix:** Filter `assets.flatten(tx.mint)` for `policy_id` and assert exactly one entry with the expected `token_name`, similar to `check_token.ak` and `inbound_token.ak`.

**Why not done now:** The original Haskell `OutboundToken` also only checked the specific token name via `valueOf`. Matching original behavior.

## CheckToken: Per-output single-asset validation
**File:** `validators/check_token.ak`
**Severity:** Low

The output count check doesn't verify that each individual output at the target script contains only the check token + ADA (`isSingleAsset`). Currently only the aggregate is checked.

**Why not done now:** Original Haskell didn't enforce per-output single-asset either.

## InboundMintCheck: Check token output datum validation
**File:** `validators/inbound_mint_check.ak`
**Severity:** Low

The Haskell version required a `NonsenseDatum` on check token outputs (via `scriptOutputsAt'` with `bCheckDatum=True`). The Aiken version has no datum constraint on check token outputs at the `stk_vh` script.

**Why not done now:** The staking-credential routing architecture was intentionally simplified. Adding a datum requirement would be a new constraint not present in the simplified model.

## is_single_asset: Returns True for ADA-only values
**File:** `lib/cross_chain/utils.ak`
**Severity:** Medium

`is_single_asset(v, cs, tk)` checks that all entries in the flattened value are either `(cs, tk)` or ADA. An ADA-only value (no `cs`/`tk` at all) passes this check. This means a validator using `is_single_asset` to verify a token is present at an output could be fooled by an ADA-only output.

**Suggested fix:** Add a companion helper `has_exactly_one_of(v, cs, tk)` that asserts `quantity_of(v, cs, tk) == 1 && is_single_asset(v, cs, tk)`, or update callers to also check token quantity.

**Why not done now:** The original Haskell `isSingleAsset` had the same behavior. Callers typically also check `mintValue == 1` or similar, which indirectly prevents exploitation. But the helper name is misleading.

## InboundMintCheck: check_output doesn't verify token quantity at target
**File:** `validators/inbound_mint_check.ak`
**Severity:** Medium

`check_output` uses `is_single_asset(o.value, mint_policy, target_vh)` but doesn't verify the output actually contains the minted token (ADA-only values pass). The `mint_value_ok` check separately verifies 1 token was minted, but doesn't tie it to the specific output at `msg_consumer`.

**Suggested fix:** Add `quantity_of(o.value, mint_policy, target_vh) == 1` alongside the single-asset check.

**Why not done now:** The original Haskell had the same check pattern. The combination of `isSingleAsset` + `mintValue == 1` makes exploitation unlikely (the minted token must go somewhere, and the single-asset check constrains where), but an explicit check would be more robust.
