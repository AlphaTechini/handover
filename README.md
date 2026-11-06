# Handover

**An NFT that owns its own Ethereum wallet, and a sale flow that lets you buy that wallet, with its ETH and tokens, without trusting the seller.** For anyone who needs to hand over a whole wallet instead of moving assets one by one: a project or treasury wallet passing to a new team, a funded wallet being sold, or a gift.

- **Live demo:** https://handover-blush.vercel.app (NEAR testnet and Ethereum Sepolia, no real funds)
- **Contract:** [`handover-v2-alpha.testnet`](https://testnet.nearblocks.io/address/handover-v2-alpha.testnet), **locked**: no access keys remain, so the code can never change ([`evidence/access-keys.txt`](evidence/access-keys.txt))
- **Proof:** a full sale of a wallet holding ETH, two ERC-20s, two NFTs and ERC-1155 items, every transaction listed in [`evidence/token-run-2026-11-05.md`](evidence/token-run-2026-11-05.md)
- **Repository map:** [`structure.md`](structure.md)

## Built for NEAR HACKATHON

Tracks: **NFTs That Do Something** (`nfts`) and **Open Innovation** (`open`, chain abstraction). Security is a candidate third track, because resale safety is the core of the product.

| Track brief item | Where Handover does it | File |
|---|---|---|
| NFTs as accounts that own money | Each NFT controls a real Ethereum address and everything at it: ETH, ERC-20, ERC-721 and ERC-1155 | [`contracts/handover/src/wallet.rs`](contracts/handover/src/wallet.rs) |
| Hold inventory | The wallet page shows the address, its live balance, its tokens and its signature log | [`web/src/routes/wallet/+page.svelte`](web/src/routes/wallet/+page.svelte) |
| Carry access rights | Owning the NFT is the only way to get a signature for the address | [`contracts/handover/src/lib.rs`](contracts/handover/src/lib.rs) (`require_owner`) |
| Ownership with behaviour | Listing freezes signing; the contract refuses anything that could survive a sale | [`contracts/handover/src/market.rs`](contracts/handover/src/market.rs) |
| Chain abstraction | A NEAR contract controls an Ethereum account through Chain Signatures, with no private key anywhere | [`contracts/handover/src/mpc.rs`](contracts/handover/src/mpc.rs), [`tx.rs`](contracts/handover/src/tx.rs) |
| Security (candidate) | Public signature log, clean check, locked contract | [`packages/cleancheck/src/check.ts`](packages/cleancheck/src/check.ts) |

## The problem

Some value cannot be moved by sending tokens: vesting and locks pay a fixed address, and a wallet with many assets takes many transactions to empty. Transferring it means transferring control of the address, which today means handing over a seed phrase. The seller keeps a copy, can drain the wallet after being paid, and the buyer can never prove otherwise.

NEAR Chain Signatures lets a contract control an Ethereum address that no one holds a key for, and an NFT can decide who may use it. But owning the NFT is not enough to make a sale safe. Four risks remain:

1. **Pre-signed transactions.** The seller gets a signature before selling, keeps it, sells, then broadcasts it.
2. **Standing approvals.** The seller approves another contract to spend the wallet's tokens. That right survives the sale.
3. **Upgradeable contract.** Whoever controls the contract account can upgrade it and take every wallet.
4. **Non-atomic payment.** The buyer pays and the seller does not transfer, or the reverse.

[NFT Chain Keys](https://github.com/near/multichain-gas-station-contract/tree/master/nft_key) already made MPC keys transferable as NFTs. **Handover adds what makes the wallet safely sellable**: public sequential signatures, signing frozen while listed, only self-built transfers (never an approval), a locked contract, and payment and transfer in one call.

## What it does

1. **Mint.** The seller mints a Handover NFT. It gets its own Ethereum address, derived from the contract account and `handover-<token_id>`.
2. **Fill.** Anyone sends ETH, ERC-20 tokens, NFTs or ERC-1155 items to that address from any wallet. No approval is needed to receive.
3. **Spend (owner only).** The owner sends ETH or any token. The contract builds the transaction itself (a plain ETH transfer, ERC-20 `transfer`, or ERC-721 / ERC-1155 `safeTransferFrom`), asks the MPC network to sign it, and appends it to a public log with the next nonce.
4. **List.** The owner sets a price. Signing freezes until the sale or a delist.
5. **Check.** Anyone runs the clean check: if the address's Sepolia nonce equals the number of signatures the contract ever issued, every signature has been used, so none is left to broadcast later. The buy panel lists what the sale includes (ETH and tokens).
6. **Buy.** The buyer pays exactly the price, bound to the nonce they checked. The NFT, the address and everything at it move to the buyer in one call; the seller is paid in the same call.
7. **Use.** From then on only the buyer can move anything. They can send one token, or use **Send everything** to empty the wallet to one address. The old owner's requests are refused: `Only the token owner can do this`.

**Invariant:** *once a Handover wallet shows clean, no one but the next owner can ever move its assets.*

## Why NEAR is load-bearing

| NEAR feature | Role in the flow | File |
|---|---|---|
| **Chain Signatures** (MPC signer `v1.signer-prod.testnet`, `sign` with `payload_v2`, `domain_id` 0) | Signs every Ethereum transaction for the wallet's derived address | [`mpc.rs`](contracts/handover/src/mpc.rs), [`wallet.rs`](contracts/handover/src/wallet.rs) (`sign_promise`) |
| **NEP-171 / 177 / 178 / 181** via `near-contract-standards` 5.30.0 | The wallet is a standard NFT that wallets and explorers understand | [`lib.rs`](contracts/handover/src/lib.rs) |
| **Cross-contract call and callback** | Logs the signature, advances the nonce, keeps a failed attempt reserved | [`wallet.rs`](contracts/handover/src/wallet.rs) (`on_signed`) |
| **Deposits, promise transfers, 1-yocto confirmation** | Atomic `buy`; `list` and `delist` need a full-access key | [`market.rs`](contracts/handover/src/market.rs) |
| **Locked account** (keys deleted) | No upgrade or admin method exists, so the code is final | [`evidence/access-keys.txt`](evidence/access-keys.txt) |

Also used: NEP-297 events ([`events.rs`](contracts/handover/src/events.rs)), `env::keccak256` and `env::ecrecover` ([`tx.rs`](contracts/handover/src/tx.rs)). Without Chain Signatures the wallet would need a private key, which is exactly the problem Handover removes.

## What works now

Every claim with its code and proof: [`docs/CLAIMS.md`](docs/CLAIMS.md). The main ones:

| Claim | File | Proof |
|---|---|---|
| Only the owner gets signatures; the old owner is refused after a sale | [`lib.rs:231`](contracts/handover/src/lib.rs#L231) | test `old_owner_refused_after_buy`; live: [run](evidence/token-run-2026-11-05.md) step 9b |
| Only self-built transfers are signed: ETH, ERC-20 `transfer`, ERC-721 / ERC-1155 `safeTransferFrom`; never an approval | [`tx.rs:154`](contracts/handover/src/tx.rs#L154), [`tx.rs:252`](contracts/handover/src/tx.rs#L252) | test `only_plain_transfers_can_be_built`; tokens mined on Sepolia ([run](evidence/token-run-2026-11-05.md)) |
| Tokens move with the NFT: a buyer moved two ERC-20s, two NFTs and ERC-1155 items | [`wallet.rs:82`](contracts/handover/src/wallet.rs#L82) | [run](evidence/token-run-2026-11-05.md) steps 12 to 17 |
| Listing freezes signing; a failed MPC call never consumes a nonce | [`wallet.rs:228`](contracts/handover/src/wallet.rs#L228), [`wallet.rs:381`](contracts/handover/src/wallet.rs#L381) | tests `request_transfer_rejected_while_listed`, `failed_mpc_call_keeps_reservation_and_does_not_consume_nonce` |
| `buy` is atomic and bound to the checked nonce and exact price | [`market.rs:59`](contracts/handover/src/market.rs#L59) | test `buy_rejected_when_wallet_changed_after_check` |
| A pre-signed transaction is caught as `dirty` | [`check.ts`](packages/cleancheck/src/check.ts) | [demo run](evidence/demo-run-2026-11-05.md) (first deployment) |
| Deployed code = committed wasm; account locked | [`handover.wasm.sha256`](contracts/res/handover.wasm.sha256) | code hash `D2LpdVQX…ud8`; key deleted in NEAR tx `Aguy8dXR…nDA` |

## What's mocked or not built

- **Testnets only**, test tokens anyone can mint, not audited.
- **Contract unit tests stand in for MPC** with a throwaway `k256` key; the real response shape is proven live (check 2 and the runs).
- **Token encodings have no unit tests yet**; they are proven by mined Sepolia transactions ([run](evidence/token-run-2026-11-05.md)).
- **The token list comes from Blockscout's public index**, which can miss a contract. Unlisted tokens still belong to the owner and go out through the token form; "Send everything" covers listed tokens only.
- **"Send everything" needs one approval per item.** Its ETH step once failed on a lagging RPC node (step 16); the fix is not yet re-run live.
- **No arbitrary contract calls**, on purpose: a right granted inside one could survive the sale.
- **Static NFT metadata.** Fixtures in `packages/cleancheck/test/fixtures/` are synthetic and labelled so.

## 30-second judge check

No wallet, no keys:

- Open https://handover-blush.vercel.app/wallet/?id=0. Your browser reads the contract and Sepolia and shows wallet #0 **Clean** (14 issued, Sepolia nonce 14), with a log naming each token transfer.
- Or from a terminal, after `pnpm install` in a clone (22 s measured):

  ```bash
  HANDOVER_CONTRACT=handover-v2-alpha.testnet pnpm --silent --filter @handover/cleancheck cli status 0
  ```

  ```text
    Contract                        handover-v2-alpha.testnet
    Address                         0xeaa892d7d280f5d92f552837fcb9a13518156c59
    Contract next_nonce (issued)    14
    Sepolia nonce (latest)          14
    VERDICT: CLEAN
      - Contract issued 14 signatures (nonces 0-13); Sepolia confirmed nonce is 14. Every signature has been used.
  ```

Full offline suite: `make verify` ([below](#verify-everything-offline-make-verify)).

## Architecture

```text
 browser: web/ (SvelteKit, static)          CLI: packages/cleancheck/bin/handover.ts
   web/src/lib/chain/*  (NEAR, Sepolia,        handover status | verify | snapshot
   Blockscout token index)                                  |
        |                                                   |
        +-------- packages/cleancheck/src (cleanCheck, RPC readers, snapshot verifier)
                              |
              +---------------+----------------+
       NEAR testnet RPC                     Sepolia RPC
       get_wallet, get_sig_log              nonce, balance, broadcast
              |
   Handover contract: contracts/handover/src
     lib.rs     NEP-171/177/178/181, nft_mint, owner and transfer guards
     wallet.rs  request_transfer, request_token_transfer, retry_reserved, release_stuck, on_signed
     market.rs  list, delist, buy
     tx.rs      builds ETH and token transfers, hash, signature assembly
     mpc.rs     MPC request/response types, gas and deposit constants
     views.rs   get_config, get_wallet, get_sig_log, get_listing, list_listings
              |  sign({path, payload_v2, domain_id})
   MPC signer: v1.signer-prod.testnet (NEAR Chain Signatures)
```

There is no backend. Folder by folder, with links to every folder README: [`structure.md`](structure.md).

## Measured results

| Item | Value | How to reproduce |
|---|---|---|
| Contract unit tests | 99 pass | `cargo test --manifest-path contracts/handover/Cargo.toml` |
| Clean-check tests | 136 pass (8 files) | `pnpm --filter @handover/cleancheck test` |
| Web chain-layer tests | 37 pass (4 files) | `pnpm --filter web test` |
| `handover.wasm` | 327837 bytes, SHA-256 `b2a43c5e99f532914a1c5005f9adaab8289d68a5de123383cf649e9feade00c7` (base58 `D2LpdVQXds9qea4B19ba835djiwimDxQWCUgNZXz4ud8`, the deployed code hash) | `make verify` step 4, [`contracts/res/BUILD.md`](contracts/res/BUILD.md) |
| Sepolia gas, token transfers signed by the contract | ERC-20 141,647; ERC-721 148,312; ERC-1155 135,309 (to a new holder) | receipts in [`token-run`](evidence/token-run-2026-11-05.md) steps 4, 7, 8 |
| Sepolia gas, ETH transfer | 21,000 to an existing address; about 24,400 to an EIP-7702 smart account; 204,600 to create a fresh address (Glamsterdam) | `eth_estimateGas`, receipt `0x7995249408ad663f87a161eaca1900ee3af41d454de39b874594e0b03d77ec46` |
| MPC sign round trip from a contract | 5.4 s, 12.9 Tgas burnt | [`evidence/sig-BmLN….json`](evidence/sig-BmLNbqK1tLowB6kpAg5cakJuhUkt3QP7nyMkVAHG85BY.json) |
| `request_transfer` with MPC and `on_signed` | 14.4 Tgas burnt (8 receipts), first deployment | NEAR tx `9JQoqVcLb8DUYz7dRT8XjayKW4ToJ5kT5rCzmyudGyRM` |
| `buy` | 5.0 Tgas burnt; seller received exactly the price, first deployment | NEAR tx `DLsK85AMxt9dhHv4GfhVbpEt7qF7agUCRnKffQcrAMQ2` |
| Fixed constants | sign fee 0.01 NEAR (+1 yocto to MPC), mint fee 0.05 NEAR, `release_stuck` after 300 blocks, ETH `gas_limit` 21000 to 300000, token `gas_limit` up to 500000 | [`lib.rs`](contracts/handover/src/lib.rs), [`tx.rs`](contracts/handover/src/tx.rs) |

Not measured yet: storage cost per logged signature on testnet.

## Built during the hackathon vs pre-existing

All project code was written during the hackathon window (first commit 2026-11-03), with AI coding assistance (Claude Code) under the builder's direction. Nothing is carried over from an earlier project. Libraries, with versions pinned in `Cargo.lock` / `pnpm-lock.yaml`:

| Area | Library | Version |
|---|---|---|
| Contract | `near-sdk` (feature `unstable`), `near-contract-standards` | 5.30.0, 5.30.0 |
| Contract | `omni-transaction` (feature `evm`), `hex` | 0.5.0, 0.4.3 |
| Contract tests | `k256`, `rlp` | 0.13.4, 0.6.1 |
| Build | `rustc`, `cargo-near` | 1.96.0, 0.22.0 |
| Clean check | `@noble/hashes`, `@noble/curves` | 2.4.0, 2.4.0 |
| Tooling | `typescript`, `tsx`, `vitest` | 6.0.3, 4.23.15, 5.1.0 |
| Checks | `chainsig.js`, `viem`, `@scure/base` | 1.1.16, 2.57.16, 2.4.0 |
| Web | `svelte`, `@sveltejs/kit`, `@sveltejs/adapter-static`, `vite` | 5.57.3, 3.1.1, 4.0.1, 8.3.5 |
| Web | `@hot-labs/near-connect`, `near-api-js`, `viem` | 0.12.0, 7.4.0, 2.57.16 |

The MPC signer and NFT Chain Keys are third-party and not copied here. Token holdings are read from Blockscout's public API (no key).

**Other project by the same builder** (rule Q-015): **Co-op**, https://github.com/AlphaTechini/co-op, hosted at https://coop.cyberpunkinc.xyz, contract `coop-alpha.testnet`.

## Full setup

### Verify everything offline (`make verify`)

Prerequisites: Rust stable (the `wasm32` target is not needed for tests), Node 22, pnpm 10, GNU make, bash. No keys, no network, no wallet. On Windows (x86_64), `near-sdk`'s test dependency `aws-lc-sys` needs NASM: install it or set `AWS_LC_SYS_PREBUILT_NASM=1`.

```bash
git clone https://github.com/AlphaTechini/handover && cd handover
make verify
```

It installs Node dependencies if `node_modules` is missing, then runs (1) the contract unit tests, (2) the clean-check library tests, (3) the clean-check CLI over every `evidence/snapshots/*.json` and every synthetic fixture, (4) `sha256sum -c` on the committed wasm, and exits non-zero if any step fails. Output on the current tree (Git Bash on Windows; per-file reports shortened to their verdicts except the first, path replaced by `/path/to/handover`):

```text
[1/4] Contract unit tests (cargo test)
test result: ok. 99 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 16.44s

[2/4] Clean-check library tests (vitest)
 Test Files  8 passed (8)
      Tests  136 passed (136)

[3/4] Clean-check verdicts over committed snapshots
Real snapshots (evidence/snapshots):
== /path/to/handover/evidence/snapshots/token-0-final.json ==
  Token                           0
  Contract                        handover-v2-alpha.testnet
  Address                         0xeaa892d7d280f5d92f552837fcb9a13518156c59
  Balance                         0.000031270998426255 ETH (31270998426255 wei)
  Captured                        2026-11-05T20:24:46.186Z
  Signature log entries           14

  Contract next_nonce (issued)    14
  Sepolia nonce (latest)          14
  Sepolia nonce (pending)         14

  VERDICT: CLEAN
    - Contract issued 14 signatures (nonces 0-13); Sepolia confirmed nonce is 14. Every signature has been used.
  expected: clean  OK
(token-1-1-funded.json ... token-1-5-buyer-spent.json, token-2-demo-final.json: CLEAN, expected clean, OK)

Synthetic fixtures (packages/cleancheck/test/fixtures, NOT chain data):
(busy-in-flight.json: BUSY, OK; clean-3-issued.json: CLEAN, OK; dirty-pending.json: DIRTY, OK;
 inconsistent-hash-mismatch.json, inconsistent-missing-nonce.json, inconsistent-wrong-signer.json: INCONSISTENT, OK)

[4/4] Committed wasm matches its sha256
handover.wasm: OK

VERIFY OK in 82s: contract tests pass, clean-check tests pass, 6 synthetic fixtures and 7 real snapshot(s) give the expected verdicts, wasm hash matches.
```

Other targets: `make test` (contract, clean-check and web tests), `make web` (production build), `make checks-offline` (capability checks 3 and 4), `make help`.

### Environment variables

Root `.env` from [`.env.example`](.env.example), read by `make status`, `make snapshot` and `checks/`. None is needed for `make verify`.

| Variable | Meaning | Default |
|---|---|---|
| `NEAR_ACCOUNT_ID` | your testnet account | empty |
| `NEAR_PRIVATE_KEY` | not read; leave blank (near-cli-rs keeps keys in its keychain) | empty |
| `NEAR_RPC` | NEAR testnet RPC | `https://test.rpc.fastnear.com` |
| `MPC_CONTRACT` | MPC signer | `v1.signer-prod.testnet` |
| `PROBE_CONTRACT` | account of the check-2 probe contract | empty |
| `HANDOVER_CONTRACT` | the Handover account (`handover-v2-alpha.testnet`); required by `make status` and `make snapshot` | empty |
| `SEPOLIA_RPC` | Sepolia RPC | `https://ethereum-sepolia-rpc.publicnode.com` |
| `SEPOLIA_FUNDED_ADDRESS` | faucet-funded address (checks 1 and 6) | empty |
| `TOKEN_ID` | token for check 5 | `0` |

`web/.env` from [`web/.env.example`](web/.env.example), all public and inlined into the build: `PUBLIC_HANDOVER_CONTRACT` (required, `handover-v2-alpha.testnet`), `PUBLIC_NEAR_RPC`, `PUBLIC_SEPOLIA_RPC`, `PUBLIC_MPC_CONTRACT`. Rebuild after changing them.

### Run locally

```bash
make install                   # pnpm install --frozen-lockfile
cp .env.example .env           # CLI and capability checks (git-ignored)
cp web/.env.example web/.env   # web app (public values only)
make test                      # all unit tests
make dev                       # web dev server; make web for a static build in web/build
```

The CLI is `pnpm --filter @handover/cleancheck cli <status|verify|snapshot>`, or `make status TOKEN=0` / `make snapshot TOKEN=0`.

### Hosted demo walkthrough

Open https://handover-blush.vercel.app with two NEAR testnet accounts in a browser wallet that supports testnet (for example Meteor) and some Sepolia ETH. Pages: `/`, `/mint/`, `/wallets/`, `/wallet/?id=N`, `/market/`, `/how/`.

1. **Mint** on `/mint/`. *See:* a new token and its Ethereum address.
2. **Fill** the address with Sepolia ETH, and tokens if you have any. *See:* balance and "Tokens in this wallet".
3. **Send** a little ETH first (it pins the address), then a token. *See:* an Etherscan link and a log entry per nonce.
4. **List** for a price. *See:* "Listed, signing frozen"; the market card shows the price and what is included.
5. **Buy** from the second account: run the clean check, then buy (enabled only after a `clean` result in the last 60 seconds). *See:* the NFT, the address and its tokens move to the buyer.
6. **Use:** send a token or **Send everything** to your own address. Back on the seller account, any send fails with `Only the token owner can do this`.

### Deploy

near-cli-rs 0.30.1 syntax (in Windows PowerShell 5.1, escape the quotes inside `json-args` as `\"`). `CONTRACT` is the account to deploy to.

```bash
# 1. Capability checks first (checks/README.md).
# 2. Create and fund the contract account (code storage is about 3.3 NEAR).
near account create-account fund-myself $CONTRACT '5 NEAR' autogenerate-new-keypair save-to-legacy-keychain \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send
# 3. Deploy AND initialise in one transaction (`new` is #[private], so init cannot be front-run).
near contract deploy $CONTRACT use-file contracts/res/handover.wasm \
  with-init-call new json-args '{"mpc_contract_id":"v1.signer-prod.testnet","chain_id":11155111}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
# 4. Use it. Mint (0.05 NEAR), send ETH (0.01 NEAR fee + 1 yocto, 300 Tgas), send a token, list (1 yocto), buy (exact price).
near contract call-function as-transaction $CONTRACT nft_mint json-args '{}' prepaid-gas '100 Tgas' \
  attached-deposit '0.05 NEAR' sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction $CONTRACT request_transfer \
  json-args '{"token_id":"0","to":"0x000000000000000000000000000000000000dEaD","value_wei":"100000000000000","gas_limit":"21000","max_fee_per_gas":"30000000000","max_priority_fee_per_gas":"1000000000"}' \
  prepaid-gas '300 Tgas' attached-deposit '10000000000000000000001 yoctoNEAR' \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction $CONTRACT request_token_transfer \
  json-args '{"token_id":"0","standard":"erc20","token":"0x<token>","to":"0x<recipient>","id":"0","amount":"1000000000000000000","gas_limit":"200000","max_fee_per_gas":"30000000000","max_priority_fee_per_gas":"1000000000"}' \
  prepaid-gas '300 Tgas' attached-deposit '10000000000000000000001 yoctoNEAR' \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction $CONTRACT list json-args '{"token_id":"0","price":"1000000000000000000000000"}' \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction $CONTRACT buy json-args '{"token_id":"0","expected_next_nonce":2}' \
  prepaid-gas '100 Tgas' attached-deposit '1 NEAR' sign-as $BUYER_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send
# 5. Lock the FINAL deploy: delete every key, then save the proof.
near account list-keys $CONTRACT network-config testnet now
near account delete-keys $CONTRACT public-keys ed25519:<KEY> network-config testnet sign-with-legacy-keychain send
curl -s "$NEAR_RPC" -H 'content-type: application/json' -d \
  '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"'"$CONTRACT"'"}}' \
  > evidence/access-keys.txt     # expect "keys":[]
```

Notes: the sign deposit is kept as the fee except 1 yocto forwarded to MPC, and nothing is refunded. Estimate `gas_limit` per recipient (`eth_estimateGas` from the wallet's address). The first transfer must be ETH, because it pins the wallet's address that token transfers are sent from. `expected_next_nonce` is the `next_nonce` the buyer's clean check saw. Locking is irreversible, and a redeploy to a new account changes every wallet address.

### How it works in detail

- **Signing.** `request_transfer` and `request_token_transfer` check ownership, then that the token is not listed, signing, reserved or in a pending transfer call. The contract builds the EIP-1559 transaction itself with the next nonce and the `chain_id` fixed at init, stores it as *reserved*, and asks MPC to sign its hash. No method takes raw calldata. `on_signed` rebuilds the transaction from the reservation, checks the signature, logs it (`get_sig_log`) and advances the nonce. The first accepted signature pins the wallet's address (`eth_address`).
- **Reserved-transaction rule.** MPC can publish a signature even if the callback fails. So a failed attempt keeps its reservation and its nonce, and blocks new requests, `list`, `buy` and transfers until `retry_reserved` signs the identical transaction. If a callback never runs, `release_stuck` (after 300 blocks) clears `in_flight` but keeps the reservation. Any leaked signature therefore authorises a transaction the contract already knows.
- **Transfer calls.** `nft_transfer_call` freezes the wallet until `nft_resolve_transfer` clears the flag on every path.

| Verdict | Meaning |
|---|---|
| `clean` | Log complete, nothing in flight or reserved, Sepolia nonce equals `next_nonce`. Safe to buy. |
| `dirty` | Some logged transactions are not mined yet. Anyone can broadcast them; then the wallet is `clean`. |
| `busy` | A request is in flight, a transaction is reserved, or a transfer call is unresolved. |
| `inconsistent` | The data contradicts itself (log gap, chain ahead of the contract, wrong signer, bad raw bytes). Unsafe. |

### Security model and limits

- **Trust in NEAR's MPC network.** Whoever can break or collude inside it could sign for any derived address.
- **No approvals through the contract.** Only the contract can sign for the address, and it signs only the transfers it built, so no `approve`, `setApprovalForAll`, `permit`, Permit2 message or EIP-7702 delegation can be created for a Handover wallet.
- **The clean check is a point-in-time check.** It holds for a listed wallet because listing freezes signing; the web app re-runs it within 60 seconds of buying.
- **Plain `nft_transfer` gifting carries no clean check.** Recipients should run it before accepting; the safe path is `list` and `buy`.
- **Reserved transactions can lock a token** during an MPC outage, by design: the alternative is a possible unlogged signature.
- **Token behaviour is the token's.** The contract encodes standard calls; a token contract that blocks transfers, charges fees or rebases still behaves that way.
- **Residual limits:** a seller payout to a deleted account stays with the contract; a resolver that runs out of gas leaves a token frozen; a recipient needing more than the gas cap cannot be paid; a signed transfer that the balance cannot cover stays `dirty` until topped up (step 16 of the run); signatures produced by code deployed earlier at the same account are invisible to the log. `handover-v2-alpha.testnet` ran only the committed code (deploy and init in NEAR tx `3qp13HfFp8Gdt8Yu57PRY57EZ6d8pfxeL1Ujcu1BAwQX`).
- **Not audited.** An internal adversarial review led to fixes F0 to F8 (front-run init, `buy` bound to the checked nonce, raw callback parsing, prepaid storage, `release_stuck`, transfer-call lock, fee and gas floors, address pinning). Details per fix: [`docs/CLAIMS.md`](docs/CLAIMS.md) section G.

### Earlier deployment

The first deployment, `handover.handover-alpha.testnet`, is the same design without token transfers: it signs ETH transfers only. The demo video and the first evidence runs (capability checks, token 1, the demo run on token 2) used it. It is locked too ([`evidence/first-deployment-access-keys.txt`](evidence/first-deployment-access-keys.txt)), its wasm is in [`contracts/res/first-deployment/`](contracts/res/first-deployment/), and its evidence is listed in [`evidence/README.md`](evidence/README.md). Tokens sent to its wallets cannot be moved.

### Roadmap

- One approval for several transfers (needs a new contract account, since this one is locked).
- A clean-check rule that every logged transaction has one of the allowed shapes, and unit tests for the token encodings.
- Dynamic token metadata that shows the wallet's address, holdings and verdict.
- CLI: broadcast pending transactions, JSON output.

### Docs index

- [`structure.md`](structure.md): folder map with links to every folder README.
- [`docs/CLAIMS.md`](docs/CLAIMS.md): every claim mapped to code and proof.
- [`evidence/README.md`](evidence/README.md): live runs, transaction hashes, snapshots, key lists.
- [`contracts/handover/README.md`](contracts/handover/README.md): contract methods, guards and storage.
- [`docs/PRD.md`](docs/PRD.md) and [`docs/HACKATHON.md`](docs/HACKATHON.md): the original requirements and the hackathon brief.
