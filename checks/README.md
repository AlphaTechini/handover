# Capability checks

Six small scripts that prove, before the main contract is written, that the pieces the
product depends on work on NEAR testnet and Sepolia. They are run by you, with your own
NEAR account and Sepolia funds. The sandbox that wrote them cannot reach NEAR or Sepolia RPC,
so the live runs have not been done yet. The offline parts have been run.

PRD section 10 is the source of these checks. Do not write the main contract until
checks 1 to 4 pass.

## Setup

```bash
cp .env.example .env          # at the repo root; fill in NEAR_ACCOUNT_ID, PROBE_CONTRACT, ...
pnpm install                  # from the repo root
pnpm --filter checks typecheck
```

Scripts run as `pnpm --filter checks check:<n> [-- args]`. Each one:

- exits 0 on PASS, 1 on FAIL, 2 on a usage or environment error (missing variable, bad argument);
- prints a PASS or FAIL block with its evidence, and never prints a private key;
- appends one JSON line to `evidence/checks.log` for each live verdict (not for offline self-tests,
  and not for an unreachable endpoint, which is reported as an error and recorded nowhere).
  `evidence/` is for your real runs only. The root `.gitignore` ignores `*.log` except
  `evidence/*.log`, so `checks.log` can be committed as evidence.

The failure modes are deliberately loud. A missing variable prints the variable name and points to
`.env.example`. A network error prints the URL and the cause (for example `ENOTFOUND` or a proxy 403)
and exits 1 without a verdict.

## The checks

| Check | Script | Network | What it proves | PASS when |
|---|---|---|---|---|
| 1 | `01-funding.ts [0xSepolia]` | yes | You can fund both sides. | NEAR account exists with balance > 0 and the Sepolia address has balance > 0 |
| 2 | `02-mpc-sign.ts --parse <tx>` | yes | A contract gets a secp256k1 signature from MPC over an EIP-1559 payload, with measured deposit, gas and latency. The contract code is in `02-mpc-sign/`. | The callback returns a well-formed `Secp256k1` response with payload hash |
| 3 | `03-address-agreement.ts [pred] [path] [--sig f]` or `--offline` | yes (live) / no (`--offline`) | The same `(predecessor, path)` gives the same Ethereum address from the live MPC key, from the pinned-root derivation, from chainsig.js, and from a real signature | Every route that ran agrees, and at least two routes ran |
| 4 | `04-omni-tx.ts [--expect h] [--wasm f]` | no | The contract's omni-transaction payload equals viem's, and the wasm is within deploy size | The payload hash matches the pinned vector and the wasm is under 1.5 MiB (if built) |
| 5 | `05-end-to-end.ts [--to 0x]` | yes | A transfer the contract signed is broadcast, mined, and agrees with the contract state | The clean check is `clean` and every signed transaction mined successfully |
| 6 | `06-sepolia-rpc.ts [--address 0x] [--origin u]` | yes | The Sepolia endpoint answers the calls the app needs, at measured latency, accepts `eth_sendRawTransaction`, and passes a CORS preflight | All calls succeed in 10 rounds, chain id is `0xaa36a7`, an invalid raw transaction gets a JSON-RPC error, and the preflight is answered |

### Check 1: funding

`pnpm --filter checks check:1 -- 0xYourSepoliaAddress`. The address can also come from
`SEPOLIA_FUNDED_ADDRESS`. If either side is empty, the check prints the commands:

- NEAR, near-cli-rs 0.30.1 (research section 9):
  `near account create-account sponsor-by-faucet-service <account> autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`
  (on a desktop, `save-to-keychain` works too). Short form: `near create-account <account> --useFaucet --networkId testnet`.
- Sepolia: the Google Cloud Web3 faucet, https://cloud.google.com/application/web3/faucet/ethereum/sepolia
  (about 0.05 ETH per day with a Google account; no mainnet balance needed).

### Check 2: MPC sign from a contract

Build, deploy and call the probe in `02-mpc-sign/` (see `02-mpc-sign/README.md`). Then:

```bash
pnpm --filter checks check:2                       # prints the commands and the live derived key, exits 2
pnpm --filter checks check:2 -- --parse <tx_hash>  # the verdict
```

`--parse` prints latency (callback block time minus request block time), gas burnt per receipt,
and the response fields. It writes `evidence/sig-<tx_hash>.json`.

Kill criterion (PRD section 10): if this check cannot get a signature by **2026-11-05**, stop and
tell the human. The product depends on it.

### Check 3: address agreement

```bash
pnpm --filter checks check:3 -- --offline          # no network; the research vector
pnpm --filter checks check:3 -- handover.testnet handover-0            # live
pnpm --filter checks check:3 -- <predecessor> <path> --sig evidence/sig-<tx>.json
```

Routes:

1. live `derived_public_key` over NEAR RPC, then `ethAddressFromMpcKey` from `@handover/cleancheck`
   (the reference);
2. a pure `@noble` derivation with the pinned testnet root key. Its NAJ must equal the live key.
   Runs only when `MPC_CONTRACT` is `v1.signer-prod.testnet`;
