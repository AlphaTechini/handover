# Build record: handover.wasm

Non-reproducible build (no docker). Anyone can rebuild and compare, but byte-identical output
is only expected with the same toolchain and host.

| Item | Value |
|---|---|
| Source | `contracts/handover` (`Cargo.lock` committed) |
| Toolchain | rustc 1.97.0 (2d8144b78 2026-07-07), cargo 1.97.0, target `wasm32-unknown-unknown` |
| near-sdk | 5.30.0 (features `unstable` for `env::ecrecover`), near-contract-standards 5.30.0, omni-transaction 0.5.0 (`evm` only) |
| Builder | cargo-near 0.22.0 (prebuilt release binary), bundled wasm-opt (`-O`, bulk-memory, nontrapping-float-to-int) |
| Size | 316931 bytes (309.5 KiB) |
| SHA-256 | `66deed9e8ad380fac2a7b6bc19b0003ae455e0ffdff6709e36906518dc069eab` |
| Protocol | near-sdk 5.30 declares `min_protocol_version = 88` (testnet only; if deploy fails with a link error, pin near-sdk 5.29.1) |

Command (run in `contracts/handover`):

```bash
cargo near build non-reproducible-wasm --locked --out-dir ../res
```

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
