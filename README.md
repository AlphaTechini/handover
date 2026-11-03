# Handover

**An NFT that owns its own Ethereum wallet, and a sale flow that lets you buy that wallet, with everything in it, without trusting the seller.**

Who it is for: anyone who needs to hand over a whole wallet instead of moving assets one by one. Examples: selling a position that is tied to an address (tokens vesting to that address, locked or illiquid balances), handing a project or treasury wallet to a new team, or gifting a funded wallet. The buyer gets the wallet itself, not a promise.

Status: contract, clean-check library, CLI and web app are built and unit-tested. **The contract is not deployed yet and `evidence/` holds no chain data yet** (see section 7). Testnets only: NEAR testnet and Ethereum Sepolia.

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
2. **Spend (owner only).** `request_transfer(token_id, to, value_wei, gas_limit, max_fee_per_gas, max_priority_fee_per_gas)` checks the caller owns the token and that the token is not listed and not already signing. The contract builds an EIP-1559 transaction itself with the next nonce, `chain_id` fixed at init, and empty calldata, hashes it, and asks the MPC contract to sign. There is no parameter for calldata, so the contract can only ever sign "send ETH to an address".
3. **Log.** On success, `on_signed` rebuilds the transaction from its own reserved copy, checks the returned signature, appends the signed transaction to a public log (`get_sig_log`) and increments the nonce. Anyone can broadcast anything in the log.
4. **List.** `list(token_id, price)` freezes signing. Nothing new can be signed until `delist` or a sale.
5. **Clean check (off-chain, anyone can run it).** Read `next_nonce`, the signature log and the wallet flags from the contract, and the address's confirmed nonce from Sepolia. If the Sepolia nonce equals `next_nonce`, every signature ever issued has been used, so none can be broadcast later.
6. **Buy.** `buy(token_id)` with at least the price attached moves the NFT to the buyer, pays the seller exactly the price, refunds any excess, and clears the listing, in one call. The old owner is refused from then on.

**Invariant:** *Once a Handover wallet shows clean, no one but the next owner can ever move its funds.*

### Verdicts

| Verdict | Meaning |
|---|---|
| `clean` | Log is complete, nothing in flight or reserved, Sepolia nonce equals `next_nonce`. Safe to buy. |
| `dirty` | Some logged signed transactions are not mined yet. The UI lists them; they are the seller's own transfers and anyone can broadcast them, after which the verdict becomes `clean`. |
| `busy` | A signing request is in flight, or a signing attempt did not complete and a transaction is reserved (below). A signature may still appear. |
| `inconsistent` | The data contradicts itself (a gap or duplicate in the log, a Sepolia nonce ahead of the contract, a logged transaction that does not match its raw bytes). Treat as unsafe. |

### What if a signature leaked from a failed MPC call?

The MPC network publishes a signature on chain when it responds, even if Handover's callback fails or the call times out. A failed attempt therefore does not prove that no signature exists, and "clean" could be wrong. The contract closes this with the **reserved-transaction rule**:

- `request_transfer` stores the exact transaction (nonce, recipient, amount, fees, payload hash) as *reserved* and marks the token in flight **before** calling MPC.
- If the callback sees a failure or timeout, the nonce is **not** consumed and the reservation **stays**. While it stays, a new `request_transfer` is rejected whatever its arguments, and `list`, `buy`, `nft_transfer` and `nft_transfer_call` are rejected too. The owner must call `retry_reserved`, which asks for a signature on the identical transaction.
- Any signature that leaked therefore authorises the very transaction the contract already knows about. Whichever copy is broadcast, the effect is the same and only one can be mined.
- The clean check reports a reserved transaction as `busy`, so no buyer is told "clean" while one exists.

## 5. NEAR features used

