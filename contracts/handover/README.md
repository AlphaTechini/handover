# Handover contract

Rust NEAR contract (`near-sdk` 5.30.0, `near-contract-standards` 5.30.0, `omni-transaction` 0.5.0
`evm` only). An NFT (NEP-171/177/178/181) where each token controls its own Ethereum (Sepolia)
address through NEAR Chain Signatures, plus a one-call atomic sale.

There is no owner, no admin method, no config setter and no upgrade path. Delete the account's
full-access keys after the final deploy and nobody can change the contract.

```bash
cargo test                                   # 67 unit tests
cargo clippy --all-targets -- -D warnings
cargo near build non-reproducible-wasm --locked --out-dir ../res
```

## Methods

| Method | Caller | Deposit | Notes |
|---|---|---|---|
| `new(mpc_contract_id, chain_id)` | init | - | testnet: `v1.signer-prod.testnet`, `11155111` |
| `nft_mint()` | anyone | >= 0.05 NEAR (`mint_fee`) | sequential ids `"0"`, `"1"`; charges measured storage, refunds the rest |
| `request_transfer(token_id, to, value_wei, gas_limit, max_fee_per_gas, max_priority_fee_per_gas)` | owner | >= 0.01 NEAR (`sign_fee`) | attach 300 Tgas; 1 yocto goes to MPC; excess over `sign_fee` refunded |
| `retry_reserved(token_id)` | owner | >= 0.01 NEAR | re-requests a signature for the identical reserved transaction |
| `on_signed(token_id, nonce)` | contract only | - | MPC callback, never panics, returns `SignedTxView` or null |
| `list(token_id, price)` / `delist(token_id)` | owner | exactly 1 yocto | listing freezes signing |
| `buy(token_id)` | anyone | >= price | NFT moves, seller paid exactly `price`, excess refunded, one call |
| `nft_*` | standard | standard | `nft_transfer`/`nft_transfer_call` also refuse listed, in-flight or reserved tokens |
| `get_config`, `get_wallet`, `get_sig_log(token_id, from_index?, limit?)`, `get_listing`, `list_listings(from_index?, limit?)` | anyone | - | log page default 50, max 100 |

Parameter rules: `to` is `0x` + 40 hex (either case); `value_wei > 0`; `21000 <= gas_limit <= 100000`;
fees > 0 and `max_priority_fee_per_gas <= max_fee_per_gas`. There is no parameter for calldata, an
access list or a chain id.

## Gas

`request_transfer` / `retry_reserved`: attach 300 Tgas (minimum enforced: 100 Tgas). `sign` gets a
static 50 Tgas plus unused gas (weight 1); `on_signed` gets a static 30 Tgas (weight 0).

## Events (NEP-297)

`EVENT_JSON:{"standard":"handover","version":"1.0.0","event":"<name>","data":[{...}]}` with events
`sign_requested`, `signed`, `sign_failed`, `listed`, `delisted`, `sold`. NEP-171 `nft_mint` and
`nft_transfer` come from the standards crate.

## Guards (each has a unit test)

| Guard | Why |
|---|---|
| Only the current owner can sign, retry, list, delist; the old owner is refused after `buy` or `nft_transfer` | a seller must not keep control after a sale |
| No signing while listed, in flight, or (for `request_transfer`) while a transaction is reserved | listing freezes signing, so the buyer's clean check cannot be invalidated |
| Reserved transaction (decision D1): a failed or timed-out MPC call leaves the exact transaction reserved for its nonce; only `retry_reserved` can proceed | MPC may have published a signature even though our callback failed; any leaked signature then authorises the same transaction we already know about |
| `list`, `buy`, `nft_transfer`, `nft_transfer_call` refused while in flight or reserved; transfers also refused while listed | the sale cannot happen while a signature might still appear |
| Nonces strictly sequential; a failed call never increments `next_nonce` | the log is dense, so `chain nonce == next_nonce` proves no signed transaction is outstanding |
| Only plain ETH transfers (empty input, empty access list) | closes standing approvals (ERC-20 `approve` etc.) |
| `r` and `s` stripped of leading zeros | canonical RLP, nodes accept the transaction |
| `buy` needs deposit >= price, pays the seller exactly `price`, refunds excess, moves the NFT and clears approvals in the same call | atomic payment |
| `list` / `delist` require exactly 1 yocto | full-access-key confirmation |
| No admin / upgrade / key-management code | contract is unownable once keys are deleted |

## Clean check (off-chain)

`get_wallet(token_id)` gives `next_nonce`, `in_flight`, `reserved`. The wallet is clean when
`reserved == null`, `in_flight == false` and Sepolia `eth_getTransactionCount(address) == next_nonce`.
`nft_transfer` (gifting) is NOT protected by this: the recipient must run the clean check.

## Trust and limits

- The contract does not know the token's public key, so it cannot check that a returned signature
  belongs to the derived key; it relies on the MPC contract (whose `respond` verifies it). It does
  check that the response is well formed, low-s and recoverable.
- A signature obtained during an `nft_transfer_call` window (receiver holds the token inside
  `nft_on_transfer`) is logged normally; a reverted transfer returns the token with that log entry.
- If the seller account of a sale no longer exists, the payment refunds to this contract.
- A reserved transaction blocks transfers and sales until `retry_reserved` succeeds. If the MPC
  network is down the token stays locked, by design.
