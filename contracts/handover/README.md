# Handover contract

Rust NEAR contract (`near-sdk` 5.30.0, `near-contract-standards` 5.30.0, `omni-transaction` 0.5.0
`evm` only). An NFT (NEP-171/177/178/181) where each token controls its own Ethereum (Sepolia)
address through NEAR Chain Signatures, plus a one-call atomic sale.

There is no owner, no admin method, no config setter and no upgrade path. Delete the account's
full-access keys after the final deploy and nobody can change the contract.

```bash
cargo test                                   # 99 unit tests (Windows: set AWS_LC_SYS_PREBUILT_NASM=1)
cargo clippy --all-targets -- -D warnings
cargo near build non-reproducible-wasm --locked --out-dir ../res
```

## Methods

| Method | Caller | Deposit | Notes |
|---|---|---|---|
| `new(mpc_contract_id, chain_id)` | init, `#[private]` | - | only the contract account can initialise (deploy + init in one batch); testnet: `v1.signer-prod.testnet`, `11155111` |
| `nft_mint()` | anyone | >= 0.05 NEAR (`mint_fee`) | sequential ids `"0"`, `"1"`; keeps measured storage + 1500 bytes prepaid per-token buffer (0.015 NEAR), refunds the rest |
| `request_transfer(token_id, to, value_wei, gas_limit, max_fee_per_gas, max_priority_fee_per_gas)` | owner | > 0.01 NEAR (`sign_fee` + 1 yocto at least) | attach 300 Tgas; the contract keeps `sign_fee`, the REST goes to MPC `sign`; no refund |
| `request_token_transfer(token_id, standard, token, to, id, amount, gas_limit, max_fee_per_gas, max_priority_fee_per_gas)` | owner | same as `request_transfer` | `standard` is `erc20`, `erc721` or `erc1155`; the contract encodes ERC-20 `transfer`, ERC-721 / ERC-1155 `safeTransferFrom` from the wallet's pinned address (one ETH transfer first); `gas_limit` 21000 to 500000 |
| `retry_reserved(token_id)` | owner | > 0.01 NEAR | re-requests a signature for the identical reserved transaction; same deposit rule |
| `release_stuck(token_id)` | owner | exactly 1 yocto | only while `in_flight` and block height > `reserved.requested_at_block` + `release_after_blocks` (300) |
| `on_signed(token_id, nonce)` | contract only | - | MPC callback; reads the raw promise result itself, never panics, returns `SignedTxView` or null |
| `list(token_id, price)` / `delist(token_id)` | owner | exactly 1 yocto | listing freezes signing |
| `buy(token_id, expected_next_nonce)` | anyone | exactly `price` | NFT moves, seller paid exactly `price`, one call; fails if `next_nonce != expected_next_nonce` |
| `nft_*` | standard | standard | `nft_transfer`/`nft_transfer_call` also refuse listed, in-flight, reserved or transfer-call-pending tokens; `nft_resolve_transfer` is overridden to clear the pending flag |
| `get_config`, `get_wallet`, `get_sig_log(token_id, from_index?, limit?)`, `get_listing`, `list_listings(from_index?, limit?)` | anyone | - | log page default 50, max 100 |

`get_config` returns `mpc_contract_id`, `chain_id`, `path_prefix`, `sign_fee`, `mint_fee`,
`release_after_blocks`. `get_wallet` adds `transfer_call_pending`, `eth_address` (the address pinned
by the first accepted signature, `0x` lowercase, or null) and `reserved.requested_at_block`.

### Deposits

- `nft_mint`: attach >= 0.05 NEAR. Measured storage cost plus the 0.015 NEAR buffer is kept; the
  rest is refunded. The buffer prepays the bounded per-token state others can create later
  (listing, reservation, owner-set entry for a fresh receiver, transfer-call marker, pinned
  address), so listing and transfers (1 yocto) cannot drain the contract balance.
- `request_transfer` / `retry_reserved`: deposit must exceed 0.01 NEAR. UI default: `sign_fee` + 1
  yocto. The contract keeps `sign_fee` (pays the unbounded signature-log growth) and forwards
  `deposit - sign_fee` to MPC; callers can follow a future MPC fee increase without a contract
  upgrade. Nothing is refunded, so do not over-attach.
- `buy`: exactly the listed price; more or less is rejected, so there is no refund path.

Parameter rules: `to` is `0x` + 40 hex (either case) and not the zero address; `value_wei > 0`;
`21000 <= gas_limit <= 300000`; `max_fee_per_gas >= 1 gwei` (10^9 wei);
`0 < max_priority_fee_per_gas <= max_fee_per_gas`. There is no parameter for calldata, an
access list or a chain id.

## Gas

`request_transfer` / `retry_reserved`: attach 300 Tgas (minimum enforced: 100 Tgas). `sign` gets a
static 50 Tgas plus unused gas (weight 1); `on_signed` gets a static 30 Tgas (weight 0).

