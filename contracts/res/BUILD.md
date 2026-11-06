# Build record: handover.wasm

Non-reproducible build (no docker). Anyone can rebuild and compare, but byte-identical output
is only expected with the same toolchain and host.

| Item | Value |
|---|---|
| Source | `contracts/handover` (`Cargo.lock` committed) |
| Toolchain | rustc 1.96.0 (ac68faa20 2026-05-25), cargo 1.96.0, target `wasm32-unknown-unknown`, built on Windows x86_64 |
| near-sdk | 5.30.0 (features `unstable` for `env::ecrecover`), near-contract-standards 5.30.0, omni-transaction 0.5.0 (`evm` only) |
| Builder | cargo-near 0.22.0 (prebuilt release binary), bundled wasm-opt (`-O`, bulk-memory, nontrapping-float-to-int) |
| Size | 327837 bytes (320.2 KiB) |
| SHA-256 | `b2a43c5e99f532914a1c5005f9adaab8289d68a5de123383cf649e9feade00c7` (base58 `D2LpdVQXds9qea4B19ba835djiwimDxQWCUgNZXz4ud8`, the code hash deployed at `handover-v2-alpha.testnet`) |
| Protocol | near-sdk 5.30 declares `min_protocol_version = 88` (testnet only; if deploy fails with a link error, pin near-sdk 5.29.1) |

Command (run in `contracts/handover`):

```bash
cargo near build non-reproducible-wasm --locked --out-dir ../res
```

The deployed wasm was built with `--no-abi` added, on Windows, with `AWS_LC_SYS_PREBUILT_NASM=1` set. On
Windows the ABI step links a native DLL of the contract and fails with `LNK1120` (unresolved NEAR host
functions), so no ABI is embedded or committed for this build. The public methods and their arguments
are listed in [`contracts/handover/README.md`](../handover/README.md).

(cargo-near prebuilt: `https://github.com/near/cargo-near/releases/download/cargo-near-v0.22.0/cargo-near-x86_64-unknown-linux-gnu.tar.gz`;
`cargo install cargo-near` fails on hosts without libudev headers.)

Plain-cargo fallback (no wasm-opt, larger output):

```bash
CARGO_ENCODED_RUSTFLAGS=$'-C\x1flink-arg=-s\x1f--cfg\x1fnear' \
  cargo build --target wasm32-unknown-unknown --release
```

Do not use `-C target-cpu=mvp`.

Files here: `handover.wasm`, `handover.wasm.sha256`.

Verify: `cd contracts/res && sha256sum -c handover.wasm.sha256`

## First deployment

[`first-deployment/`](first-deployment/) holds the wasm deployed at `handover.handover-alpha.testnet`, the
first deployment, which signs ETH transfers only (no token transfers). 317592 bytes, SHA-256
`3dc840c8821ce9124e18453b0d2d3159bbd45cf23c18c6785f4079ec8de69513` (base58
`5AAyWq6VDRFvMj7fZH8PipvY5F4MW3nS89qSzMw6rrkz`, its deployed code hash), with the ABI generated for it
on Linux (`handover_abi.json`). Same toolchain and command. Verify with
`cd contracts/res/first-deployment && sha256sum -c handover.wasm.sha256`.
