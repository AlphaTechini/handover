# Handover

**An NFT that owns its own Ethereum wallet, and a sale flow that lets you buy that wallet and its ETH without trusting the seller.**

Who it is for: anyone who needs to hand over a whole wallet instead of moving assets one by one. Examples: handing a project or treasury wallet to a new team, selling a funded wallet, or gifting one. The buyer gets the wallet itself, not a promise. Two contracts are deployed. **v1** (`handover.handover-alpha.testnet`, locked) moves ETH only: tokens or NFTs sent to a v1 wallet can never be moved. **v2** (`handover-v2-alpha.testnet`, what the hosted demo runs) also moves ERC-20, ERC-721 and ERC-1155 tokens, with token-transfer calls the contract encodes itself and never an approval, so a buyer gets the tokens too ([v2 evidence](evidence/v2-run-2026-11-05.md)). v2 is not locked yet. The demo video and the main evidence run use v1.

Status: **deployed and locked on NEAR testnet** at [`handover.handover-alpha.testnet`](https://testnet.nearblocks.io/address/handover.handover-alpha.testnet) (no access keys left, so the code can never change: [`evidence/access-keys.txt`](evidence/access-keys.txt)), with a hosted demo at **https://handover-blush.vercel.app**. A full sale (mint, fund, spend, list, clean check, buy, buyer spends, old owner refused) ran on NEAR testnet and Ethereum Sepolia, and its proof is in [`evidence/`](evidence/README.md). The recorded demo ran the same flow again through the web app, including a caught pre-signed transaction: [`evidence/demo-run-2026-11-05.md`](evidence/demo-run-2026-11-05.md). Testnets only.

**Check it in 30 seconds, with no wallet and no keys:**

- Open https://handover-blush.vercel.app/wallet/?id=0. The page reads the v2 contract and Sepolia from your browser and shows wallet #0 of the v2 run as **Clean** (6 signatures issued, Sepolia nonce 6), its token holdings, and a signature log that labels each ERC-20, ERC-721 and ERC-1155 transfer.
- Or from a terminal, after `pnpm install` in a clone:

  ```bash
  HANDOVER_CONTRACT=handover.handover-alpha.testnet pnpm --silent --filter @handover/cleancheck cli status 1
  ```

  It prints `VERDICT: CLEAN` (14 s on the measured run). The code behind it is [`packages/cleancheck/src/check.ts`](packages/cleancheck/src/check.ts); the contract is [`contracts/handover/src/`](contracts/handover/src/).

The full offline suite is `make verify` ([section 8](#8-verify-everything-offline-make-verify)): about 1 minute with a warm Rust build, about 6.5 minutes from a fresh clone, most of it compiling the contract tests.

## 2. Built for NEAR HACKATHON

Built for **NEAR HACKATHON**. Tracks: **NFTs That Do Something** (`nfts`) and **Open Innovation** (`open`, chain abstraction). Security is a candidate third track that the builder may add at submission, because resale safety is the core of the product.

| Track brief item | Where Handover does it | File |
|---|---|---|
| NFTs as accounts that own money | Each NFT controls a real Ethereum address and its balance | [`contracts/handover/src/wallet.rs`](contracts/handover/src/wallet.rs) |
| Hold inventory | The wallet page shows the address, live Sepolia balance and signature log | [`web/src/routes/wallet/+page.svelte`](web/src/routes/wallet/+page.svelte) |
| Carry access rights | Owning the NFT is the only way to request a signature for the address | [`contracts/handover/src/lib.rs`](contracts/handover/src/lib.rs) (`require_owner`), [`wallet.rs`](contracts/handover/src/wallet.rs) |
| Ownership with behaviour | The NFT freezes signing when listed and refuses signatures that could survive a sale | [`contracts/handover/src/market.rs`](contracts/handover/src/market.rs) |
| Chain abstraction (Open Innovation) | A NEAR contract controls an Ethereum Sepolia account through Chain Signatures, with no private key anywhere | [`contracts/handover/src/mpc.rs`](contracts/handover/src/mpc.rs), [`tx.rs`](contracts/handover/src/tx.rs) |
| Security (candidate) | Public signature log, clean check, locked contract | [`packages/cleancheck/src/check.ts`](packages/cleancheck/src/check.ts) |

NEP-171 is used through `near-contract-standards`. Sub-accounts and dynamic NFT metadata are not used (metadata is static).

## 3. The problem

Some value cannot be moved by sending tokens: vesting schedules and locks pay a fixed address, and a wallet with many assets takes many transactions to empty. The only way to transfer it is to transfer control of the address. Today that means handing over a private key or seed phrase. The seller keeps a copy, can drain the wallet after being paid, and the buyer can never prove otherwise.

NEAR Chain Signatures lets a NEAR contract control an Ethereum address with no private key that anyone holds, and an NFT can decide who may use it. But owning the NFT is not enough to make a sale safe. Four risks remain:

1. **Pre-signed transactions.** The seller asks for a signature before selling, keeps the signed transaction, sells the NFT, then broadcasts it and drains the wallet.
2. **Standing approvals.** On Ethereum the seller can approve another contract to spend the wallet's tokens. That right survives the sale and needs no new signature.
3. **Upgradeable contract.** Whoever controls the NFT contract's account can upgrade it and take every wallet.
4. **Non-atomic payment.** The buyer pays and the seller does not transfer, or the reverse.

### Prior art

NFT Chain Keys ([`near/multichain-gas-station-contract`, directory `nft_key`](https://github.com/near/multichain-gas-station-contract/tree/master/nft_key), deployed on testnet as `nft.kagi.testnet`) made MPC keys transferable as NEP-171 tokens: the holder of the token can call `ckt_sign_hash` and get a signature for a 32-byte payload. Its documentation already imagined a marketplace for remote accounts. (The page on docs.near.org that described it has been removed, so the source repository is the reference.)

**What Handover does not claim to invent:** NFT-controlled MPC keys (NFT Chain Keys did this first), Chain Signatures, or the NFT standard.

**What Handover adds** is the part that makes the wallet sellable: every signature is public and sequential, listing freezes signing, only plain ETH transfers can ever be signed (so no approval can be created), the contract has no upgrade path and its keys are meant to be deleted, and payment and transfer happen in one call.

## 4. How it works

Each Handover NFT has its own Ethereum address, derived by NEAR Chain Signatures from the Handover contract's account and the path `handover-<token_id>`. Only the Handover contract can ask the MPC signer for signatures on that address.

1. **Mint.** `nft_mint` creates token `0`, `1`, `2`, ... for the caller. The UI and CLI derive the token's Ethereum address from the MPC contract's `derived_public_key` view.
2. **Spend (owner only).** `request_transfer(token_id, to, value_wei, gas_limit, max_fee_per_gas, max_priority_fee_per_gas)` checks the caller owns the token and that the token is not listed, not already signing and not in a pending transfer call. The contract builds an EIP-1559 transaction itself with the next nonce, `chain_id` fixed at init, and empty calldata, hashes it, and asks the MPC contract to sign. There is no parameter for calldata, so the contract can only ever sign "send ETH to an address". The parameters are restricted: `gas_limit` from 21000 to 300000 (the caller estimates it per recipient, see "Residual limits" in section 14), `max_fee_per_gas` at least 1 gwei, `max_priority_fee_per_gas` above 0 and not above `max_fee_per_gas`, `to` not the zero address, `value_wei` above 0. The deposit must be at least the sign fee plus 1 yocto (0.01 NEAR + 1 yocto); the contract keeps the 0.01 NEAR sign fee and forwards the rest to the MPC contract. Nothing is refunded.
3. **Log.** On success, `on_signed` rebuilds the transaction from its own reserved copy, checks the returned signature, appends the signed transaction to a public log (`get_sig_log`) and increments the nonce. Anyone can broadcast anything in the log. `on_signed` reads the raw MPC response itself, so a response of an unexpected shape is recorded as a failed attempt and never aborts the callback. The first accepted signature pins the wallet's Ethereum address (`eth_address` in `get_wallet`); a later signature that recovers to a different address is treated as a failed attempt.
4. **List.** `list(token_id, price)` freezes signing. Nothing new can be signed until `delist` or a sale.
5. **Clean check (off-chain, anyone can run it).** Read `next_nonce`, the signature log and the wallet flags from the contract, and the address's confirmed nonce from Sepolia. If the Sepolia nonce equals `next_nonce`, every signature ever issued has been used, so none can be broadcast later. The check also recovers the signer of every logged transaction and compares it with the address derived from the MPC public key; the contract's pinned `eth_address`, when set, must match that derived address too. Any mismatch is `inconsistent`.
6. **Buy.** `buy(token_id, expected_next_nonce)` with exactly the price attached moves the NFT to the buyer, pays the seller exactly the price, and clears the listing, in one call. Less or more than the price is rejected, so there is no refund path. The call is bound to the state the buyer checked: `expected_next_nonce` is the `next_nonce` the buyer's clean check saw, and the call fails with "Wallet changed since you checked it" if the wallet signed anything since. A seller who delists, signs and relists is therefore caught. The old owner is refused from then on.

**Invariant:** *Once a Handover wallet shows clean, no one but the next owner can ever move its funds.*

### Verdicts

| Verdict | Meaning |
|---|---|
| `clean` | Log is complete, nothing in flight or reserved, Sepolia nonce equals `next_nonce`. Safe to buy. |
| `dirty` | Some logged signed transactions are not mined yet. The UI lists them; they are the seller's own transfers and anyone can broadcast them, after which the verdict becomes `clean`. |
| `busy` | A signing request is in flight, a signing attempt did not complete and a transaction is reserved (below), or an `nft_transfer_call` is unresolved (the owner may still change). A signature may still appear. |
| `inconsistent` | The data contradicts itself (a gap or duplicate in the log, a Sepolia nonce ahead of the contract, a logged transaction that does not match its raw bytes, a logged transaction signed by a key other than the wallet's, a recorded `eth_address` that differs from the derived one). Treat as unsafe. |

### What if a signature leaked from a failed MPC call?

The MPC network publishes a signature on chain when it responds, even if Handover's callback fails or the call times out. A failed attempt therefore does not prove that no signature exists, and "clean" could be wrong. The contract closes this with the **reserved-transaction rule**:

- `request_transfer` stores the exact transaction (nonce, recipient, amount, fees, payload hash) as *reserved* and marks the token in flight **before** calling MPC.
- If the callback sees a failure or timeout, the nonce is **not** consumed and the reservation **stays**. While it stays, a new `request_transfer` is rejected whatever its arguments, and `list`, `buy`, `nft_transfer` and `nft_transfer_call` are rejected too. The owner must call `retry_reserved`, which asks for a signature on the identical transaction.
- If the callback never runs at all (for example it runs out of gas), `in_flight` stays set. After 300 blocks the owner can call `release_stuck` (exactly 1 yocto, only while in flight). It clears `in_flight` and keeps the reservation, which is the state of a failed attempt, so no signature can be forgotten. The MPC contract's own yield timeout is 200 blocks, so the 300-block wait lets a late MPC response arrive first. `retry_reserved` follows.
- Any signature that leaked therefore authorises the very transaction the contract already knows about. Whichever copy is broadcast, the effect is the same and only one can be mined.
- The clean check reports a reserved transaction as `busy`, so no buyer is told "clean" while one exists.

### Transfer calls

`nft_transfer_call` makes the receiver the owner while the token may still be returned. The contract sets `transfer_call_pending` on the wallet for that window. While it is set, `request_transfer`, `retry_reserved`, `list`, `buy`, `nft_transfer` and `nft_transfer_call` are rejected, and the clean check reports `busy`. The overridden `nft_resolve_transfer` clears the flag on every path (kept, returned, or receiver call failed).

## 5. NEAR features used

| Feature | Where | What breaks without it |
|---|---|---|
| **Chain Signatures** (MPC signer `v1.signer-prod.testnet`, `sign` with `payload_v2` and `domain_id` 0) | [`mpc.rs`](contracts/handover/src/mpc.rs), [`wallet.rs`](contracts/handover/src/wallet.rs) (`sign_promise`) | A contract cannot control an Ethereum address. The wallet would need a private key, which brings back the exact problem Handover solves. |
| **NEP-171 / 177 / 178 / 181** via `near-contract-standards` 5.30.0 | [`lib.rs`](contracts/handover/src/lib.rs) | The wallet would not be a transferable token that wallets, explorers and marketplaces understand. |
| **Cross-contract call and callback** (`.then`, `#[private]`, raw promise result read in the callback) | [`wallet.rs`](contracts/handover/src/wallet.rs) (`request_transfer`, `on_signed`, `read_signature_result`) | Signing is asynchronous. Without the callback the contract cannot log the signature, or release the reservation. |
| **1-yocto confirmation** (`assert_one_yocto`) | [`market.rs`](contracts/handover/src/market.rs) (`list`, `delist`), [`wallet.rs`](contracts/handover/src/wallet.rs) (`release_stuck`) | A function-call access key could list or delist; the deposit forces a full-access key. |
| **Attached deposits and promise transfers** | [`market.rs`](contracts/handover/src/market.rs) (`buy`), [`wallet.rs`](contracts/handover/src/wallet.rs) | Payment and NFT transfer could not happen in one atomic call. |
| **Locked contract** (full-access keys deleted after the final deploy) | [`README` section 14](#14-setup-env-deploy-security-roadmap), proof in [`evidence/access-keys.txt`](evidence/access-keys.txt) (key deleted in tx `4NMiwSBFLKPrZkqzuDbnGmfNey1Whew1vRYQKzEEDsqW`) | The contract owner could upgrade the code and take every wallet. The contract has no admin or upgrade method, so deleting its keys makes the code final. |
| **NEP-297 events** | [`events.rs`](contracts/handover/src/events.rs) | Indexers would have no record of signatures, listings and sales. |
| **Environment host functions** (`env::keccak256`, `env::ecrecover`) | [`tx.rs`](contracts/handover/src/tx.rs) | The contract could not hash transactions or validate returned signatures on chain. |

## 6. Claims table

Full table with one row per security requirement: [`docs/CLAIMS.md`](docs/CLAIMS.md). Rust tests are in [`contracts/handover/src/tests.rs`](contracts/handover/src/tests.rs); TypeScript tests in [`packages/cleancheck/test/`](packages/cleancheck/test/). Live proof from the evidence run is in [`evidence/`](evidence/README.md); anything still waiting for a live run says "pending".

| Claim | Code | Proof |
|---|---|---|
| Only the current owner can request signatures; the old owner is refused after a sale or transfer | [`require_owner` lib.rs:231](contracts/handover/src/lib.rs#L231), [`request_transfer` wallet.rs:49](contracts/handover/src/wallet.rs#L49) | `request_transfer_rejects_non_owner`, `old_owner_refused_after_buy`, `old_owner_cannot_request_after_nft_transfer` |
| Listing freezes signing; no listing while a request is in flight | [`assert_can_sign` wallet.rs:220](contracts/handover/src/wallet.rs#L220), [`list` market.rs:19](contracts/handover/src/market.rs#L19) | `request_transfer_rejected_while_listed`, `list_rejected_while_in_flight`, `no_second_request_while_in_flight` |
| Nonces are strictly sequential; a failed MPC call never consumes one | [`finish_signing` wallet.rs:269](contracts/handover/src/wallet.rs#L269), [`mark_failed` wallet.rs:323](contracts/handover/src/wallet.rs#L323) | `nonces_are_strictly_sequential_and_log_is_ordered`, `failed_mpc_call_keeps_reservation_and_does_not_consume_nonce` |
| Only plain ETH transfers can be built and signed (no calldata, so no approvals) | [`build_plain_transfer` tx.rs:85](contracts/handover/src/tx.rs#L85), [`is_plain_transfer` tx.rs:102](contracts/handover/src/tx.rs#L102) | `only_plain_transfers_can_be_built`, `transfer_parameter_validation` |
| Reserved transaction keeps a failed attempt accounted for; `retry_reserved` re-signs the identical payload | [`retry_reserved` wallet.rs:115](contracts/handover/src/wallet.rs#L115), [`ReservedTx` types.rs:19](contracts/handover/src/types.rs#L19) | `new_request_rejected_while_reserved_even_with_different_args`, `retry_reserved_resigns_identical_payload_then_nonce_advances`, `list_rejected_while_reserved` |
| `on_signed` never panics on a bad MPC response | [`on_signed` wallet.rs:181](contracts/handover/src/wallet.rs#L181) | `on_signed_never_panics_on_bad_responses_and_keeps_reservation` |
| Signed transactions are canonical RLP even when `r` or `s` has a leading zero byte | [`assemble` tx.rs:159](contracts/handover/src/tx.rs#L159) | `canonical_rlp_when_r_has_leading_zero_byte`, `canonical_rlp_when_s_has_leading_zero_byte` |
| The transaction hash matches an independent implementation (viem) | [`signing_hash` tx.rs:107](contracts/handover/src/tx.rs#L107) | `matches_independent_viem_vector`, `pnpm --filter checks check:4` |
| `buy` is atomic: NFT moves, seller paid exactly the price, exact deposit required | [`buy` market.rs:59](contracts/handover/src/market.rs#L59) | `buy_moves_nft_pays_seller_exactly_and_creates_no_other_receipt`, `buy_rejects_underpayment`, `buy_rejects_overpayment` |
| `list` and `delist` need exactly 1 yocto | [market.rs:20](contracts/handover/src/market.rs#L20), [market.rs:45](contracts/handover/src/market.rs#L45) | `list_requires_exactly_one_yocto_not_zero`, `delist_requires_one_yocto` |
| No admin, upgrade or key-management code in the contract | all of `contracts/handover/src` | `production_sources_have_no_upgrade_or_key_management` |
| Clean check: clean, dirty, busy and inconsistent verdicts | [`cleanCheck` check.ts:25](packages/cleancheck/src/check.ts#L25) | `check.test.ts` (happy paths, dirty, busy, inconsistent), `reserved.test.ts` |
| Offline snapshot verification checks every logged transaction against its raw bytes and its signer | [`verifySnapshot` snapshot.ts:83](packages/cleancheck/src/snapshot.ts#L83) | `snapshot.test.ts` (`verifySnapshot`, committed fixtures) |
| Ethereum address derived from the MPC public key | [`ethAddressFromMpcKey` address.ts:41](packages/cleancheck/src/address.ts#L41) | `address.test.ts`; live: check 3 agreed four ways, including the address recovered from a real MPC signature ([`checks.log`](evidence/checks.log)) |
| The committed wasm matches its recorded hash | [`contracts/res/handover.wasm.sha256`](contracts/res/handover.wasm.sha256) | `make verify` step 4 |
| MPC returns the signature shape the contract expects; full sale works on testnet and Sepolia | [`mpc.rs`](contracts/handover/src/mpc.rs) | check 2 ([`sig-BmLN….json`](evidence/sig-BmLNbqK1tLowB6kpAg5cakJuhUkt3QP7nyMkVAHG85BY.json)), check 5 ([`e2e-*.json`](evidence/)), [`snapshots/token-1-*.json`](evidence/snapshots/), demo run [`demo-run-2026-11-05.md`](evidence/demo-run-2026-11-05.md) |
| The deployed code is the committed wasm | [`handover.wasm.sha256`](contracts/res/handover.wasm.sha256) | on-chain code hash `5AAyWq6VDRFvMj7fZH8PipvY5F4MW3nS89qSzMw6rrkz` is the base58 form of the committed SHA-256 |
| Contract account has no access keys | n/a | [`evidence/access-keys.txt`](evidence/access-keys.txt): `view_access_key_list` returns `"keys":[]`; the last key was deleted in tx `4NMiwSBFLKPrZkqzuDbnGmfNey1Whew1vRYQKzEEDsqW` |

Security-hardening pass (fixes F0 to F8, see section 14 "Independent review"):

| Fix | Claim | Code | Proof |
|---|---|---|---|
| F0 | `new` is `#[private]`: only the contract account can initialise it, so deploy and init in one transaction cannot be front-run | [`new` lib.rs:117](contracts/handover/src/lib.rs#L117) | `new_rejects_non_contract_predecessor` (explicit check; the macro itself is enforced only in wasm) |
| F1 | `buy` needs `expected_next_nonce` equal to `next_nonce` and exactly the price | [`buy` market.rs:59](contracts/handover/src/market.rs#L59) | `buy_rejects_wrong_expected_nonce`, `buy_rejected_when_wallet_changed_after_check`, `buy_after_delist_sign_relist_succeeds_with_fresh_nonce` |
| F2 | `on_signed` parses the raw promise result by hand; a changed MPC response shape is a recorded failure, not a panic | [`read_signature_result` wallet.rs:199](contracts/handover/src/wallet.rs#L199) | `on_signed_records_failure_for_unexpected_promise_results` |
| F3 | Bounded per-token state is prepaid at mint (measured storage + 1500 bytes, 0.015 NEAR) | [`nft_mint` lib.rs:158](contracts/handover/src/lib.rs#L158), [`TOKEN_STORAGE_BUFFER_BYTES` lib.rs:72](contracts/handover/src/lib.rs#L72) | `mint_keeps_measured_cost_plus_token_buffer`, `listing_reservation_and_transfer_to_fresh_account_fit_in_buffer` |
| F4 | `release_stuck`: owner, 1 yocto, in flight, more than 300 blocks after the latest `sign` call; keeps the reservation | [`release_stuck` wallet.rs:151](contracts/handover/src/wallet.rs#L151), [`RELEASE_AFTER_BLOCKS` lib.rs:75](contracts/handover/src/lib.rs#L75) | `release_stuck_only_after_timeout_and_keeps_reservation`, `release_stuck_rejected_before_timeout`, `release_stuck_owner_only`, `release_stuck_rejected_when_not_in_flight`, `release_stuck_requires_one_yocto` |
| F5 | `nft_transfer_call` freezes the wallet until `nft_resolve_transfer` clears the flag; clean check reports `busy` | [`nft_transfer_call` lib.rs:301](contracts/handover/src/lib.rs#L301), [`nft_resolve_transfer` lib.rs:329](contracts/handover/src/lib.rs#L329), [check.ts:97](packages/cleancheck/src/check.ts#L97) | `transfer_call_receiver_cannot_sign_during_call`, `pending_call_blocks_buy`, `resolver_clears_pending_flag_when_receiver_keeps_token`; `check.test.ts` "transfer_call_pending is busy" |
| F6 | `gas_limit` from 21000 to 300000, `max_fee_per_gas` at least 1 gwei, priority fee above 0 and not above max fee, `to` not zero, `value_wei` above 0 | [`validate_transfer` tx.rs:49](contracts/handover/src/tx.rs#L49) | `contract_rejects_gas_limit_below_21000`, `contract_rejects_gas_limit_above_cap`, `smart_account_gas_limit_is_signed_as_requested`, `contract_rejects_dust_max_fee`, `contract_rejects_zero_address`, `contract_rejects_zero_value` |
| F7 | Sign deposit at least `sign_fee` + 1 yocto; the contract keeps `sign_fee` and forwards the rest to MPC; no refund | [`mpc_deposit` wallet.rs:234](contracts/handover/src/wallet.rs#L234) | `request_transfer_rejects_deposit_equal_to_sign_fee`, `minimum_deposit_forwards_one_yocto_and_nothing_is_refunded` |
| F8 | First signature pins `eth_address`; a signature from another key is a failed attempt; the clean check recovers every logged signer and compares with the derived address | [`finish_signing` wallet.rs:269](contracts/handover/src/wallet.rs#L269), [`signerRecoveryProblems` signers.ts:8](packages/cleancheck/src/signers.ts#L8), [check.ts:75](packages/cleancheck/src/check.ts#L75) | `first_signature_pins_eth_address_and_exposes_it`, `signature_from_a_different_key_is_a_failed_attempt`, `signer.test.ts`, fixture `inconsistent-wrong-signer.json` |

## 7. What is mocked or not built

- **Deployed and locked on testnet.** The contract runs at `handover.handover-alpha.testnet` and the evidence run is committed in [`evidence/`](evidence/README.md). Its full-access key was deleted after the demo recording ([`evidence/access-keys.txt`](evidence/access-keys.txt)), so nobody can change the code or withdraw its NEAR balance.
- **Contract unit tests use a stand-in for MPC.** They feed the callback a signature made with a throwaway test key. They prove the contract's logic and encoding. That the real MPC contract answers in this shape is proven separately by capability check 2 and by the live evidence run.
- **Synthetic fixtures.** The snapshots in `packages/cleancheck/test/fixtures/` are hand-made and labelled `SYNTHETIC` in their `note` and in the CLI output. They are not chain data.
- **ETH only in v1; tokens in v2.** v1 signs only plain ETH transfers, so tokens or NFTs sent to a v1 wallet can never be moved by anyone. v2 (`handover-v2-alpha.testnet`) adds ERC-20, ERC-721 and ERC-1155 transfers; its run is in [`evidence/v2-run-2026-11-05.md`](evidence/v2-run-2026-11-05.md). v2 is **not locked yet** (its full-access key still exists), and its test tokens are worthless contracts anyone can mint. The token list on the wallet page comes from Blockscout's public index, which can lag the chain by a few blocks.
- **Testnets only.** NEAR testnet and Ethereum Sepolia (`chain_id` 11155111). No mainnet, no real funds.
- **Dynamic NFT metadata** is not built; token metadata is static.
- **Check 3 and chainsig.js.** `checks/03-address-agreement.ts` cross-checks the address four ways: the MPC `derived_public_key` view, a pure noble derivation with the pinned testnet root key, the `chainsig.js` library, and the address recovered from a real signature. The `chainsig.js` route is reported as SKIPPED when the library does not load (it failed under Node 22 ESM in one install because of an `@noble/curves` version clash; with the committed lockfile it loaded and agreed in `--offline` mode). When skipped, the other routes still decide the verdict.
- **`#[private]` on `on_signed` and `new`** is enforced by the NEAR SDK macro only in the compiled wasm, not in unit tests. The unit tests cover an explicit predecessor check in each function body; the macro itself is exercised only on testnet.
- **Gas numbers.** Unit tests count host-function gas only. MPC latency and gas were measured once on testnet with the check-2 probe (section 11); per-call gas of the Handover contract itself is not broken down yet.
- **Open contract risks:** the contract does not know a token's derived key in advance, so the first accepted signature pins the address and it relies on the MPC contract, whose `respond` verifies signatures, for that first one; a reserved transaction blocks transfers and sales until `retry_reserved` succeeds, so an MPC outage can lock a token. The remaining limits are listed in section 14 ("Security model and limits") and in [`contracts/handover/README.md`](contracts/handover/README.md).
- **The web UI** is a static SvelteKit app that reads the chain directly (no backend), hosted at https://handover-blush.vercel.app against the live contract. The 2026-11-04 evidence run was driven from the CLI; the recorded demo on 2026-11-05 ran the browser flow, and its transactions are in [`evidence/demo-run-2026-11-05.md`](evidence/demo-run-2026-11-05.md).

## 8. Verify everything offline (`make verify`)

For the 30-second check with no install, see the top of this README. This section is the full offline suite.

Prerequisites: Rust (stable; the `wasm32` target is **not** needed for tests), Node 22, pnpm 10, GNU make. No keys, no network access to NEAR or Ethereum, no wallet. On Windows (x86_64), `near-sdk`'s test dependency `aws-lc-sys` needs NASM: either install it or set `AWS_LC_SYS_PREBUILT_NASM=1` so it uses its prebuilt objects.

```bash
git clone <this repository> && cd handover
make verify
```

`make verify` installs Node dependencies first if `node_modules` is missing, then runs: (1) the contract unit tests, (2) the clean-check library tests, (3) the clean-check CLI over every `evidence/snapshots/*.json` (the 6 real snapshots from the evidence run and the demo run) and the 6 synthetic fixtures, (4) `sha256sum -c` on the committed wasm. It exits non-zero if any step fails.

Output of the same four steps on the current tree (run in Git Bash on Windows; the real-snapshot and fixture reports are shortened to their verdict lines here, two fixtures are shown in full, and the absolute path is replaced by `/path/to/handover`):

```text
[1/4] Contract unit tests (cargo test)
test result: ok. 99 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 23.80s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

[2/4] Clean-check library tests (vitest)
 Test Files  8 passed (8)
      Tests  136 passed (136)

[3/4] Clean-check verdicts over committed snapshots
Real snapshots (evidence/snapshots):
(token-1-1-funded.json: CLEAN, expected clean, OK)
(token-1-2-before-list.json: CLEAN, expected clean, OK)
(token-1-3-listed.json: CLEAN, expected clean, OK)
(token-1-4-sold.json: CLEAN, expected clean, OK)
(token-1-5-buyer-spent.json: CLEAN, expected clean, OK)
(token-2-demo-final.json: CLEAN, expected clean, OK)

Synthetic fixtures (packages/cleancheck/test/fixtures, NOT chain data):
(busy-in-flight.json: BUSY, expected busy, OK)
(clean-3-issued.json: CLEAN, expected clean, OK)

== /path/to/handover/packages/cleancheck/test/fixtures/dirty-pending.json ==
*** SYNTHETIC FIXTURE: hand-made for tests, NOT chain data ***
    Hand-made for tests (generated by test/fixtures/generate.ts). NOT chain data.

  Token                           0
  Contract                        synthetic.handover.test
  Address                         0x7e5f4552091a69125d5dfcb7b8c2659029395bdf
  Balance                         1 ETH (1000000000000000000 wei)
  Captured                        1970-01-01T00:00:00.000Z
  Signature log entries           3

  Contract next_nonce (issued)    3
  Sepolia nonce (latest)          1
  Sepolia nonce (pending)         2

  Pending signed transactions (2):
    nonce  to                                          value (wei)           mempool  tx hash
    1      0x2222222222222222222222222222222222222222  2000000000000000      yes      0xab1f1080cb31f3617c73f8fb6566b42fae3cd6743cf6a28456ba3d2478420ce2
    2      0x2222222222222222222222222222222222222222  3000000000000000      no       0xa66073376c3d9c6ecee6f90bf72ecee44cfd55ad0c37552f753da0475048df24

  VERDICT: DIRTY
    - Contract issued 3 signatures (nonces 0-2); Sepolia confirmed nonce is 1.
    - 2 signed transactions (nonces 1, 2) are not mined yet.
    - One of them is already in the Sepolia mempool (nonce 1; pending nonce 2).
  expected: dirty  OK

(inconsistent-hash-mismatch.json: INCONSISTENT, expected inconsistent, OK)
(inconsistent-missing-nonce.json: INCONSISTENT, expected inconsistent, OK)

== /path/to/handover/packages/cleancheck/test/fixtures/inconsistent-wrong-signer.json ==
*** SYNTHETIC FIXTURE: hand-made for tests, NOT chain data ***
    Hand-made for tests (generated by test/fixtures/generate.ts). NOT chain data.

  Token                           0
  Contract                        synthetic.handover.test
  Address                         0x7e5f4552091a69125d5dfcb7b8c2659029395bdf
  Balance                         1 ETH (1000000000000000000 wei)
  Captured                        1970-01-01T00:00:00.000Z
  Signature log entries           3

  Contract next_nonce (issued)    3
  Sepolia nonce (latest)          3
  Sepolia nonce (pending)         not checked

  VERDICT: INCONSISTENT
    - Signed transaction at nonce 1 was not signed by this wallet's key.
    - Contract issued 3 signatures (nonces 0-2); Sepolia confirmed nonce is 3. Every signature has been used.
  expected: inconsistent  OK

[4/4] Committed wasm matches its sha256
handover.wasm: OK

VERIFY OK in 53s: contract tests pass, clean-check tests pass, 6 synthetic fixtures and 6 real snapshot(s) give the expected verdicts, wasm hash matches.
```

The abbreviated lines are shortened here; the command prints the full report for each. Wall time was 53 s on Windows.

- **Hosted demo:** https://handover-blush.vercel.app
- **Contract account (NEAR testnet):** [`handover.handover-alpha.testnet`](https://testnet.nearblocks.io/address/handover.handover-alpha.testnet)

Other useful targets: `make test` (contract, clean-check and web tests), `make web` (production build of the web app), `make checks-offline` (capability checks 3 and 4, no network), `make help`.

## 9. Do X, see Y (hosted demo)

Open https://handover-blush.vercel.app. You need two NEAR testnet accounts (a seller and a buyer) in a browser wallet that supports testnet (for example Meteor) and some Sepolia ETH. Pages: `/` (overview), `/mint/`, `/wallets/` (your wallets), `/wallet/?id=N` (one wallet), `/market/` (listings), `/how/` (explanation).

1. **Mint.** Connect the seller account, open `/mint/`, mint. *See:* a new token and its derived Ethereum address (`0x...`).
2. **Fund.** Copy the address and send Sepolia ETH to it from a faucet. *See:* the wallet page shows the balance after the next refresh.
3. **Spend.** On `/wallet/?id=N` send `0.0001` ETH to any address (the call attaches the 0.01 NEAR sign fee plus 1 yocto and 300 Tgas; the contract keeps the fee and forwards the 1 yocto to MPC). The form estimates the gas limit for the recipient: 21,000 for an existing address, more for a new or smart account. *See:* an Etherscan (Sepolia) link for the broadcast transaction, and a signature-log entry with nonce `0`.
4. **List.** Set a price and list. *See:* the wallet shows "Listed, signing frozen" (the contract refuses every signature request while listed); the verdict is `clean` once the Sepolia nonce equals the number of logged signatures. The same wallet appears on `/market/` with its verdict.
5. **Buy.** Switch to the buyer account, open the listing, run the clean check, buy. The buy button is enabled only after a recent `clean` verdict, and the purchase attaches exactly the price and the `next_nonce` the check saw (`expected_next_nonce`). *See:* the NFT moves to the buyer and the price lands with the seller.
6. **Buyer spends.** The buyer sends a small transfer from the wallet. *See:* it works, with the next nonce in the log.
7. **Old owner refused.** Switch back to the seller and try to send. *See:* the transaction fails with the contract's message `Only the token owner can do this` ([`lib.rs:237`](contracts/handover/src/lib.rs#L237)). Before the sale, trying to send while listed fails with `Token is listed: delist to sign` ([`wallet.rs:221`](contracts/handover/src/wallet.rs#L221)).

The same states can be checked from a terminal with `make status TOKEN=1` once `.env` points at the contract (`HANDOVER_CONTRACT=handover.handover-alpha.testnet`). Token 1 is the one from the evidence run: it was sold to `handover-alpha-buyer.testnet`.

## 10. Architecture

```text
 browser (web/)                      CLI (packages/cleancheck/bin)
   SvelteKit static app                handover status | verify | snapshot
   web/src/lib/chain/*                         |
        |                                      |
        +------------- @handover/cleancheck ---+   pure cleanCheck() + RPC readers + snapshot verifier
                              |                       packages/cleancheck/src
              +---------------+----------------+
              |                                |
    NEAR testnet RPC                     Sepolia RPC
    get_wallet, get_sig_log              eth_getTransactionCount,
    derived_public_key (MPC view)        eth_getBalance, broadcast
              |
   Handover contract  contracts/handover/src
     lib.rs     NEP-171/177/178/181, nft_mint, owner/transfer guards, transfer-call lock
     wallet.rs  request_transfer, retry_reserved, release_stuck, on_signed (reserved tx, nonces, sig log)
     market.rs  list, delist, buy
     tx.rs      builds the plain EIP-1559 transfer, hash, signature assembly
     mpc.rs     MPC request/response types, gas and deposit constants
     views.rs   get_config, get_wallet, get_sig_log, get_listing, list_listings
     events.rs  NEP-297 events          types.rs   storage and view types
              |  sign({path, payload_v2, domain_id})
   MPC signer  v1.signer-prod.testnet  (NEAR Chain Signatures)
```

| Path | Contents |
|---|---|
| `contracts/handover/` | Rust contract and 99 unit tests (`src/tests.rs`) |
| `contracts/res/` | built `handover.wasm`, `handover.wasm.sha256`, ABI, build record `BUILD.md` |
| `packages/cleancheck/` | TypeScript library `@handover/cleancheck`, CLI `bin/handover.ts`, tests and fixtures |
| `web/` | SvelteKit app (Svelte 5, static adapter); chain layer in `web/src/lib/chain/` |
| `checks/` | six capability-check scripts, the MPC sign probe contract in `checks/02-mpc-sign/` |
| `evidence/` | proof from the evidence run on NEAR testnet and Sepolia (see its README) |
| `docs/` | `PRD.md`, `HACKATHON.md`, `CLAIMS.md` |

There is no backend. If a relay were ever added it would hold no keys.

## 11. Measured results

Measured from the code in this repository today:

| Item | Value | How to reproduce |
|---|---|---|
| Contract unit tests | 99 pass | `cargo test --manifest-path contracts/handover/Cargo.toml` |
| Clean-check tests | 136 pass (8 files) | `pnpm --filter @handover/cleancheck test` |
| Web chain-layer tests | 37 pass (4 files) | `pnpm --filter web test` |
| `handover.wasm` size | 317592 bytes (310.1 KiB); NEAR transaction limit used for the deploy check is 1.5 MiB | `wc -c contracts/res/handover.wasm`, `make checks-offline` |
| `handover.wasm` SHA-256 | `3dc840c8821ce9124e18453b0d2d3159bbd45cf23c18c6785f4079ec8de69513` (base58 `5AAyWq6VDRFvMj7fZH8PipvY5F4MW3nS89qSzMw6rrkz`, the deployed code hash) | `make verify` step 4 |
| MPC sign round trip from a contract (check 2 probe) | 5.4 s latency, 12.9 Tgas burnt in total, 1 yocto forwarded to MPC | [`evidence/sig-BmLN….json`](evidence/sig-BmLNbqK1tLowB6kpAg5cakJuhUkt3QP7nyMkVAHG85BY.json) |
| `request_transfer` on the Handover contract, including MPC and `on_signed` | 14.4 Tgas burnt (8 receipts), measured twice | NEAR tx `9JQoqVcLb8DUYz7dRT8XjayKW4ToJ5kT5rCzmyudGyRM`, `4sLL8yXJnwKvu8o3451ELXnfaxzNBnYEnQG1Lzkt9GSi` |
| `buy` | 5.0 Tgas burnt (4 receipts); seller received exactly the 1 NEAR price | NEAR tx `DLsK85AMxt9dhHv4GfhVbpEt7qF7agUCRnKffQcrAMQ2` |
| Sepolia gas per signed transfer | 21,000 to an existing address; 24,393 (estimate) to an EIP-7702 smart account; 204,600 used to create a fresh address (21,000 + 183,600 under Glamsterdam) | `eth_estimateGas`, receipt of `0x7995249408ad663f87a161eaca1900ee3af41d454de39b874594e0b03d77ec46` |
| Fixed constants | sign fee 0.01 NEAR (deposit must exceed it by at least 1 yocto), mint fee 0.05 NEAR (of which a 0.015 NEAR per-token storage buffer is kept), `release_stuck` after 300 blocks, `gas_limit` 21000 to 300000, `sign` 50 Tgas static, `on_signed` 30 Tgas static, minimum prepaid 100 Tgas (300 recommended) | [`lib.rs`](contracts/handover/src/lib.rs), [`mpc.rs`](contracts/handover/src/mpc.rs), [`tx.rs`](contracts/handover/src/tx.rs) |

**Not measured yet:** storage cost per logged signature on testnet. Build details for the wasm: [`contracts/res/BUILD.md`](contracts/res/BUILD.md).

## 12. Built during the hackathon vs pre-existing

All project code in this repository was written during the hackathon window (first commit 2026-11-03). Nothing is carried over from an earlier project. The code was written with AI coding assistance (Claude Code) under the builder's direction. Libraries and tools used, with the versions pinned in `Cargo.lock` / `pnpm-lock.yaml`:

| Area | Library | Version |
|---|---|---|
| Contract | `near-sdk` (feature `unstable` for `env::ecrecover`) | 5.30.0 |
| Contract | `near-contract-standards` | 5.30.0 |
| Contract | `omni-transaction` (feature `evm` only) | 0.5.0 |
| Contract | `hex` | 0.4.3 |
| Contract tests only | `k256`, `rlp` | 0.13.4, 0.6.1 |
| Build | `rustc`, `cargo-near` | 1.96.0, 0.22.0 (deployed wasm; see `contracts/res/BUILD.md`) |
| Clean check | `@noble/hashes`, `@noble/curves` (signer recovery) | 2.4.0, 2.4.0 |
| Clean check, checks, web | `typescript`, `tsx`, `vitest` | 6.0.3, 4.23.15, 5.1.0 |
| Checks | `chainsig.js`, `viem`, `@noble/curves`, `@scure/base` | 1.1.16, 2.57.16, 2.4.0, 2.4.0 |
| Web | `svelte`, `@sveltejs/kit`, `@sveltejs/adapter-static`, `vite` | 5.57.3, 3.1.1, 4.0.1, 8.3.5 |
| Web | `@hot-labs/near-connect`, `near-api-js`, `viem` | 0.12.0, 7.4.0, 2.57.16 |
| Web | `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` | 5.3.0 |

The MPC signer contract (`v1.signer-prod.testnet`) and NFT Chain Keys are third-party and are not copied into this repository.

## 13. Other project by the same builder

The same builder also submits **Co-op**, a separate project with its own repository and contract (rule Q-015):

- Repository: https://github.com/AlphaTechini/co-op
- Hosted app: https://coop.cyberpunkinc.xyz
- Contract (NEAR testnet): `coop-alpha.testnet`

## 14. Setup, env, deploy, security, roadmap

### Setup

```bash
make install            # pnpm install --frozen-lockfile
cp .env.example .env    # for the CLI and capability checks (git-ignored)
cp web/.env.example web/.env   # for the web app (public values only)
make test               # all unit tests
make web                # static build in web/build
make dev                # web dev server
```

The CLI (`handover status <token_id>`, `handover verify <snapshot.json...>`, `handover snapshot <token_id> <out.json>`) is `packages/cleancheck/bin/handover.ts`; run it as `pnpm --filter @handover/cleancheck cli <command>` or through `make status` / `make snapshot`. When `NEAR_RPC` is unset it defaults to `https://test.rpc.fastnear.com`, the same endpoint as `.env.example` and the web app.

To rebuild the wasm: install `cargo-near` 0.22.0 (prebuilt release binaries work where `cargo install` fails for lack of libudev) and run `make build-contract`, which runs `cargo near build non-reproducible-wasm --locked --out-dir ../res` and rewrites the sha256 file. Update the size and hash in [`contracts/res/BUILD.md`](contracts/res/BUILD.md) by hand. The build is not reproducible across machines.

### Environment variables

Root `.env` (read by `make status`, `make snapshot` and the scripts in `checks/`; see [`.env.example`](.env.example)):

| Variable | Meaning | Default |
|---|---|---|
| `NEAR_ACCOUNT_ID` | your testnet account | empty |
| `NEAR_PRIVATE_KEY` | not read by the checks; leave blank (near-cli-rs keeps keys in its keychain) | empty |
| `NEAR_RPC` | NEAR testnet RPC | `https://test.rpc.fastnear.com` |
| `MPC_CONTRACT` | MPC signer | `v1.signer-prod.testnet` |
| `PROBE_CONTRACT` | account of the check-2 probe contract | empty |
| `HANDOVER_CONTRACT` | the deployed Handover account (required by `make status` and `make snapshot`) | empty |
| `SEPOLIA_RPC` | Sepolia RPC | `https://ethereum-sepolia-rpc.publicnode.com` |
| `SEPOLIA_FUNDED_ADDRESS` | address funded from a faucet (check 1, check 6) | empty |
| `TOKEN_ID` | token for check 5 | `0` |

`web/.env` (all values are public and inlined into the build): `PUBLIC_HANDOVER_CONTRACT` (required), `PUBLIC_NEAR_RPC`, `PUBLIC_SEPOLIA_RPC`, `PUBLIC_MPC_CONTRACT`; defaults match the table above. The web app must be rebuilt after changing them.

### Deploy runbook (NEAR testnet)

The commands below use near-cli-rs 0.30.1 syntax and were used for the deployment at `handover.handover-alpha.testnet`. In Windows PowerShell 5.1, escape the double quotes inside `json-args` as `\"`. `CONTRACT` is the account to deploy to, for example `handover.<your-account>.testnet`.

```bash
# 1. Capability checks first (checks/README.md). Check 2 needs its probe contract; checks 1 and 6 need faucets.

# 2. Create the contract account and fund it (pays storage for the code, about 3.2 NEAR, and the
#    signature log). 5 NEAR is enough; a faucet account starts with 10 NEAR, so 10 would not leave gas.
near account create-account fund-myself $CONTRACT '5 NEAR' autogenerate-new-keypair save-to-legacy-keychain \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send

# 3. Deploy AND initialise in one transaction. `new` is #[private]: only the contract account itself
#    can call it, so it must run as part of the deploy transaction, which the contract account
#    itself signs. Nobody else can initialise the contract first, so init cannot be front-run.
near contract deploy $CONTRACT use-file contracts/res/handover.wasm \
  with-init-call new json-args '{"mpc_contract_id":"v1.signer-prod.testnet","chain_id":11155111}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

# 4. Call methods (gas and deposit as the contract requires).
near contract call-function as-transaction $CONTRACT nft_mint json-args '{}' \
  prepaid-gas '100 Tgas' attached-deposit '0.05 NEAR' \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send

near contract call-function as-transaction $CONTRACT request_transfer \
  json-args '{"token_id":"0","to":"0x000000000000000000000000000000000000dEaD","value_wei":"100000000000000","gas_limit":"21000","max_fee_per_gas":"30000000000","max_priority_fee_per_gas":"1000000000"}' \
  prepaid-gas '300 Tgas' attached-deposit '10000000000000000000001 yoctoNEAR' \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send
# The deposit is the 0.01 NEAR sign fee plus 1 yocto. The contract keeps the fee and forwards the
# 1 yocto to MPC. Nothing is refunded, so do not attach more.
# gas_limit 21000 fits 0x...dEaD because that account already exists. For any other recipient use
# eth_estimateGas (from the wallet's address) plus headroom: a fresh address needs about 207k and
# an EIP-7702 smart account about 24k since Glamsterdam. The contract accepts 21000 to 300000.

near contract call-function as-transaction $CONTRACT list \
  json-args '{"token_id":"0","price":"1000000000000000000000000"}' \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send

# expected_next_nonce is the next_nonce the buyer's clean check saw (get_wallet); it is 1 here, after
# the one transfer above. The deposit must equal the listed price exactly (1 NEAR); less or more is rejected.
near contract call-function as-transaction $CONTRACT buy json-args '{"token_id":"0","expected_next_nonce":1}' \
  prepaid-gas '100 Tgas' attached-deposit '1 NEAR' \
  sign-as $BUYER_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send

# If a signing request never calls back (in flight for more than 300 blocks), the owner can unlock it.
# The reservation stays; follow with retry_reserved.
near contract call-function as-transaction $CONTRACT release_stuck json-args '{"token_id":"0"}' \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send

# 5. Views.
near contract call-function as-read-only $CONTRACT get_wallet json-args '{"token_id":"0"}' network-config testnet now
near contract call-function as-read-only $CONTRACT get_sig_log json-args '{"token_id":"0"}' network-config testnet now

# 6. Run the evidence run (evidence/README.md): checks 1 to 6, `make snapshot TOKEN=0` at each stage.

# 7. FINAL DEPLOY ONLY: lock the contract. List the keys, delete every one, save the proof.
near account list-keys $CONTRACT network-config testnet now
near account delete-keys $CONTRACT public-keys ed25519:<KEY_FROM_THE_LIST> \
  network-config testnet sign-with-legacy-keychain send
curl -s "$NEAR_RPC" -H 'content-type: application/json' -d \
  '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"'"$CONTRACT"'"}}' \
  > evidence/access-keys.txt     # expect "keys":[]
```

Deleting the keys is irreversible: the contract can no longer be upgraded, and its NEAR balance can no longer be withdrawn. Redeploying to a new account changes every wallet address, because the address is derived from the contract account. Lock only the final deployment. Compare the deployed code hash (`near account view-account-summary $CONTRACT network-config testnet now`; it is the base58 form of the wasm's SHA-256) with `contracts/res/handover.wasm.sha256`.

### Security model and limits

- **Trust in NEAR's MPC network.** Handover's guarantee is that only the contract can request signatures for a wallet's address. Whoever can break or collude inside the MPC network could sign for any derived address. The contract does not re-verify that a returned signature belongs to the token's derived key; the MPC contract's `respond` does.
- **`nft_transfer` gifting is not protected.** A plain NEP-171 transfer works (when the token is not listed, in flight or reserved), but it carries no clean check. A recipient must run the clean check (CLI `handover status`, or the wallet page) before accepting a wallet, and treat `dirty`, `busy` and `inconsistent` as unsafe. The safe path is `list` and `buy`.
- **Reserved transactions can lock a token.** If an MPC call fails or times out, the token stays unsellable and untransferable until `retry_reserved` succeeds. During an MPC outage this lasts as long as the outage. This is deliberate: the alternative is a possible unlogged signature. `release_stuck` (after 300 blocks) only clears `in_flight`; it never drops the reservation.
- **Standing approvals cannot be created through the contract.** The address is derived from the contract and only the contract can sign for it, and the contract only signs plain ETH transfers it built (no calldata), so no ERC-20 `approve`, `setApprovalForAll` or other contract call can ever be signed for a Handover address.
- **The clean check is a point-in-time check.** It is valid for a listed wallet because listing freezes signing. Buyers should re-run it immediately before buying; the web app does this and enables the buy button only after a clean check within the last 60 seconds.
- **Storage.** Each logged signature costs contract storage, paid from the sign fee. The bounded per-token state (wallet, listing, reservation, owner-set entry, transfer-call marker, pinned address) is prepaid at mint by a 1500-byte buffer (0.015 NEAR) on top of the measured cost. After the keys are deleted the contract cannot be topped up by its owner.
- **Testnet software, not audited.** No third-party audit.

#### Independent review

An internal adversarial review of the contract, the clean check and the UI found problems that were fixed before this documentation was written (fixes F0 to F8, claims table in section 6 and `docs/CLAIMS.md` section G). In short:

- `buy` was not bound to the state the buyer had checked, so a seller could delist, sign and relist between the check and the purchase (fixed: `expected_next_nonce` and exact price).
- The MPC callback deserialised its input with a typed callback result, and per-token storage could be griefed; either could leave a token frozen with `in_flight` set (fixed: raw promise result parsed by hand, per-token state prepaid at mint, `release_stuck`).
- The `nft_transfer_call` return path let a temporary owner obtain signatures during the call (fixed: transfer-call lock).
- Transactions with very low fees could be signed that nodes would not mine, leaving the nonce stuck (fixed: `gas_limit` at least 21000, `max_fee_per_gas` at least 1 gwei, priority fee rules).
- `new` could be front-run when deploy and init were separate transactions (fixed: `#[private]`, deploy and init in one transaction).

This is a description of what was changed, not an audit report, and the limits below remain.

#### Residual limits

- **Seller payout to a deleted account.** If the seller's account no longer exists when `buy` runs, the payment transfer fails and the funds stay with the contract. Sellers should keep their account alive until a sale completes.
- **Resolver out of gas.** If `nft_resolve_transfer` runs out of gas after an `nft_transfer_call`, `transfer_call_pending` is never cleared and that token stays frozen. The contract has no method to clear it.
- **Gas limit range (21000 to 300000).** The first design signed only `gas_limit` 21000. The evidence run found that this no longer works on Sepolia: since the Glamsterdam upgrade (EIP-2780 and EIP-8037, live on Sepolia since 2026-10-06), ETH sent to an address that does not exist yet pays 183,600 extra gas to create it, and EIP-7702 smart accounts such as MetaMask's run code on receive (about 24k). Two transfers from token 0 with 21000 gas reverted for these reasons before the fix (they consumed their nonces, so the clean check stayed correct). The contract now accepts 21000 to 300000 and the web app estimates the gas for each recipient. A recipient needing more than 300000 cannot be paid. A signed transfer whose `gas_limit × max_fee_per_gas` plus value exceeds the wallet balance cannot be mined until the wallet is topped up, and the clean check shows the wallet as `dirty` meanwhile.
- **Signatures from earlier code.** Any code deployed earlier at the same contract account, before its keys were deleted, could have asked MPC for signatures for these derived addresses without them appearing in the log. The clean check cannot see those. Before buying, check the contract account's deploy history and that no full-access keys remain (`near account list-keys`). `handover.handover-alpha.testnet` ran three versions of this repository's contract, all of which log every signature: the first deploy (`GHMwaEMqpQoJGDJVmVfQc4xmZ7db6ekd8MsozDeCdyjw`, `gas_limit` exactly 21000), an upgrade capping gas at 100000 (`14AzwbiC4obJPZprpoQ2ARdywG5sD2SrLCobA7xPeUFv`), and the current code (`5LcDNSBCeUrZiWrzDzvaXBRnxNh7qLGPgHBqjmkWJtTR`).
- **Stale MPC failure.** A stale MPC failure callback can only arrive within the 200-block yield window, which ends before `release_stuck` is allowed (300 blocks).

### Roadmap

- **v2 (live on testnet, not locked yet): tokens leave with the wallet.** `request_token_transfer` builds, besides plain ETH transfers, only ERC-20 `transfer`, ERC-721 `safeTransferFrom(wallet, to, id)` and ERC-1155 `safeTransferFrom(wallet, to, id, amount, "")` (`tx.rs` `validate_token_transfer`, `is_allowed_transfer`). It never builds `approve`, `setApprovalForAll` or `permit`, and it only signs transactions it built, so no Permit2 message or EIP-7702 delegation can be signed either. Next: lock v2, add a clean-check rule that every logged transaction is one of the allowed shapes, and unit tests for the token encodings. Out of scope on purpose: arbitrary contract calls (DeFi positions, vesting claims), because a right granted inside an arbitrary contract can survive the sale and cannot be proven absent.
- Dynamic token metadata that reflects the wallet (address, balance, verdict).
- CLI polish: broadcast pending transactions, JSON output.