3. chainsig.js 1.1.16 `deriveAddressAndPublicKey`. For this MPC contract it derives locally and makes
   no RPC call, so it cross-checks the maths but not the live key;
4. `recoverAddress` from a real signature (`--sig`).

Known limitation: chainsig.js 1.1.16 does not load under Node 22 ESM in this install. It imports
`@noble/curves/utils`, and its pinned `@noble/curves ^1.9.0` (1.9.1 here) has no such export. The check
reports that route as SKIPPED and still decides on the others. The real fix is a root-level pnpm
override (`@noble/curves` 2.x for chainsig) or a separate install for the cross-check. That touches the
root `package.json`, so it was not done here.

The offline vector (`handover.testnet` + `handover-0` -> `0x9196D767BDFdc03437342D17c3cEA857f473084F`)
is synthetic, from RESEARCH.md. It is not a live account.

### Check 4: omni-transaction and viem (offline)

```bash
pnpm --filter checks check:4                       # payload, hash, and the wasm size if built
pnpm --filter checks check:4 -- --expect <hash>    # compare with a hash from cargo test output
```

The tx is fixed: chain 11155111, nonce 0, to `0x…dEaD`, 0.0001 ETH, gas 21000, maxFee 30 gwei,
priority 1 gwei. The pinned hash `0xef043b27…4699` is the same vector the probe's Rust test asserts.

Size: a deploy transaction carries the wasm, so the binding limit is NEAR's `max_transaction_size` of
1.5 MiB (research section 4). The separate `max_contract_size` is 4 MiB. The check uses 1.5 MiB,
which is the tighter limit. The brief's "~1.5 MB" matches it.

Kill criterion (PRD section 10): if the crate will not build for wasm or is too large, build the tx
off-chain and have the contract verify its fields before signing, and record the change in the README.

### Check 5: end to end

1. Request the transfer with near-cli-rs (the script prints the exact command when nothing is signed yet):

   ```bash
   near contract call-function as-transaction $HANDOVER_CONTRACT request_transfer \
     json-args '{"token_id":"0","to":"0x000000000000000000000000000000000000dEaD","value_wei":"100000000000000","gas_limit":"21000","max_fee_per_gas":"30000000000","max_priority_fee_per_gas":"1000000000"}' \
     prepaid-gas '300 Tgas' attached-deposit '10000000000000000000001 yoctoNEAR' \
     sign-as $NEAR_ACCOUNT_ID network-config testnet sign-with-legacy-keychain send
   ```

   The deposit is the 0.01 NEAR sign fee plus 1 yocto. The contract keeps the fee and forwards the rest (1 yocto) to the MPC contract; nothing is refunded, so do not attach more.
2. Fund the derived address printed by the script with Sepolia ETH (check 1's faucet link).
3. `pnpm --filter checks check:5`

The script derives the address, checks the balance covers the pending transactions, broadcasts
signed transactions that are not mined yet (`nonce too low` and `already known` count as already done),
waits for receipts, writes `evidence/e2e-<timestamp>.json` with the tx hashes, then runs the clean check.

### Check 6: Sepolia RPC

`pnpm --filter checks check:6 -- --address 0xYourAddress`. Ten rounds of each read call are timed. The
invalid `eth_sendRawTransaction` must come back as a JSON-RPC error, not an HTTP error.

The CORS preflight is an approximation. Node does not enforce CORS, so this script only checks that the
endpoint answers an `OPTIONS` request with `Access-Control-Allow-Origin`. The real browser test is the
web app running on its own origin, and that step is still needed.

## Expected output shape

These are the shapes to look for, not values from a real run. Fill in the numbers from your own run.

```text
PASS  02-mpc-sign
      MPC returned a secp256k1 signature to the probe contract.
      latency_seconds: <your number>
      total_gas_tgas: <your number>
```

## What has been run here

Live, on 2026-11-04: checks 1, 2, 3 (with `--sig`), 5 and 6 PASS against NEAR testnet and Sepolia;
the verdicts are in [`evidence/checks.log`](../evidence/checks.log). The probe ran at
`handover-alpha-probe.testnet`; on Windows it was built with
`cargo near build non-reproducible-wasm --locked --no-abi` (the ABI step fails to link there) and
`AWS_LC_SYS_PREBUILT_NASM=1`. Check 5 re-reads the clean check for up to 15 s after the receipts,
because a load-balanced public RPC can answer the nonce query from a node one block behind.

Before that, the sandbox that wrote the scripts could not reach NEAR or Sepolia RPC. Its checks were
run as follows.

- Offline: check 3 `--offline` PASSes against the research vector. Check 4 PASSes with the pinned
  vector. `cargo test` for the probe passes (3 tests, including the omni-vs-viem payload match).
- Against a local mock of the RPC responses (synthetic, not chain data, and its output was deleted):
  the PASS and FAIL paths of checks 1, 2 (`--parse`), 3 (live, and with a signature that disagrees),
  5 (nothing signed, and the broadcast and receipt path) and 6 were exercised. The mock is not
  evidence and is not in the repo.
- Without the network: checks 1, 2, 3 (live) and 6 exit 1 with a clear "could not reach ..." message
  and write nothing to `evidence/`.
