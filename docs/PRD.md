# Handover: Product Requirements Document

**Status:** ready to build · **Written:** 2026-11-03 · **Deadline:** 2026-11-14 23:59 UTC (repo public + X demo post + one submission)
**Builder:** solo · **Networks:** NEAR testnet + Ethereum Sepolia only · **Spend:** zero (testnet funds, free tiers only)

This PRD is the single source of truth for the coding agent building Handover. Read it top to bottom before writing code, then read `docs/HACKATHON.md` (snapshot of the official rules). Where this PRD and the live rules disagree, the live rules at https://nearhackathon.com/HACKATHON.md win.

---

## 1. One-liner

**Handover is an NFT that owns its own Ethereum wallet, and a sale flow that lets you buy that wallet, with its ETH and tokens, without having to trust the seller.**

Who it's for: anyone who needs to hand over a whole wallet rather than move assets one by one. Examples: selling a position that is tied to an address (tokens vesting to that address, locked or illiquid balances), handing a project or treasury wallet to a new team, or gifting a funded wallet. The buyer gets the wallet itself, not a promise.

## 2. The problem

- Some value can't be moved by sending tokens: vesting schedules and locks pay a fixed address, and a wallet holding many assets takes many transactions to empty. The only way to transfer it is to transfer control of the address.
- Today that means handing over a private key or seed phrase. The seller still has a copy. They can drain the wallet after being paid, and the buyer can never prove they didn't.
- NEAR Chain Signatures already lets a NEAR contract control an Ethereum address with no private key anyone holds, and an NFT can decide who may use it. NEAR's own docs list an "NFT Chain Keys" contract (`nft.kagi.testnet`) that does this. **But owning the NFT is not enough to make a sale safe:**
  1. **Pre-signed transactions.** The seller asks for a signature before selling, keeps the signed transaction, sells the NFT, then broadcasts it and drains the wallet.
  2. **Standing approvals.** On Ethereum the seller can approve another contract to spend the wallet's tokens. That right survives the sale and needs no new signature.
  3. **Upgradeable contract.** Whoever controls the NFT contract's account can upgrade it and take every wallet.
  4. **Non-atomic payment.** Buyer pays, seller doesn't transfer (or the reverse).

**What we do not claim to invent:** NFT-controlled MPC keys (NFT Chain Keys did this first), Chain Signatures, or the NFT standard. **What Handover adds** is the part that makes the wallet sellable: every signature is public and sequential, listing freezes signing, only plain transfers can ever be signed, the contract is locked, and payment and transfer happen in one call. The README must say this plainly, with a link to NFT Chain Keys.

## 3. The mechanism (say this in one breath)

Each Handover NFT has its own Ethereum address, derived from the Handover contract's account and the token ID. Only the Handover contract can ask NEAR's signing network for signatures on that address, and it only does so for the NFT's current owner, for plain transfers it builds itself, with nonces it hands out one by one and records publicly. To sell, the owner lists the NFT, which freezes signing. Anyone can then check that the wallet's on-chain nonce has caught up with the last nonce the contract ever issued, which proves no signed transaction is still waiting to be broadcast. The buyer pays and receives the NFT in one call.

**Invariant (state it in the README, test it, show it in the demo):** *Once a Handover wallet shows "clean", no one but the next owner can ever move its funds.*

Why NEAR is irreducible: Chain Signatures is what lets a contract, not a person, control an Ethereum address. Remove it and the wallet needs a private key, which brings back the exact problem.

## 4. Track fit

Primary track: **`nfts` (NFTs That Do Something)**. Secondary: **`open` (Open Innovation, chain abstraction)**. Consider **`security`** too (resale safety is a security product); the human decides.

| Track brief item | Where Handover does it | File (target path) |
|---|---|---|
| NFTs as accounts that own money | Each NFT controls a real Ethereum address and its balance | `contracts/handover/src/wallet.rs` |
| Hold inventory | The wallet holds ETH and (P1) ERC-20 tokens, shown live on the NFT page | `web/src/routes/wallet/[id]` |
| Carry access rights | Owning the NFT is the only right to request signatures | `contracts/handover/src/wallet.rs` |
| Ownership with behaviour | The NFT freezes, reports cleanliness, and refuses signatures that could survive a sale | `contracts/handover/src/market.rs` |