| Feature | Where | What breaks without it |
|---|---|---|
| **Chain Signatures** (MPC signer `v1.signer-prod.testnet`, `sign` with `payload_v2` and `domain_id` 0) | [`mpc.rs`](contracts/handover/src/mpc.rs), [`wallet.rs`](contracts/handover/src/wallet.rs) (`sign_promise`) | A contract cannot control an Ethereum address. The wallet would need a private key, which brings back the exact problem Handover solves. |
| **NEP-171 / 177 / 178 / 181** via `near-contract-standards` 5.30.0 | [`lib.rs`](contracts/handover/src/lib.rs) | The wallet would not be a transferable token that wallets, explorers and marketplaces understand. |
| **Cross-contract call and callback** (`.then`, `#[callback_result]`, `#[private]`) | [`wallet.rs`](contracts/handover/src/wallet.rs) (`request_transfer`, `on_signed`) | Signing is asynchronous. Without the callback the contract cannot log the signature, or release the reservation. |
| **1-yocto confirmation** (`assert_one_yocto`) | [`market.rs`](contracts/handover/src/market.rs) (`list`, `delist`) | A function-call access key could list or delist; the deposit forces a full-access key. |
| **Attached deposits and promise transfers** | [`market.rs`](contracts/handover/src/market.rs) (`buy`), [`wallet.rs`](contracts/handover/src/wallet.rs) | Payment and NFT transfer could not happen in one atomic call. |
| **Locked contract** (full-access keys deleted after the final deploy) | [`README` section 14](#14-setup-env-deploy-security-roadmap), proof planned in `evidence/access-keys.txt` | The contract owner could upgrade the code and take every wallet. The contract has no admin or upgrade method, so deleting its keys makes the code final. |
| **NEP-297 events** | [`events.rs`](contracts/handover/src/events.rs) | Indexers would have no record of signatures, listings and sales. |
| **Environment host functions** (`env::keccak256`, `env::ecrecover`) | [`tx.rs`](contracts/handover/src/tx.rs) | The contract could not hash transactions or validate returned signatures on chain. |

## 6. Claims table

Full table with one row per security requirement: [`docs/CLAIMS.md`](docs/CLAIMS.md). Rust tests are in [`contracts/handover/src/tests.rs`](contracts/handover/src/tests.rs); TypeScript tests in [`packages/cleancheck/test/`](packages/cleancheck/test/). Anything that needs a deployed contract says "pending evidence run".

| Claim | Code | Proof |
|---|---|---|
| Only the current owner can request signatures; the old owner is refused after a sale or transfer | [`require_owner` lib.rs:210](contracts/handover/src/lib.rs#L210), [`request_transfer` wallet.rs:45](contracts/handover/src/wallet.rs#L45) | `request_transfer_rejects_non_owner`, `old_owner_refused_after_buy`, `old_owner_cannot_request_after_nft_transfer` |
| Listing freezes signing; no listing while a request is in flight | [`assert_can_sign` wallet.rs:172](contracts/handover/src/wallet.rs#L172), [`list` market.rs:19](contracts/handover/src/market.rs#L19) | `request_transfer_rejected_while_listed`, `list_rejected_while_in_flight`, `no_second_request_while_in_flight` |
| Nonces are strictly sequential; a failed MPC call never consumes one | [`finish_signing` wallet.rs:217](contracts/handover/src/wallet.rs#L217), [`mark_failed` wallet.rs:268](contracts/handover/src/wallet.rs#L268) | `nonces_are_strictly_sequential_and_log_is_ordered`, `failed_mpc_call_keeps_reservation_and_does_not_consume_nonce` |
| Only plain ETH transfers can be built and signed (no calldata, so no approvals) | [`build_plain_transfer` tx.rs:71](contracts/handover/src/tx.rs#L71), [`is_plain_transfer` tx.rs:88](contracts/handover/src/tx.rs#L88) | `only_plain_transfers_can_be_built`, `transfer_parameter_validation` |
| Reserved transaction keeps a failed attempt accounted for; `retry_reserved` re-signs the identical payload | [`retry_reserved` wallet.rs:109](contracts/handover/src/wallet.rs#L109), [`ReservedTx` types.rs:19](contracts/handover/src/types.rs#L19) | `new_request_rejected_while_reserved_even_with_different_args`, `retry_reserved_resigns_identical_payload_then_nonce_advances`, `list_rejected_while_reserved` |
| `on_signed` never panics on a bad MPC response | [`on_signed` wallet.rs:142](contracts/handover/src/wallet.rs#L142) | `on_signed_never_panics_on_bad_responses_and_keeps_reservation` |
| Signed transactions are canonical RLP even when `r` or `s` has a leading zero byte | [`assemble` tx.rs:145](contracts/handover/src/tx.rs#L145) | `canonical_rlp_when_r_has_leading_zero_byte`, `canonical_rlp_when_s_has_leading_zero_byte` |
| The transaction hash matches an independent implementation (viem) | [`signing_hash` tx.rs:93](contracts/handover/src/tx.rs#L93) | `matches_independent_viem_vector`, `pnpm --filter checks check:4` |
| `buy` is atomic: NFT moves, seller paid exactly the price, excess refunded | [`buy` market.rs:56](contracts/handover/src/market.rs#L56) | `buy_moves_nft_pays_seller_exactly_and_refunds_excess`, `buy_rejects_underpayment` |
| `list` and `delist` need exactly 1 yocto | [market.rs:20](contracts/handover/src/market.rs#L20), [market.rs:44](contracts/handover/src/market.rs#L44) | `list_requires_exactly_one_yocto_not_zero`, `delist_requires_one_yocto` |
| No admin, upgrade or key-management code in the contract | all of `contracts/handover/src` | `production_sources_have_no_upgrade_or_key_management` |
| Clean check: clean, dirty, busy and inconsistent verdicts | [`cleanCheck` check.ts:22](packages/cleancheck/src/check.ts#L22) | `check.test.ts` (happy paths, dirty, busy, inconsistent), `reserved.test.ts` |
| Offline snapshot verification checks every logged transaction against its raw bytes | [`verifySnapshot` snapshot.ts:82](packages/cleancheck/src/snapshot.ts#L82) | `snapshot.test.ts` (`verifySnapshot`, committed fixtures) |
| Ethereum address derived from the MPC public key | [`ethAddressFromMpcKey` address.ts:41](packages/cleancheck/src/address.ts#L41) | `address.test.ts`; live agreement: pending evidence run |
| The committed wasm matches its recorded hash | [`contracts/res/handover.wasm.sha256`](contracts/res/handover.wasm.sha256) | `make verify` step 4 |
| MPC returns the signature shape the contract expects; full sale works on testnet and Sepolia | [`mpc.rs`](contracts/handover/src/mpc.rs) | pending evidence run (`check:2`, `check:5`, `evidence/`) |
| Contract account has no access keys | n/a | pending evidence run (`evidence/access-keys.txt`) |

## 7. What is mocked or not built

- **Not deployed.** The contract has not been deployed to NEAR testnet, so there is no contract account, no hosted demo, and `evidence/` holds no chain data. Everything marked "pending evidence run" waits for the builder to deploy and run the checks (section 14, [`evidence/README.md`](evidence/README.md)).
- **Contract unit tests use a stand-in for MPC.** They feed the callback a signature made with a throwaway test key. They prove the contract's logic and encoding, not that the real MPC contract answers in exactly this shape (capability check 2 is for that). The MPC response shape in [`mpc.rs`](contracts/handover/src/mpc.rs) was taken from the MPC contract's source and a third-party testnet report, not from a live call made by this repository.
- **Synthetic fixtures.** The snapshots in `packages/cleancheck/test/fixtures/` are hand-made and labelled `SYNTHETIC` in their `note` and in the CLI output. They are not chain data.
- **No ERC-20.** Only ETH transfers can be signed. ERC-20 `transfer` (never `approve`) is on the roadmap.
- **Testnets only.** NEAR testnet and Ethereum Sepolia (`chain_id` 11155111). No mainnet, no real funds.
- **Dynamic NFT metadata** is not built; token metadata is static.
- **Check 3 and chainsig.js.** `checks/03-address-agreement.ts` cross-checks the address four ways: the MPC `derived_public_key` view, a pure noble derivation with the pinned testnet root key, the `chainsig.js` library, and the address recovered from a real signature. The `chainsig.js` route is reported as SKIPPED when the library does not load (it failed under Node 22 ESM in one install because of an `@noble/curves` version clash; with the committed lockfile it loaded and agreed in `--offline` mode). When skipped, the other routes still decide the verdict.
- **`#[private]` on `on_signed`** is enforced by the NEAR SDK macro only in the compiled wasm, not in unit tests. The unit tests cover an explicit predecessor check in the function body; the macro itself is exercised only on testnet.
- **Gas numbers.** Unit tests count host-function gas only. Real gas and MPC latency are not measured yet (section 11).
- **Open contract risks:** the contract cannot check that a returned signature belongs to the token's derived key (it relies on the MPC contract, whose `respond` verifies it); a reserved transaction blocks transfers and sales until `retry_reserved` succeeds, so an MPC outage can lock a token; a signature obtained inside an `nft_transfer_call` window is logged normally. See [`contracts/handover/README.md`](contracts/handover/README.md).
- **The web UI** is a static SvelteKit app that reads the chain directly (no backend). It has been built (`make web`) and its chain layer unit-tested, but not exercised against a live deployment.

## 8. Try it in 30 seconds

Prerequisites: Rust (stable; the `wasm32` target is **not** needed for tests), Node 22, pnpm 10, GNU make. No keys, no network access to NEAR or Ethereum, no wallet.

```bash
git clone <this repository> && cd handover
make verify
```

`make verify` installs Node dependencies first if `node_modules` is missing, then runs: (1) the contract unit tests, (2) the clean-check library tests, (3) the clean-check CLI over every `evidence/snapshots/*.json` (none yet) and the synthetic fixtures, (4) `sha256sum -c` on the committed wasm. It exits non-zero if any step fails.

Output captured on this repository (warm Rust and Node caches, 6.4 s wall time; the per-fixture output is shown in full for one fixture and abbreviated for the others, and the absolute path is replaced by `/path/to/handover`; a cold first run also compiles the Rust dependencies and was not timed):

```text
[1/4] Contract unit tests (cargo test)
test result: ok. 67 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.94s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

[2/4] Clean-check library tests (vitest)
 Test Files  7 passed (7)
      Tests  124 passed (124)

[3/4] Clean-check verdicts over committed snapshots
No real snapshot committed yet (evidence/snapshots is empty): only synthetic fixtures below.

Synthetic fixtures (packages/cleancheck/test/fixtures, NOT chain data):
== /path/to/handover/packages/cleancheck/test/fixtures/dirty-pending.json ==
*** SYNTHETIC FIXTURE: hand-made for tests, NOT chain data ***
    Hand-made for tests (generated by test/fixtures/generate.ts). NOT chain data.

  Token                           0
  Contract                        synthetic.handover.test
  Address                         0x1111111111111111111111111111111111111111
  Balance                         1 ETH (1000000000000000000 wei)
  Captured                        1970-01-01T00:00:00.000Z
  Signature log entries           3

  Contract next_nonce (issued)    3
  Sepolia nonce (latest)          1
  Sepolia nonce (pending)         2

  Pending signed transactions (2):
    nonce  to                                          value (wei)           mempool  tx hash
    1      0x2222222222222222222222222222222222222222  2000000000000000      yes      0xc062ef02726d088ae4c0442d1fdfc79899479426a980be162d98f89ef61a7a8d
    2      0x2222222222222222222222222222222222222222  3000000000000000      no       0x3a38ab84503a82dec125130ac7aa6f047cc48fbac9551f92a134aa9b3895be3f

  VERDICT: DIRTY
    - Contract issued 3 signatures (nonces 0-2); Sepolia confirmed nonce is 1.
    - 2 signed transactions (nonces 1, 2) are not mined yet.
    - One of them is already in the Sepolia mempool (nonce 1; pending nonce 2).
  expected: dirty  OK

== /path/to/handover/packages/cleancheck/test/fixtures/clean-3-issued.json ==
  VERDICT: CLEAN
    - Contract issued 3 signatures (nonces 0-2); Sepolia confirmed nonce is 3. Every signature has been used.
  expected: clean  OK

(busy-in-flight.json: BUSY, expected busy, OK)
(inconsistent-hash-mismatch.json: INCONSISTENT, expected inconsistent, OK)
(inconsistent-missing-nonce.json: INCONSISTENT, expected inconsistent, OK)

[4/4] Committed wasm matches its sha256
handover.wasm: OK

VERIFY OK in 6s: contract tests pass, clean-check tests pass, 5 synthetic fixtures and 0 real snapshot(s) give the expected verdicts, wasm hash matches.
Note: no real snapshot committed yet; real-chain proof is pending the evidence run (see evidence/README.md).
```

The last three fixture lines are abbreviated here; the command prints the full report for each. When real snapshots from the evidence run are committed in `evidence/snapshots/`, step 3 prints their verdicts first.

- **Hosted demo:** _not deployed yet; link to be filled after deploy_
- **Contract account (NEAR testnet):** _not deployed yet; to be filled after deploy_

Other useful targets: `make test` (contract, clean-check and web tests), `make web` (production build of the web app), `make checks-offline` (capability checks 3 and 4, no network), `make help`.

## 9. Do X, see Y (hosted demo)

For the hosted demo (not deployed yet). You need two NEAR testnet accounts (a seller and a buyer) and a Sepolia faucet. Pages: `/` (overview), `/mint/`, `/wallets/` (your wallets), `/wallet/?id=N` (one wallet), `/market/` (listings), `/how/` (explanation).

1. **Mint.** Connect the seller account, open `/mint/`, mint. *See:* a new token and its derived Ethereum address (`0x...`).
2. **Fund.** Copy the address and send Sepolia ETH to it from a faucet. *See:* the wallet page shows the balance after the next refresh.
3. **Spend.** On `/wallet/?id=N` send `0.0001` ETH to any address (the call attaches the 0.01 NEAR sign fee and 300 Tgas). *See:* an Etherscan (Sepolia) link for the broadcast transaction, and a signature-log entry with nonce `0`.
4. **List.** Set a price and list. *See:* the wallet shows "Listed, signing frozen" (the contract refuses every signature request while listed); the verdict is `clean` once the Sepolia nonce equals the number of logged signatures. The same wallet appears on `/market/` with its verdict.
5. **Buy.** Switch to the buyer account, open the listing, run the clean check, buy. The buy button is enabled only after a recent `clean` verdict. *See:* the NFT moves to the buyer and the price lands with the seller.
6. **Buyer spends.** The buyer sends a small transfer from the wallet. *See:* it works, with the next nonce in the log.
7. **Old owner refused.** Switch back to the seller and try to send. *See:* the transaction fails with the contract's message `Only the token owner can do this` ([`lib.rs:216`](contracts/handover/src/lib.rs#L216)). Before the sale, trying to send while listed fails with `Token is listed: delist to sign` ([`wallet.rs:173`](contracts/handover/src/wallet.rs#L173)).

Without the hosted demo, the same states can be checked from a terminal with `make status TOKEN=0` once a contract is deployed and `.env` is set.

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
     lib.rs     NEP-171/177/178/181, nft_mint, owner/transfer guards
     wallet.rs  request_transfer, retry_reserved, on_signed (reserved tx, nonces, sig log)
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
| `contracts/handover/` | Rust contract and 67 unit tests (`src/tests.rs`) |
| `contracts/res/` | built `handover.wasm`, `handover.wasm.sha256`, ABI, build record `BUILD.md` |
| `packages/cleancheck/` | TypeScript library `@handover/cleancheck`, CLI `bin/handover.ts`, tests and fixtures |
| `web/` | SvelteKit app (Svelte 5, static adapter); chain layer in `web/src/lib/chain/` |
| `checks/` | six capability-check scripts, the MPC sign probe contract in `checks/02-mpc-sign/` |
| `evidence/` | proof from real runs (empty until the evidence run, see its README) |
| `docs/` | `PRD.md`, `HACKATHON.md`, `CLAIMS.md` |

There is no backend. If a relay were ever added it would hold no keys.

## 11. Measured results

Measured from the code in this repository today:

| Item | Value | How to reproduce |
|---|---|---|
| Contract unit tests | 67 pass | `cargo test --manifest-path contracts/handover/Cargo.toml` |
| Clean-check tests | 124 pass (7 files) | `pnpm --filter @handover/cleancheck test` |
| Web chain-layer tests | 23 pass (4 files) | `pnpm --filter web test` |
| `handover.wasm` size | 311477 bytes (304.2 KiB); NEAR transaction limit used for the deploy check is 1.5 MiB | `wc -c contracts/res/handover.wasm`, `make checks-offline` |
| `handover.wasm` SHA-256 | `f000160a40d2380ff5b5abe3f0a4396d409d9e513c1f1a2df8b69a9192863510` | `make verify` step 4 |
| `make verify` wall time | about 6 s with warm caches (Rust, Node) | `time make verify` |
| Fixed constants | sign fee 0.01 NEAR, mint fee 0.05 NEAR, `sign` 50 Tgas static, `on_signed` 30 Tgas static, minimum prepaid 100 Tgas (300 recommended) | [`lib.rs`](contracts/handover/src/lib.rs), [`mpc.rs`](contracts/handover/src/mpc.rs) |

**To be measured in the evidence run (not measured yet, no numbers are claimed):** MPC sign latency (check 2), total gas of `request_transfer` and `on_signed` on testnet (check 2), storage cost per logged signature, signatures per wallet in the demo, and the evidence run summary (check 5, snapshots). Build details for the wasm: [`contracts/res/BUILD.md`](contracts/res/BUILD.md).

## 12. Built during the hackathon vs pre-existing

All project code in this repository was written during the hackathon window (first commit 2026-11-03). Nothing is carried over from an earlier project. The code was written with AI coding assistance (Claude Code) under the builder's direction. Libraries and tools used, with the versions pinned in `Cargo.lock` / `pnpm-lock.yaml`:

| Area | Library | Version |
|---|---|---|
| Contract | `near-sdk` (feature `unstable` for `env::ecrecover`) | 5.30.0 |
| Contract | `near-contract-standards` | 5.30.0 |
| Contract | `omni-transaction` (feature `evm` only) | 0.5.0 |
| Contract | `hex` | 0.4.3 |
| Contract tests only | `k256`, `rlp` | 0.13.4, 0.6.1 |
| Build | `rustc`, `cargo-near` | 1.97.0, 0.22.0 |
| Clean check | `@noble/hashes` | 2.4.0 |
| Clean check, checks, web | `typescript`, `tsx`, `vitest` | 6.0.3, 4.23.15, 5.1.0 |
| Checks | `chainsig.js`, `viem`, `@noble/curves`, `@scure/base` | 1.1.16, 2.57.16, 2.4.0, 2.4.0 |
| Web | `svelte`, `@sveltejs/kit`, `@sveltejs/adapter-static`, `vite` | 5.57.3, 3.1.1, 4.0.1, 8.3.5 |
| Web | `@hot-labs/near-connect`, `near-api-js`, `viem` | 0.12.0, 7.4.0, 2.57.16 |
| Web | `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` | 5.3.0 |

The MPC signer contract (`v1.signer-prod.testnet`) and NFT Chain Keys are third-party and are not copied into this repository.

## 13. Other project by the same builder

Co-op: <link to be added by the builder>

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

The commands below use near-cli-rs 0.30.x syntax. They were written for this README and have not been run from the environment that built the repository (it has no access to NEAR); check `near --help` if a subcommand differs. `CONTRACT` is the account to deploy to, for example `handover.<your-account>.testnet`.

```bash
# 1. Capability checks first (checks/README.md). Check 2 needs its probe contract; checks 1 and 6 need faucets.

# 2. Create the contract account and fund it (pays storage for the signature log).
near account create-account fund-myself $CONTRACT '10 NEAR' autogenerate-new-keypair save-to-legacy-keychain \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send

# 3. Deploy AND initialise in one transaction. `new` has no caller restriction, so initialise in
#    the same transaction as the deploy; otherwise anyone could call it first with other arguments.
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
  prepaid-gas '300 Tgas' attached-deposit '0.01 NEAR' \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send

near contract call-function as-transaction $CONTRACT list \
  json-args '{"token_id":"0","price":"1000000000000000000000000"}' \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send

near contract call-function as-transaction $CONTRACT buy json-args '{"token_id":"0"}' \
  prepaid-gas '100 Tgas' attached-deposit '1 NEAR' \
  sign-as $BUYER_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send

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
- **Reserved transactions can lock a token.** If an MPC call fails or times out, the token stays unsellable and untransferable until `retry_reserved` succeeds. During an MPC outage this lasts as long as the outage. This is deliberate: the alternative is a possible unlogged signature.
- **Standing approvals cannot be created through the contract.** The address is derived from the contract and only the contract can sign for it, and the contract only signs plain ETH transfers it built (no calldata), so no ERC-20 `approve`, `setApprovalForAll` or other contract call can ever be signed for a Handover address.
- **The clean check is a point-in-time check.** It is valid for a listed wallet because listing freezes signing. Buyers should re-run it immediately before buying; the web app does this and enables the buy button only after a clean check within the last 60 seconds.
- **Storage.** Each logged signature costs contract storage, paid from the sign fee. After the keys are deleted the contract cannot be topped up by its owner.
- **Testnet software, not audited.** No third-party audit.

### Roadmap

- ERC-20 `transfer` only (calldata `0xa9059cbb`, never `approve`), with a clean check that also covers allowances.
- Dynamic token metadata that reflects the wallet (address, balance, verdict).
- CLI polish: broadcast pending transactions, JSON output.
