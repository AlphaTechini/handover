# Check 2 probe: MPC sign from a contract

A minimal NEAR contract that asks the MPC signer `v1.signer-prod.testnet` for a
secp256k1 signature over an EIP-1559 (Sepolia) payload, and returns the MPC response
from its callback. `checks/02-mpc-sign.ts` reads that callback result.

The contract is a copy of the probe from the research phase. Its `nft_part.rs` is an
NFT scaffold that the check does not use. It is kept so the crate matches the probe
that was verified.

## What it does

`request_transfer(token_id, to, value_wei)` (payable, attach at least 1 yocto):

1. Builds the EIP-1559 tx for `nonce = next_nonce` with omni-transaction (chain 11155111,
   gas 21000, maxFee 30 gwei, priority 1 gwei, no data).
2. Hashes the unsigned payload with keccak256.
3. Calls `sign` on the MPC contract with
   `{"request": {"path": "handover-<token_id>", "payload_v2": {"Ecdsa": "<64 hex, no 0x>"}, "domain_id": 0}}`,
   1 yocto attached, 50 Tgas static, unused-gas weight 1.
4. `on_signed` callback (30 Tgas) returns `SignResult`:
   `{ nonce, payload_hash, response (SignatureResponse as the MPC sent it), raw_tx_hex, tx_hash }`.

The probe does not reserve the transaction before signing and does not consume the
nonce on a failed callback. The real contract must do both (SPEC D1). This crate only
measures the MPC round trip.

## Verified here (offline)

```bash
cd checks/02-mpc-sign
cargo test          # 3 tests: exact sign args, callback success and failure, fixed-vector payload
cargo check         # native build
```

`fixed_vector_payload_matches_viem` asserts that omni-transaction produces the same
payload hex and keccak hash as viem `serializeTransaction` for the fixed tx that
`checks/04-omni-tx.ts` uses. This is the cross-implementation check.

## Build the wasm

Option A, cargo-near 0.22.0 (matches the research; prebuilt binary):

```bash
curl -sSL https://github.com/near/cargo-near/releases/download/cargo-near-v0.22.0/cargo-near-x86_64-unknown-linux-gnu.tar.gz | tar xz
export PATH="$PWD/cargo-near-x86_64-unknown-linux-gnu:$PATH"    # adjust to where you extracted it
cargo near build non-reproducible-wasm                           # -> target/near/mpc_sign_probe.wasm
```

Option B, plain cargo (research fallback; no wasm-opt):

```bash
CARGO_ENCODED_RUSTFLAGS=$'-C\x1flink-arg=-s\x1f--cfg\x1fnear' \
  cargo build --target wasm32-unknown-unknown --release
# -> target/wasm32-unknown-unknown/release/mpc_sign_probe.wasm
```

Do not use `-C target-cpu=mvp`. near-sdk 5.30 needs NEAR protocol 88, which testnet ran on
2026-11-01 according to a third-party report. If deploy fails with a link error, pin
`near-sdk = "=5.29.1"` and `near-sdk-env = "=0.1.6"` and record the change.

## Deploy (testnet)

From the repo root, load your settings first: `set -a; . ./.env; set +a`
(`.env` is git-ignored; it is created from `.env.example`).

```bash
near contract deploy $PROBE_CONTRACT use-file checks/02-mpc-sign/target/near/mpc_sign_probe.wasm \
  with-init-call new_default_meta json-args '{"owner_id":"'$NEAR_ACCOUNT_ID'"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send
```

`new_default_meta` takes only `owner_id`. Create the probe account first, for example
with `near account create-account sponsor-by-faucet-service $PROBE_CONTRACT autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`.

## Request a signature

```bash
near contract call-function as-transaction $PROBE_CONTRACT request_transfer \
  json-args '{"token_id":"check","to":"0x000000000000000000000000000000000000dEaD","value_wei":"100000000000000"}' \
  prepaid-gas '300 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send
```

- Deposit: 1 yocto. The MPC `sign` call requires exactly that (research: `SIGN_DEPOSIT_YOCTONEAR = 1`).
  The probe itself asserts at least 1 yocto. A lower deposit fails in the probe before it reaches MPC,
  so it does not test MPC. Record the exact deposit you used in `evidence/`.
- Gas: 300 Tgas attached. Research measured about 14 Tgas burnt in total on testnet (third-party report).
- `token_id` `check` gives path `handover-check`. `checks/02-mpc-sign.ts` derives and prints the key
  for `(PROBE_CONTRACT, handover-check)`.

The command prints a transaction hash. Copy it.

## Read the result (check 2 proper)

From the repo root:

```bash
pnpm --filter checks check:2 -- --parse <tx_hash>
```

This reads the transaction over NEAR RPC (`EXPERIMENTAL_tx_status`), checks the MPC
response (scheme, 33-byte big_r with 02/03 prefix, 32-byte s, recovery_id 0 or 1,
payload hash), and prints the latency (callback block time minus request block time)
and the gas burnt by each receipt. A valid response is saved to
`evidence/sig-<tx_hash>.json`. Check 3 uses that file (`--sig`) to recover the address.

Running `check:2` with no `--parse` prints the commands above and the live derived key,
then exits 2, since that mode gives no verdict.

## Expected evidence (fill in from your run; do not copy these placeholders)

- `derived_public_key` for `(PROBE_CONTRACT, handover-check)`
- the request transaction hash and the deposit used
- gas burnt (total and per receipt) and latency in seconds
- the response fields: scheme, big_r prefix, s length, recovery_id

If the callback returns `null`, the MPC call timed out or its respond failed. Note that
in `evidence/` and retry. Kill criterion from the PRD: if no signature comes back by
2026-11-05, stop and tell the human.