| Hint | Used? | How |
|---|---|---|
| NEP-171 | Yes | Standard NFT via `near-contract-standards` (NEP-171 core, NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration) |
| Dynamic NFTs | P1 | Token metadata reflects the wallet (address, last known balance, clean/dirty) |
| Sub-accounts | Not needed | Stated as not used |
| Chain Signatures (toolkit) | Yes, core | Contract calls the MPC signer contract with `sign` |

## 5. Users and roles

| Role | What they do |
|---|---|
| **Minter / owner** | Mints a Handover NFT, funds its Ethereum address, spends from it while they own it |
| **Seller** | Lists the NFT for a price in testnet NEAR; signing freezes while listed |
| **Buyer** | Checks the wallet's contents and clean status, then buys in one call |
| **Anyone** | Can broadcast any signed transaction the contract has recorded (this is what clears pending signatures) |

## 6. Core flows

### 6.1 Mint
1. Owner calls `nft_mint()` with storage deposit. Token IDs are sequential.
2. The derivation path is `handover-<token_id>`. The Ethereum address is derived from `(handover contract account, path, MPC root key, secp256k1 domain)`. The UI derives it with `chainsig.js` (`deriveAddressAndPublicKey(<contract account>, path)`), and the capability checks confirm it matches the MPC contract's `derived_public_key` view and the address recovered from a real signature.
3. The NFT page shows the address, live Sepolia balance and a "fund this wallet" button that copies the address.

### 6.2 Spend (owner only)
1. Owner fills "send X ETH to Y" in the UI.
2. UI calls `request_transfer(token_id, to, value_wei, gas_limit, max_fee_per_gas, max_priority_fee_per_gas)` with the MPC deposit attached.
3. Contract checks: caller is the token owner; token is not listed; no signature is already in flight for this token. It assigns `nonce = next_nonce[token_id]`, builds an EIP-1559 transaction **itself** with `omni-transaction` (empty `input`, so it can only move ETH), hashes it with `env::keccak256`, and calls the MPC `sign`.
4. Callback (`#[private]`): on success, stores the signed transaction (raw bytes, hash, nonce, to, value) in a public log for that token and increments `next_nonce`. On failure, clears the in-flight flag and doesn't increment.
5. UI broadcasts the signed transaction to Sepolia with `viem` and shows the Etherscan link.

Because the contract is the only thing that can produce signatures for this address, its log is the complete list of every signature that exists.

### 6.3 List and the clean check
1. Owner calls `list(token_id, price)`. Rejected if a signature is in flight. From now on `request_transfer` is rejected for this token.
2. **Clean check (off-chain, anyone can run it):** read the token's `next_nonce` and signature log from the contract, and the address's confirmed nonce on Sepolia (`eth_getTransactionCount`). If chain nonce == `next_nonce`, every signature ever issued has been used, so none can be replayed later: **clean**. If chain nonce < `next_nonce`, some logged signed transactions haven't been mined yet: **dirty**. The UI lists them (to, value, nonce) and offers a "broadcast pending" button. They are the seller's own transfers, so broadcasting them is the seller's right; the buyer then sees the balance after they land.
3. The listing page shows: address, ETH balance (and P1 tokens), signature log, clean/dirty, price.

### 6.4 Buy
1. Buyer's UI refuses to enable "Buy" unless the clean check passes at that moment (re-check right before sending).
2. Buyer calls `buy(token_id)` with exactly the price attached. Contract checks the token is listed and not in flight, transfers the NFT to the buyer, pays the seller, clears the listing, unfreezes signing. All in one call.
3. Buyer immediately requests a small transfer, which succeeds. The seller's attempt (`request_transfer` from the old owner) is refused. **Show both in the demo: one success, one visible refusal.**

### 6.5 Delist and plain transfers
- `delist(token_id)` unfreezes signing.
- Standard `nft_transfer` (gifting) stays NEP-171 compliant and works, but it is not the safe path: the recipient's UI must run the clean check and warn if dirty. The README must explain this.

## 7. Smart contract spec

Rust, `near-sdk` 5.x (5.30.0 at time of writing), `near-contract-standards` 5.30.0, `omni-transaction` 0.5.0 with only the `evm` feature, built with `cargo-near` 0.22.x. Commit the built `.wasm` and its SHA-256.

