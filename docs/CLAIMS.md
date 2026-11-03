# Claims

Every claim Handover makes, the code that implements it, and the proof. Line numbers point at the
definition of the function or constant. Test names are exact (Rust tests are in
`contracts/handover/src/tests.rs`, TypeScript tests in `packages/cleancheck/test/`).

Status values:

- **verified by unit test**: the named test passes in `make verify` (no network).
- **verified by make verify**: checked by another step of `make verify`.
- **pending evidence run**: needs a deployed contract, NEAR testnet and Sepolia. Nothing has been
  deployed yet, so `evidence/` holds no chain data. These rows stay pending until the evidence run
  described in `evidence/README.md` is done and its files are committed.

Unit tests of the contract run against the NEAR SDK mock environment. They do not call the real MPC
contract: the MPC response is a signature made with a throwaway test key (`k256`), and the tests
recover the signer from the assembled transaction.

## A. Security requirements (PRD section 7)

| # | Claim | Code | Proof | Status |
|---|---|---|---|---|
| A1 | Only the current owner can request signatures. | [`require_owner` lib.rs:210](../contracts/handover/src/lib.rs#L210), used by [`request_transfer` wallet.rs:45](../contracts/handover/src/wallet.rs#L45) | `request_transfer_rejects_non_owner`, `request_transfer_rejects_unknown_token` | verified by unit test |
| A2 | After `buy` or `nft_transfer` the old owner is refused (sign, retry, list). | same guard; ownership is read from the NEP-171 state on every call | `old_owner_refused_after_buy`, `old_owner_cannot_request_after_nft_transfer`, `old_owner_cannot_retry_or_list_after_nft_transfer`, `nft_transfer_moves_ownership_and_refuses_old_owner` | verified by unit test |
| A3 | A buyer can sign right after the sale, and the log continues from the seller's last nonce. | [`finish_signing` wallet.rs:217](../contracts/handover/src/wallet.rs#L217) | `buyer_signs_after_sale_and_log_continues_from_seller_nonce` | verified by unit test |
| A4 | No signing while the token is listed. | [`assert_can_sign` wallet.rs:172](../contracts/handover/src/wallet.rs#L172) | `request_transfer_rejected_while_listed`, `retry_reserved_rejected_while_listed` | verified by unit test |
| A5 | No second signing request while one is in flight. | `assert_can_sign` (same) | `no_second_request_while_in_flight`, `no_retry_while_in_flight` | verified by unit test |
| A6 | No listing while a request is in flight or a transaction is reserved. | [`list` market.rs:19](../contracts/handover/src/market.rs#L19) | `list_rejected_while_in_flight`, `list_rejected_while_reserved` | verified by unit test |
| A7 | Delisting unfreezes signing. | [`delist` market.rs:43](../contracts/handover/src/market.rs#L43) | `delist_unfreezes_signing` | verified by unit test |
| A8 | Nonces are strictly sequential and the log is ordered by nonce. | `finish_signing` (nonce taken from `next_nonce`, advanced only on success) | `nonces_are_strictly_sequential_and_log_is_ordered`, `on_signed_logs_tx_that_recovers_to_signer_and_advances_nonce`, `sig_log_pagination` | verified by unit test |
| A9 | A failed MPC call never consumes a nonce. | [`mark_failed` wallet.rs:268](../contracts/handover/src/wallet.rs#L268) | `failed_mpc_call_keeps_reservation_and_does_not_consume_nonce` | verified by unit test |
| A10 | The contract only signs plain ETH transfers it built itself: empty input, empty access list, recipient present. No method takes calldata, an access list or a chain id. | [`build_plain_transfer` tx.rs:71](../contracts/handover/src/tx.rs#L71), [`is_plain_transfer` tx.rs:88](../contracts/handover/src/tx.rs#L88), check at [wallet.rs:77](../contracts/handover/src/wallet.rs#L77), parameter rules in [`validate_transfer` tx.rs:41](../contracts/handover/src/tx.rs#L41) | `only_plain_transfers_can_be_built`, `transfer_parameter_validation`, `contract_rejects_bad_address`, `contract_rejects_zero_value` | verified by unit test |
| A11 | The payload sent to MPC is exactly the hash of that transaction, with domain 0 and 1 yocto attached. | [`sign_promise` wallet.rs:197](../contracts/handover/src/wallet.rs#L197) | `request_transfer_calls_mpc_with_exact_args_and_one_yocto` | verified by unit test |
| A12 | The transaction hash the contract computes matches an independent implementation (viem). | [`signing_hash` tx.rs:93](../contracts/handover/src/tx.rs#L93) | `matches_independent_viem_vector`; `pnpm --filter checks check:4` (same vector, TypeScript side) | verified by unit test; check 4 offline PASS (`make checks-offline`) |
| A13 | `buy` needs at least the price, pays the seller exactly the price, refunds the excess, and moves the NFT in the same call. | [`buy` market.rs:56](../contracts/handover/src/market.rs#L56) | `buy_moves_nft_pays_seller_exactly_and_refunds_excess`, `buy_with_exact_price_has_no_refund_receipt`, `buy_rejects_underpayment`, `buy_rejects_unlisted_token`, `seller_cannot_buy_own_listing` | verified by unit test |
| A14 | A sale cannot happen while a signature may still appear. | `buy` (defence in depth) and `list` | `buy_rejected_while_in_flight_or_reserved` | verified by unit test |
| A15 | `buy` clears NEP-178 approvals. | `buy` calls the standard `internal_transfer` | `buy_clears_approvals` | verified by unit test |
| A16 | `nft_transfer` and `nft_transfer_call` are refused while listed, in flight or reserved; an approved account cannot move a listed token. | [`assert_transferable` lib.rs:234](../contracts/handover/src/lib.rs#L234) | `nft_transfer_rejected_while_listed`, `nft_transfer_call_rejected_while_listed`, `nft_transfer_rejected_while_in_flight`, `nft_transfer_rejected_while_reserved`, `nft_transfer_call_rejected_while_reserved`, `approved_account_cannot_transfer_listed_token` | verified by unit test |
| A17 | `list` and `delist` need exactly 1 yoctoNEAR (full-access-key confirmation). `request_transfer`, `retry_reserved` and `nft_mint` need a larger deposit, which a function-call access key cannot attach. | `assert_one_yocto()` at [market.rs:20](../contracts/handover/src/market.rs#L20) and [market.rs:44](../contracts/handover/src/market.rs#L44); fee checks below | `list_requires_exactly_one_yocto_not_zero`, `list_requires_exactly_one_yocto_not_more`, `delist_requires_one_yocto` | verified by unit test |
| A18 | The contract has no owner, admin, config setter, upgrade or key-management code. | all of `contracts/handover/src` (no such method exists) | `production_sources_have_no_upgrade_or_key_management` (scans production sources for banned patterns) | verified by unit test |
| A19 | The deployed contract account has no access keys, so the code can never change. | deploy runbook in README section 14 | `evidence/access-keys.txt` (`view_access_key_list` output with an empty key list) | pending evidence run |
| A20 | The committed wasm is the file whose hash is recorded. | [`contracts/res/handover.wasm.sha256`](../contracts/res/handover.wasm.sha256), build record in [`contracts/res/BUILD.md`](../contracts/res/BUILD.md) | `sha256sum -c` in `make verify` step 4 | verified by make verify |
| A21 | The deployed code is the committed wasm. | n/a | compare the deployed code hash (`near contract view-account-summary`) with `handover.wasm.sha256` | pending evidence run |
| A22 | ERC-20 transfers. | not built (P1) | n/a | not built |

## B. Reserved transaction (decision D1)

Why: the MPC network publishes a signature on chain when it responds, even if the Handover callback
then fails or the call timed out. A failed attempt therefore does not prove that no signature exists.

| # | Claim | Code | Proof | Status |
|---|---|---|---|---|
| B1 | `request_transfer` stores the exact transaction as reserved for its nonce, and sets `in_flight`, before calling MPC. | [`request_transfer` wallet.rs:45](../contracts/handover/src/wallet.rs#L45), [`ReservedTx` types.rs:19](../contracts/handover/src/types.rs#L19) | `request_transfer_calls_mpc_with_exact_args_and_one_yocto` | verified by unit test |
| B2 | On a failed or timed-out MPC call the reservation stays and `in_flight` clears. | [`mark_failed` wallet.rs:268](../contracts/handover/src/wallet.rs#L268) | `failed_mpc_call_keeps_reservation_and_does_not_consume_nonce` | verified by unit test |
| B3 | While a transaction is reserved, a new `request_transfer` is rejected whatever its arguments. | wallet.rs:67 | `new_request_rejected_while_reserved_even_with_different_args` | verified by unit test |
| B4 | `retry_reserved` re-requests a signature for the identical payload; success logs it and advances the nonce. | [`retry_reserved` wallet.rs:109](../contracts/handover/src/wallet.rs#L109) | `retry_reserved_resigns_identical_payload_then_nonce_advances`, `retry_reserved_requires_a_reservation`, `retry_reserved_owner_only`, `retry_reserved_requires_sign_fee` | verified by unit test |
| B5 | `on_signed` never panics on a bad response; every parse or validation problem leaves the reservation in place. | [`on_signed` wallet.rs:142](../contracts/handover/src/wallet.rs#L142), [`finish_signing` wallet.rs:217](../contracts/handover/src/wallet.rs#L217) | `on_signed_never_panics_on_bad_responses_and_keeps_reservation`, `on_signed_ignores_stale_or_unknown_callbacks_without_panicking` | verified by unit test |
| B6 | The logged transaction is rebuilt from the reservation, never from callback data, and the signature must be well formed, low-s and recoverable before it is logged. Recovery cannot pin the signer: that the signature belongs to the token's derived key is guaranteed by the MPC contract, which this contract trusts. | `finish_signing`, [`signature_recovers` tx.rs:156](../contracts/handover/src/tx.rs#L156) | `on_signed_logs_tx_that_recovers_to_signer_and_advances_nonce`, `on_signed_never_panics_on_bad_responses_and_keeps_reservation` | verified by unit test |
| B7 | `on_signed` can only be called by the contract itself. In unit tests the `#[private]` macro is not enforced, so an explicit predecessor check at [wallet.rs:148](../contracts/handover/src/wallet.rs#L148) is tested; the macro is enforced only at runtime. | `on_signed` | `on_signed_rejects_non_contract_predecessor` (explicit check only) | verified by unit test (explicit check); runtime `#[private]` pending evidence run |
| B8 | The clean check reports a reserved transaction as `busy` with an explanatory reason, and as `inconsistent` if the reserved nonce is not `next_nonce`. | [`cleanCheck` check.ts:22](../packages/cleancheck/src/check.ts#L22) | `reserved.test.ts`: "is busy with the retry reason", "is inconsistent when reserved nonce differs from next nonce", "in flight keeps its own busy reason" | verified by unit test |
| B9 | `list`, `buy`, `nft_transfer`, `nft_transfer_call` are refused while a transaction is reserved. | `list`, `buy`, `assert_transferable` | `list_rejected_while_reserved`, `buy_rejected_while_in_flight_or_reserved`, `nft_transfer_rejected_while_reserved`, `nft_transfer_call_rejected_while_reserved` | verified by unit test |
| B10 | The scenario "MPC times out, a signature leaks, the wallet is then sold" is blocked on a real network. | all of the above | needs a real MPC timeout; not reproducible on demand | pending evidence run (not expected to occur) |

## C. Signature encoding (decision D2)

| # | Claim | Code | Proof | Status |
|---|---|---|---|---|
| C1 | `r` is taken from the compressed point `big_r` without its prefix byte, `s` from the scalar, `v` from `recovery_id` (0 or 1). | [`parse_response` tx.rs:114](../contracts/handover/src/tx.rs#L114) | `on_signed_logs_tx_that_recovers_to_signer_and_advances_nonce`, `on_signed_never_panics_on_bad_responses_and_keeps_reservation` | verified by unit test |
| C2 | Leading zero bytes of `r` and `s` are stripped before RLP encoding, so the signed transaction is canonical. | [`strip_leading_zeros` tx.rs:97](../contracts/handover/src/tx.rs#L97), [`assemble` tx.rs:145](../contracts/handover/src/tx.rs#L145) | `canonical_rlp_when_r_has_leading_zero_byte`, `canonical_rlp_when_s_has_leading_zero_byte` | verified by unit test |
| C3 | The clean-check library rejects non-canonical integers when decoding logged transactions. | [`decodeSignedTx` tx.ts:85](../packages/cleancheck/src/tx.ts#L85) | `convert_tx.test.ts`: "rejects a non-canonical integer with a leading zero byte" | verified by unit test |
| C4 | A signature returned by the real MPC contract has the shape the contract expects (`scheme`, `big_r.affine_point`, `s.scalar`, `recovery_id`). | [`mpc.rs`](../contracts/handover/src/mpc.rs) | `pnpm --filter checks check:2 -- --parse <tx>` against the probe contract; evidence run | pending evidence run |
| C5 | A transaction signed through the contract is accepted and mined on Sepolia. | n/a | `pnpm --filter checks check:5` writes `evidence/e2e-<timestamp>.json` | pending evidence run |

## D. Fees, storage and gas (decision D3)

| # | Claim | Code | Proof | Status |
|---|---|---|---|---|
| D1 | `request_transfer` and `retry_reserved` need at least `SIGN_FEE` (0.01 NEAR); exactly 1 yocto goes to MPC; the excess over `SIGN_FEE` is refunded to the caller. | [`SIGN_FEE` lib.rs:64](../contracts/handover/src/lib.rs#L64), [`charge_sign_fee` wallet.rs:185](../contracts/handover/src/wallet.rs#L185), [`MPC_DEPOSIT` mpc.rs](../contracts/handover/src/mpc.rs) | `request_transfer_requires_sign_fee`, `request_transfer_exact_sign_fee_has_no_refund_receipt`, `request_transfer_calls_mpc_with_exact_args_and_one_yocto`, `retry_reserved_requires_sign_fee` | verified by unit test |
| D2 | `nft_mint` needs at least `MINT_FEE` (0.05 NEAR), charges the measured storage and refunds the rest. | [`nft_mint` lib.rs:141](../contracts/handover/src/lib.rs#L141), [`MINT_FEE` lib.rs:66](../contracts/handover/src/lib.rs#L66) | `mint_requires_mint_fee`, `mint_refunds_excess_beyond_measured_storage`, `mint_assigns_sequential_ids_and_wallet_state` | verified by unit test |
| D3 | `get_config` exposes `mpc_contract_id`, `chain_id`, `path_prefix`, `sign_fee`, `mint_fee`. | [`get_config` views.rs:14](../contracts/handover/src/views.rs#L14) | `init_sets_config_and_metadata` | verified by unit test |
| D4 | Calls with too little gas are rejected up front (minimum 100 Tgas, 300 recommended); `sign` gets 50 Tgas static plus unused gas, `on_signed` gets 30 Tgas. | [`MIN_PREPAID_GAS` mpc.rs:29](../contracts/handover/src/mpc.rs#L29), `SIGN_GAS`, `CALLBACK_GAS` in the same file | `request_transfer_requires_enough_gas`, `callback_gas_is_well_within_budget` (counts host-function gas only, so it is a lower bound) | verified by unit test; real gas pending evidence run |
| D5 | The sign-fee leftover pays for log storage for the lifetime of the contract, with no key left to top it up. | `SIGN_FEE` | storage per entry is not yet measured on testnet | pending evidence run |

## E. Clean check and snapshots (off-chain)

| # | Claim | Code | Proof | Status |
|---|---|---|---|---|
| E1 | Verdict `clean` only if the log is dense (nonces 0..next_nonce-1), nothing is in flight or reserved, and the Sepolia confirmed nonce equals `next_nonce`. | [`cleanCheck` check.ts:22](../packages/cleancheck/src/check.ts#L22) | `check.test.ts`: "cleanCheck: happy paths" (4 tests) | verified by unit test |
| E2 | Verdict `dirty` with the list of unmined signed transactions (and which are already in the mempool) when the chain nonce is below `next_nonce`. | `cleanCheck` | `check.test.ts`: "cleanCheck: dirty" (5 tests) | verified by unit test |
| E3 | Verdict `busy` while a request is in flight (takes precedence over `dirty`). | `cleanCheck` | `check.test.ts`: "cleanCheck: busy" (3 tests) | verified by unit test |
| E4 | Verdict `inconsistent` if the log has a missing, duplicate or extra nonce, or the chain is ahead of the contract. | `cleanCheck` | `check.test.ts`: "cleanCheck: inconsistent" (11 tests) | verified by unit test |
| E5 | The `listed` flag does not change any verdict (the buyer's check does not trust the seller's listing state). | `cleanCheck` | `check.test.ts`: "cleanCheck: listed flag" | verified by unit test |
| E6 | Each logged transaction is checked against its raw bytes: hash, nonce, chain id, recipient, value, gas and fees. Any mismatch makes the snapshot `inconsistent`. Signatures are not recovered offline. | [`verifySnapshot` snapshot.ts:82](../packages/cleancheck/src/snapshot.ts#L82) | `snapshot.test.ts`: "verifySnapshot" (10 tests) | verified by unit test |
| E7 | The bundled fixtures verify to their stated verdicts and are labelled synthetic. | `packages/cleancheck/test/fixtures/*.json` | `snapshot.test.ts`: "committed fixtures"; `make verify` step 3 | verified by make verify |
| E8 | The Ethereum address is derived from the MPC `derived_public_key` view (keccak of x\|\|y). | [`ethAddressFromMpcKey` address.ts:41](../packages/cleancheck/src/address.ts#L41) | `address.test.ts`: "maps the public key of private key 1 to its known address (64-byte x\|\|y)" | verified by unit test |
| E9 | The address agrees across the live MPC view, an independent noble derivation and an address recovered from a real signature. | [`checks/03-address-agreement.ts`](../checks/03-address-agreement.ts) | `check:3 --offline` passes against a synthetic research vector (`make checks-offline`); live agreement is pending | offline vector verified; live pending evidence run |
| E10 | The same clean check runs in the web app, the CLI and `make verify`. | [`runCleanCheck` rpc.ts:181](../packages/cleancheck/src/rpc.ts#L181), `web/src/lib/chain/status.ts` | `rpc.test.ts`: "runCleanCheck" (4 tests, mocked RPC) | verified by unit test (mocked RPC) |
| E11 | On the real testnet deployment, a seller's pre-signed transaction is caught (`dirty`), broadcast, and the wallet turns `clean`. | n/a | real snapshots in `evidence/snapshots/` | pending evidence run |

## F. Product claims

| # | Claim | Proof | Status |
|---|---|---|---|
| F1 | Each token has its own Ethereum address derived by NEAR Chain Signatures from `(contract account, "handover-<token_id>")`. | path built at [wallet.rs:197](../contracts/handover/src/wallet.rs#L197) (`PATH_PREFIX` [lib.rs:61](../contracts/handover/src/lib.rs#L61)); address agreement E9 | path verified by unit test; live address pending evidence run |
| F2 | The contract is a NEP-171 NFT with NEP-177 metadata, NEP-178 approvals and NEP-181 enumeration. | [`lib.rs:249-376`](../contracts/handover/src/lib.rs#L249) implements the standard traits through `near-contract-standards`; ABI in `contracts/res/handover_abi.json` | `mint_assigns_sequential_ids_and_wallet_state`, `nft_transfer_moves_ownership_and_refuses_old_owner`; conformance on testnet pending | partly verified by unit test; pending evidence run |
| F3 | The wasm is deployable (size under the 1.5 MiB transaction limit). | 311477 bytes | `pnpm --filter checks check:4` (`make checks-offline`) | verified (offline) |
| F4 | A full sale (mint, fund, spend, list, clean check, buy, buyer spends, old owner refused) works on NEAR testnet and Sepolia. | n/a | `evidence/e2e-*.json`, `evidence/snapshots/*.json`, NEAR explorer links | pending evidence run |
| F5 | Hosted demo reads the same contract and runs the same clean check. | `web/src/lib/chain/` | hosted URL | pending evidence run (not deployed) |
