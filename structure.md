# Repository structure

```text
handover/
├── README.md                  overview, judge check, setup, security model
├── structure.md               this file
├── more-details.md            setup, deploy, contract internals, security model
├── Makefile                   verify, test, build-contract, status, snapshot
├── contracts/
│   ├── handover/              NEAR contract (Rust): NFT, signing, market
│   └── res/                   built wasm and its hash (current and first deployment)
├── packages/
│   └── cleancheck/            clean-check library and CLI (TypeScript)
├── web/                       SvelteKit static app (hosted demo)
├── checks/                    capability checks run before building; MPC probe contract
├── evidence/                  proof from live runs: transactions, snapshots, key lists
└── docs/                      claims table, original requirements, hackathon brief
```

## Where the logic lives

| Logic | Where |
|---|---|
| Who may sign, listing freeze, nonces, the reserved-transaction rule | [`contracts/handover/src/wallet.rs`](contracts/handover/src/wallet.rs) |
| Building ETH and token transfers, hashing, signature assembly | [`contracts/handover/src/tx.rs`](contracts/handover/src/tx.rs) |
| NFT standard, minting, owner and transfer guards | [`contracts/handover/src/lib.rs`](contracts/handover/src/lib.rs) |
| List, delist, buy | [`contracts/handover/src/market.rs`](contracts/handover/src/market.rs) |
| The clean check (verdicts) | [`packages/cleancheck/src/check.ts`](packages/cleancheck/src/check.ts) |
| Reading NEAR and Sepolia for the check | [`packages/cleancheck/src/rpc.ts`](packages/cleancheck/src/rpc.ts) |
| Browser calls to the contract and Sepolia | [`web/src/lib/chain/`](web/src/lib/chain/) |
| Token holdings and token transfer encoding in the app | [`web/src/lib/chain/tokens.ts`](web/src/lib/chain/tokens.ts) |
| Wallet page (verify, send, send everything, list, buy) | [`web/src/routes/wallet/+page.svelte`](web/src/routes/wallet/+page.svelte) |

## Folder READMEs

- [`contracts/handover/README.md`](contracts/handover/README.md): contract methods, guards, storage and limits.
- [`contracts/res/README.md`](contracts/res/README.md): built artifacts and how to check them.
- [`packages/cleancheck/README.md`](packages/cleancheck/README.md): the clean-check library and CLI.
- [`web/README.md`](web/README.md): the web app.
- [`checks/README.md`](checks/README.md): capability checks; [`checks/02-mpc-sign/README.md`](checks/02-mpc-sign/README.md): the MPC probe contract.
- [`evidence/README.md`](evidence/README.md): every live run and what it proves.
- [`docs/README.md`](docs/README.md): claims, requirements and brief.
- [`more-details.md`](more-details.md): setup, deploy, contract internals, security model and limits.