**MPC signer contract:** testnet `v1.signer-prod.testnet` (mainnet `v1.signer`, not used). Request shape seen in current integrations: `sign({ "request": { "path": "<path>", "payload_v2": { "Ecdsa": "<32-byte hash, hex>" }, "domain_id": 0 } })` with a 1 yoctoNEAR deposit. Domain 0 is secp256k1 (Ethereum). **This must be confirmed by capability check 2 before the contract is written**; read the response shape (`big_r`, `s`, `recovery_id` or similar) from the real response, not from memory.

**State (sketch):**
- NFT standard state (`NonFungibleToken`, metadata, enumeration)
- `wallets: LookupMap<TokenId, WalletState>`: `next_nonce: u64, in_flight: bool, listing: Option<Listing { price, seller }>`
- `sig_log: LookupMap<TokenId, Vector<SignedTx>>`: `nonce, to, value_wei, tx_hash, raw_signed_tx_hex, signed_at_ns`

**Methods:**

| Method | Caller | Deposit | Notes |
|---|---|---|---|
| `nft_mint()` | anyone | storage | sequential token IDs |
| `request_transfer(token_id, to, value_wei, gas_limit, max_fee_per_gas, max_priority_fee_per_gas)` | token owner | MPC deposit | rejects if listed or in flight; builds tx itself; `chain_id` fixed to Sepolia (11155111) in config |
| `on_signed(token_id, nonce, ...)` | `#[private]` | — | store signed tx + increment nonce, or clear in-flight |
| `list(token_id, price)` / `delist(token_id)` | token owner | 1 yocto | freeze / unfreeze |
| `buy(token_id)` | anyone | exact price | atomic transfer + payment |
| NEP-171/177/178/181 methods | standard | standard | via `near-contract-standards` |
| views: `get_wallet(token_id)`, `get_sig_log(token_id, from, limit)`, `get_listing(token_id)`, `list_listings(from, limit)` | anyone | — | |

**Security requirements (each needs a test):**
- Only the current owner can request signatures; after `buy` or `nft_transfer` the old owner is refused.
- No signing while listed or while a request is in flight; no listing while in flight.
- Nonces are strictly sequential; a failed MPC call never consumes a nonce.
- The contract only ever signs transactions it built: plain ETH transfers and, since P1 shipped, ERC-20 `transfer` and ERC-721 / ERC-1155 `safeTransferFrom` calls it encodes itself (no arbitrary payloads, no caller calldata), so approvals can never be created.
- `buy` requires the exact price; refunds overpayment if any; seller paid only when NFT moves.
- Owner-only state changes require 1 yocto (`assert_one_yocto`).
- After the final testnet deploy, delete the contract account's full-access keys and commit proof (the `view_access_key_list` output) to `evidence/`. **Warning:** after this the contract can't be upgraded, and redeploying to a new account changes every wallet address. Do it only for the final deploy.

**P1 (built, together with ERC-721 and ERC-1155 `safeTransferFrom`):** ERC-20 transfers, still contract-built: only `transfer(to, amount)` calldata (selector `0xa9059cbb`) to a token address, never `approve`. Requires the clean check to also verify no approvals exist; for safety, P1 only after P0 is solid.

## 8. Off-chain pieces

- **Web app:** Svelte 5 (SvelteKit, static adapter). NEAR wallet connection with `@hot-labs/near-connect` (0.12.x; it's what NEAR's Chain Signatures example frontend uses). Reads with `near-api-js` v7, Sepolia with `viem` 2.x. Pages: Mint, My wallets, Wallet detail (address, balance, sig log, send form), Market (listings with clean/dirty badge), How it works.
- **Clean-check library:** `packages/cleancheck/` (TypeScript), used by the web app, the CLI and `make verify`. Pure function: given contract state and chain nonce, returns clean/dirty plus the pending list. Unit-tested with fixtures.
- **CLI (optional, helps the demo and judges):** `handover status <token_id>` prints address, balance, nonce comparison and verdict.
- **No backend required.** If one is added (e.g. to relay broadcasts), it must hold no keys.

## 9. Repository layout (target)

```
handover/
  README.md          LICENSE (MIT)   Makefile   .env.example
  contracts/handover/      # Rust contract
  contracts/res/           # built .wasm + sha256 (committed)
  packages/cleancheck/     # clean-check library + tests
  web/                     # SvelteKit app
  checks/                  # capability-check scripts
  evidence/                # testnet + Sepolia tx hashes, access-key proof, logs
  docs/PRD.md  docs/HACKATHON.md  docs/CLAIMS.md
```