## Events (NEP-297)

`EVENT_JSON:{"standard":"handover","version":"1.0.0","event":"<name>","data":[{...}]}` with events
`sign_requested`, `signed`, `sign_failed`, `released`, `listed`, `delisted`, `sold`. NEP-171 `nft_mint` and
`nft_transfer` come from the standards crate.

## Guards (each has a unit test)

| Guard | Why |
|---|---|
| Only the current owner can sign, retry, list, delist; the old owner is refused after `buy` or `nft_transfer` | a seller must not keep control after a sale |
| No signing while listed, in flight, or (for `request_transfer`) while a transaction is reserved | listing freezes signing, so the buyer's clean check cannot be invalidated |
| Reserved transaction (decision D1): a failed or timed-out MPC call leaves the exact transaction reserved for its nonce; only `retry_reserved` can proceed | MPC may have published a signature even though our callback failed; any leaked signature then authorises the same transaction we already know about |
| `list`, `buy`, `nft_transfer`, `nft_transfer_call` refused while in flight or reserved; transfers also refused while listed | the sale cannot happen while a signature might still appear |
| `nft_transfer_call` sets `transfer_call_pending`; while set, `request_transfer`, `retry_reserved`, `list`, `buy`, `nft_transfer`, `nft_transfer_call` panic; `nft_resolve_transfer` clears it on every path | the receiver temporarily owns the token but it may be returned, so it must not be able to obtain signatures in that window |
| `buy` is bound to `expected_next_nonce` and an exact price | a seller who delists, signs and relists moves `next_nonce`, so a buy built from the buyer's earlier clean check fails |
| `on_signed` parses the raw promise result by hand; any parse problem is a recorded `sign_failed` | a changed MPC response shape cannot abort the callback and leave `in_flight` stuck |
| Trust on first use: the first accepted signature pins `eth_address`; a later signature recovering to another address is a failed attempt | a wrong or rotated key can never be logged under this token |
| `release_stuck` (owner, 1 yocto, > 300 blocks after the latest `sign` call, only while in flight) clears `in_flight` and keeps the reservation | recovery if the callback never ran (e.g. out of gas); identical to a failed attempt, so no signature can be forgotten; follow with `retry_reserved` |
| `new` is `#[private]` | no one can front-run initialisation |
| Nonces strictly sequential; a failed call never increments `next_nonce` | the log is dense, so `chain nonce == next_nonce` proves no signed transaction is outstanding |
| Only plain ETH transfers (empty input, empty access list) and three contract-encoded token transfers (`is_allowed_transfer`) | closes standing approvals: no `approve`, `setApprovalForAll`, `permit` or arbitrary call can be signed |
| `r` and `s` stripped of leading zeros | canonical RLP, nodes accept the transaction |
| `buy` pays the seller exactly `price`, moves the NFT and clears approvals in the same call | atomic payment |
| `list` / `delist` require exactly 1 yocto | full-access-key confirmation |
| No admin / upgrade / key-management code | contract is unownable once keys are deleted |

## Clean check (off-chain)

`get_wallet(token_id)` gives `next_nonce`, `in_flight`, `transfer_call_pending`, `reserved`. The wallet is clean when
`reserved == null`, `in_flight == false`, `transfer_call_pending == false` and Sepolia `eth_getTransactionCount(address) == next_nonce`.
`nft_transfer` (gifting) is NOT protected by this: the recipient must run the clean check.

## Trust and limits

- The contract does not know the token's public key, so it cannot check that a returned signature
  belongs to the derived key; it relies on the MPC contract (whose `respond` verifies it). It does
  check that the response is well formed, low-s and recoverable.
- During an `nft_transfer_call` window the wallet is frozen (`transfer_call_pending`), so the
  receiver cannot obtain a signature before the token may return.
- If the seller account of a sale no longer exists (deleted), the payment is lost to this contract.
  Sellers should keep their account alive until a sale completes.
- `gas_limit` must be 21000 to 300000. 21000 covers a transfer to an existing account. Since
  Sepolia's Glamsterdam upgrade (EIP-2780/EIP-8037, 2026-10-06) value sent to an account that does
  not exist yet costs ~207k (183,600 of it for creating the account), and EIP-7702 smart accounts
  run code on receive (~24k). Callers estimate the limit per recipient; a recipient needing more than
  300000 cannot be paid. A revert still consumes the nonce, so it never hides a signature.
- `release_stuck` only unlocks the contract-side flag. The abandoned attempt's signature may still
  exist on chain, which is why the reservation stays and the next signature is for the identical
  payload; it is no escape hatch for changing a reserved transaction.
- Buyers should check the contract account's deploy history and that its access keys are deleted:
  code deployed earlier could have produced signatures the current log does not show.
- A reserved transaction blocks transfers and sales until `retry_reserved` succeeds. If the MPC
  network is down the token stays locked, by design.
