/// Always-true minting policy for local devnet testing only.
/// Used as a stand-in for the production inbound check token
/// (which requires MPC signature verification).
validator test_mint {
  mint(_: Data, _policy_id: ByteArray, _self: Data) {
    True
  }

  else(_) {
    fail
  }
}