## 10. Capability checks (do these BEFORE major code)

Small scripts in `checks/`, each printing PASS/FAIL with evidence. Commit them with `.env.example` so the human can run them locally with their own keys. Do not write the main contract until 1-4 pass.

1. **Funding.** NEAR testnet account via `near create-account <id> --useFaucet --networkId testnet` (near-cli-rs 0.30.x). Sepolia ETH via a faucet that does not require a mainnet balance; the Google Cloud Web3 faucet (cloud.google.com/application/web3/faucet/ethereum/sepolia, about 0.05 ETH per day with a Google account) is the main option. **The human must personally confirm both before anything else.**
2. **MPC sign from a contract.** Deploy a minimal contract to testnet that calls `v1.signer-prod.testnet.sign` with the request shape in section 7 and a 1 yocto deposit (try 0 and higher if rejected), and returns the response in a callback. Record: exact args accepted, deposit needed, gas used, latency, response fields. Also call the view `derived_public_key({ path, predecessor: <contract>, domain_id: 0 })`.
3. **Address agreement.** For the same `(contract account, path)`: address from `chainsig.js` `deriveAddressAndPublicKey`, address from `derived_public_key`, and address recovered from the check-2 signature must all match.
4. **`omni-transaction` inside the contract.** Build an EIP-1559 tx with `TransactionBuilder::new::<EVM>()`, `build_for_signing()`, `env::keccak256`, compiled with `cargo near build`; confirm wasm size is deployable and the hash matches the same tx built with `viem` off-chain.
5. **End to end.** Fund the derived address with Sepolia ETH, request a 0.0001 ETH transfer through the contract, assemble the signed tx, broadcast with `viem`, see it mined. Save tx hashes to `evidence/`.
6. **Sepolia RPC.** Pick a free endpoint (e.g. a public Sepolia RPC or a free-tier provider key) and confirm `eth_getTransactionCount` and `eth_sendRawTransaction` work at demo rates.

**Kill criteria:** if check 2 can't get a signature by end of 2026-11-05, stop and tell the human (the product depends on it). If check 4 fails (crate won't build for wasm or is too large), build the transaction off-chain but have the contract verify its fields before signing; record the change in the README.

## 11. Scope tiers

**P0 (in order):** capability checks 1-6 → contract: mint, `request_transfer` with contract-built ETH transfers, sequential nonces, public sig log, list/delist/buy, freeze, NEP-171 standards → contract tests for every security requirement → clean-check library + tests → web app: mint, wallet detail, send, market, clean badge → testnet deploy, full evidence run (mint, fund, spend, list, clean check, buy, buyer spends, old owner refused) → lock contract (delete full-access keys) → `make verify` → README, CLAIMS.md, LICENSE.

**P1:** ERC-20 `transfer` only; dynamic metadata; "dirty" demo that shows a pending signature being caught and broadcast; CLI.

**Never:** mainnet; signing arbitrary payloads or calldata; holding any private key; our own token; claiming we invented NFT-controlled keys.

## 12. README and evidence requirements

The hackathon's AI screeners (Claude Code and Codex) check the project runs and does what the README says (Q-017). Every claim maps to code and to proof in the repo.

