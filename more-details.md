# More details

The depth behind the [README](README.md): the full offline run, setup, the deploy runbook, how the
contract works inside, and the security model with its limits.

- [Verify everything offline](#verify-everything-offline-make-verify)
- [Environment variables](#environment-variables)
- [Hosted demo walkthrough](#hosted-demo-walkthrough)
- [Deploy](#deploy)
- [How it works in detail](#how-it-works-in-detail)
- [Security model and limits](#security-model-and-limits)
- [Earlier deployment](#earlier-deployment)

## Verify everything offline (`make verify`)

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

## Environment variables

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

## Hosted demo walkthrough

Open https://handover-blush.vercel.app with two NEAR testnet accounts in a browser wallet that supports testnet (for example Meteor) and some Sepolia ETH. Pages: `/`, `/mint/`, `/wallets/`, `/wallet/?id=N`, `/market/`, `/how/`.

1. **Mint** on `/mint/`. *See:* a new token and its Ethereum address.
2. **Fill** the address with Sepolia ETH, and tokens if you have any. *See:* balance and "Tokens in this wallet".
3. **Send** a little ETH first (it pins the address), then a token. *See:* an Etherscan link and a log entry per nonce.
4. **List** for a price. *See:* "Listed, signing frozen"; the market card shows the price and what is included.
5. **Buy** from the second account: run the clean check, then buy (enabled only after a `clean` result in the last 60 seconds). *See:* the NFT, the address and its tokens move to the buyer.
6. **Use:** send a token or **Send everything** to your own address. Back on the seller account, any send fails with `Only the token owner can do this`.

## Deploy

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

## How it works in detail

- **Signing.** `request_transfer` and `request_token_transfer` check ownership, then that the token is not listed, signing, reserved or in a pending transfer call. The contract builds the EIP-1559 transaction itself with the next nonce and the `chain_id` fixed at init, stores it as *reserved*, and asks MPC to sign its hash. No method takes raw calldata. `on_signed` rebuilds the transaction from the reservation, checks the signature, logs it (`get_sig_log`) and advances the nonce. The first accepted signature pins the wallet's address (`eth_address`).
- **Reserved-transaction rule.** MPC can publish a signature even if the callback fails. So a failed attempt keeps its reservation and its nonce, and blocks new requests, `list`, `buy` and transfers until `retry_reserved` signs the identical transaction. If a callback never runs, `release_stuck` (after 300 blocks) clears `in_flight` but keeps the reservation. Any leaked signature therefore authorises a transaction the contract already knows.
- **Transfer calls.** `nft_transfer_call` freezes the wallet until `nft_resolve_transfer` clears the flag on every path.

| Verdict | Meaning |
|---|---|
| `clean` | Log complete, nothing in flight or reserved, Sepolia nonce equals `next_nonce`. Safe to buy. |
| `dirty` | Some logged transactions are not mined yet. Anyone can broadcast them; then the wallet is `clean`. |
| `busy` | A request is in flight, a transaction is reserved, or a transfer call is unresolved. |
| `inconsistent` | The data contradicts itself (log gap, chain ahead of the contract, wrong signer, bad raw bytes). Unsafe. |

## Security model and limits

- **Trust in NEAR's MPC network.** Whoever can break or collude inside it could sign for any derived address.
- **No approvals through the contract.** Only the contract can sign for the address, and it signs only the transfers it built, so no `approve`, `setApprovalForAll`, `permit`, Permit2 message or EIP-7702 delegation can be created for a Handover wallet. Arbitrary contract calls are not supported on purpose: a right granted inside one could survive the sale.
- **The clean check is a point-in-time check.** It holds for a listed wallet because listing freezes signing; the web app re-runs it within 60 seconds of buying.
- **Plain `nft_transfer` gifting carries no clean check.** Recipients should run it before accepting; the safe path is `list` and `buy`.
- **Reserved transactions can lock a token** during an MPC outage, by design: the alternative is a possible unlogged signature.
- **Token behaviour is the token's.** The contract encodes standard calls; a token contract that blocks transfers, charges fees or rebases still behaves that way.
- **The app's token list comes from Blockscout's public index**, which can lag or miss a contract. Unlisted tokens still belong to the owner and go out through the token form; "Send everything" covers listed tokens only and needs one wallet approval per item. Its ETH step once failed on a lagging RPC node (step 16 of the [run](evidence/token-run-2026-11-05.md)); the fix reads the balance at the last mined block and has not been re-run live yet.
- **Test coverage:** contract unit tests stand in for MPC with a throwaway `k256` key (the real response shape is proven by capability check 2 and the live runs), and the token encodings have no unit tests yet (they are proven by the mined Sepolia transactions). Fixtures in `packages/cleancheck/test/fixtures/` are synthetic and labelled so.
- **Residual limits:** a seller payout to a deleted account stays with the contract; a resolver that runs out of gas leaves a token frozen; a recipient needing more than the gas cap cannot be paid; a signed transfer that the balance cannot cover stays `dirty` until topped up (step 16 of the run); signatures produced by code deployed earlier at the same account are invisible to the log. `handover-v2-alpha.testnet` ran only the committed code (deploy and init in NEAR tx `3qp13HfFp8Gdt8Yu57PRY57EZ6d8pfxeL1Ujcu1BAwQX`).
- **Testnets only, not audited.** NFT metadata is static. An internal adversarial review led to fixes F0 to F8 (front-run init, `buy` bound to the checked nonce, raw callback parsing, prepaid storage, `release_stuck`, transfer-call lock, fee and gas floors, address pinning). Details per fix: [`docs/CLAIMS.md`](docs/CLAIMS.md) section G.

## Earlier deployment

The first deployment, `handover.handover-alpha.testnet`, is the same design without token transfers: it signs ETH transfers only. The demo video and the first evidence runs (capability checks, token 1, the demo run on token 2) used it. It is locked too ([`evidence/first-deployment-access-keys.txt`](evidence/first-deployment-access-keys.txt)), its wasm is in [`contracts/res/first-deployment/`](contracts/res/first-deployment/), and its evidence is listed in [`evidence/README.md`](evidence/README.md). Tokens sent to its wallets cannot be moved.
