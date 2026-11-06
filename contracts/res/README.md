# contracts/res

Built contract artifacts. The wasm is committed so anyone can compare it with the deployed code without
rebuilding; the build is not reproducible across machines, so the hash is the reference.

- The current contract's wasm, deployed at `handover-v2-alpha.testnet`, can be found in [`handover.wasm`](handover.wasm), with its SHA-256 in [`handover.wasm.sha256`](handover.wasm.sha256).
- The first deployment's wasm (`handover.handover-alpha.testnet`, ETH transfers only) and its ABI can be found in [`first-deployment/`](first-deployment/).
- To find the toolchain, build command, sizes and hashes, visit [`BUILD.md`](BUILD.md).

Check: `cd contracts/res && sha256sum -c handover.wasm.sha256` (step 4 of `make verify`). The deployed
code hash shown by `near account view-account-summary handover-v2-alpha.testnet network-config testnet now`
is the base58 form of that SHA-256.

Tradeoff: no ABI is committed for the current build, because the ABI step fails to link on Windows
(see [`BUILD.md`](BUILD.md)). The method list is in [`../handover/README.md`](../handover/README.md).