**README order:**
1. Name, one-liner, who it's for
2. "Built for NEAR HACKATHON, tracks: NFTs That Do Something, Open Innovation" + track table with real file paths
3. The problem: the four resale risks in section 2, and prior art (NFT Chain Keys) with what Handover adds
4. How it works, step by step, plus the invariant
5. NEAR features used, each with file path and what breaks without it (Chain Signatures, NEP-171 family, 1-yocto confirmations, locked contract)
6. Claims table: claim → file:line → proof (test name, NEAR testnet tx, Sepolia tx, or `evidence/` log)
7. What's mocked or not built (e.g. no ERC-20 in P0; testnets only)
8. **Try it in 30 seconds:** `make verify` runs contract unit tests, the clean-check tests against committed fixtures (real data captured from the evidence run), and prints a verdict for the evidence wallet from the committed snapshot. No keys, no wallet, under 3 minutes, expected output pasted. Then the hosted demo link and contract account.
9. "Do X, see Y" steps for the hosted demo
10. Architecture with file paths
11. Measured results: MPC sign latency and gas, signatures per wallet, evidence run summary
12. Built during the hackathon vs pre-existing (all new; libraries listed per Q-005)
13. **Other project by the same builder: Co-op** (required by Q-015, one line with its repo link)
14. Setup, env vars, deploy, security model and its limits (trust in NEAR's MPC network; `nft_transfer` gifting needs a recipient-side clean check), roadmap

Keep the first ~1,500 words self-contained.

**Repo hygiene:** description and topics set; tidy top level; `.env` ignored, `.env.example` committed; no secrets; incremental commits; no stubs or fake data presented as real.

## 13. Demo (X post, ~2 min)

1. (10 s) "Buy a wallet without trusting the seller." + invariant.
2. (25 s) Mint, show the derived Ethereum address, fund it, send a transfer through the NFT, show it on Etherscan.
3. (25 s) Seller lists. Market shows the signature log and "clean" because Sepolia nonce = contract nonce.
4. (P1, 20 s) Seller had a pre-signed transfer: badge shows "dirty, 1 pending", it gets broadcast, badge turns clean.
5. (25 s) Buyer buys in one call; buyer sends a transfer (works); seller tries (refused on screen).
6. (10 s) Contract account has no full-access keys; repo link; "built at NEAR HACKATHON".

Free X accounts cap native video at about 2:20; post a native cut and link the full unlisted YouTube video in the text.

## 14. Build plan (adjust to the human's other commitments)

| Day | Work |
|---|---|
| Nov 3-5 | Capability checks 1-6 (MPC sign is the gate) |
| Nov 6-8 | Contract + tests |
| Nov 9 | Clean-check library, testnet deploy, evidence run |
| Nov 10-11 | Web app, hosting |
| Nov 12 | Lock contract, `make verify`, README, CLAIMS.md |
| Nov 13 | Demo video, X post (human) |
| Nov 14 | Human submits (one attempt, payload confirmed) |

## 15. Rules the agent must follow

- Never use mainnet or real funds. Never hold or log private keys in the repo.
- Never make the repo public, post on X, or submit; the human does those.
- Don't add AI co-author or session attribution lines to commits.
- Verify every contract address, method shape and SDK API against current docs or a real call before relying on it; versions above were checked on 2026-11-03.
- Don't put instructions aimed at judges or AI reviewers anywhere in the repo.

## 16. References

Hackathon
- Rules snapshot: `docs/HACKATHON.md` · live: https://nearhackathon.com/HACKATHON.md
- Site and form: https://nearhackathon.com · NEAR Discord: https://discord.gg/nearprotocol

Chain Signatures
- Concepts: https://docs.near.org/chain-abstraction/chain-signatures
- Implementation (MPC contracts `v1.signer` / `v1.signer-prod.testnet`, `chainsig.js`, `omni-transaction`): https://docs.near.org/chain-abstraction/chain-signatures/implementation
- Prior art, NFT Chain Keys (`nft.kagi.testnet`): https://docs.near.org/chain-abstraction/nft-chain-keys
- `chainsig.js` (1.1.x): https://www.npmjs.com/package/chainsig.js · docs: https://neardefi.github.io/chainsig.js
- `omni-transaction` (0.5.0): https://docs.rs/omni-transaction
- Third-party contract that calls `sign` from a contract with `payload_v2` + `domain_id` (useful reference, unaudited): https://github.com/metafrogmeme-droid/claw-guard-near
- MPC contract API overview, incl. `derived_public_key` (community-generated, verify against the real contract): https://deepwiki.com/Quantus-Network/near-mpc/5-api-reference

NEAR core
- Docs home: https://docs.near.org/ · CLI: https://docs.near.org/tools/cli.md · RPC providers: https://docs.near.org/api/rpc/providers
- One-yocto pattern: https://docs.near.org/smart-contracts/security/one_yocto
- Integration testing (`near-sandbox` + `near-api`): https://docs.near.org/smart-contracts/testing/integration-test
- NEP index (NEP-171, 177, 178, 181, 145): https://github.com/near/NEPs
- `near-api-js` v7: https://github.com/near/near-api-js
- Testnet explorer: https://testnet.nearblocks.io

Ethereum side
- `viem` (2.x): https://viem.sh
- Sepolia faucet without mainnet balance (Google): cloud.google.com/application/web3/faucet/ethereum/sepolia
- Sepolia explorer: https://sepolia.etherscan.io
