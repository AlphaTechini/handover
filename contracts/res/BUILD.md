# Build record: handover.wasm

Non-reproducible build (no docker). Anyone can rebuild and compare, but byte-identical output
is only expected with the same toolchain and host.

| Item | Value |
|---|---|
| Source | `contracts/handover` (`Cargo.lock` committed) |
| Toolchain | rustc 1.96.0 (ac68faa20 2026-05-25), cargo 1.96.0, target `wasm32-unknown-unknown`, built on Windows x86_64 |
| near-sdk | 5.30.0 (features `unstable` for `env::ecrecover`), near-contract-standards 5.30.0, omni-transaction 0.5.0 (`evm` only) |
| Builder | cargo-near 0.22.0 (prebuilt release binary), bundled wasm-opt (`-O`, bulk-memory, nontrapping-float-to-int) |
| Size | 317592 bytes (310.1 KiB) |
| SHA-256 | `3dc840c8821ce9124e18453b0d2d3159bbd45cf23c18c6785f4079ec8de69513` (base58 `5AAyWq6VDRFvMj7fZH8PipvY5F4MW3nS89qSzMw6rrkz`, the code hash deployed at `handover.handover-alpha.testnet`) |
| Protocol | near-sdk 5.30 declares `min_protocol_version = 88` (testnet only; if deploy fails with a link error, pin near-sdk 5.29.1) |

Command (run in `contracts/handover`):

```bash
cargo near build non-reproducible-wasm --locked --out-dir ../res
```

The deployed wasm was built with `--no-abi` added, on Windows, with `AWS_LC_SYS_PREBUILT_NASM=1` set. On
Windows the ABI step links a native DLL of the contract and fails with `LNK1120` (unresolved NEAR host
functions), so the ABI is not embedded in this wasm. `handover_abi.json` is the ABI generated on Linux
from the earlier build; the method names and arguments did not change since, only the accepted
`gas_limit` range.

(cargo-near prebuilt: `https://github.com/near/cargo-near/releases/download/cargo-near-v0.22.0/cargo-near-x86_64-unknown-linux-gnu.tar.gz`;
`cargo install cargo-near` fails on hosts without libudev headers.)

Plain-cargo fallback (no wasm-opt, larger output):

```bash
CARGO_ENCODED_RUSTFLAGS=$'-C\x1flink-arg=-s\x1f--cfg\x1fnear' \
  cargo build --target wasm32-unknown-unknown --release
```

Do not use `-C target-cpu=mvp`.

Files here: `handover.wasm`, `handover.wasm.sha256`, `handover_abi.json` (ABI, also embedded in
the wasm).

Verify: `cd contracts/res && sha256sum -c handover.wasm.sha256`
