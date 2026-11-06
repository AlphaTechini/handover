# packages/cleancheck

`@handover/cleancheck`: the clean check as a TypeScript library and CLI. It answers one question about a
Handover wallet: can any signature the contract ever issued still be broadcast? The web app, the CLI and
`make verify` all run this same code.

Decision: the verdict logic is a pure function over plain data ([`src/check.ts`](src/check.ts)), and RPC
reading is separate ([`src/rpc.ts`](src/rpc.ts)). That keeps the rules unit-testable without a network,
lets saved snapshots be re-checked offline, and lets the browser reuse it unchanged. The tradeoff is that
a snapshot is a point in time; a live check must be re-run right before buying.

## Where things are

- To find the verdict rules (`clean`, `dirty`, `busy`, `inconsistent`), visit [`src/check.ts`](src/check.ts).
- To find the NEAR and Sepolia reads and the full live check (`runCleanCheck`), visit [`src/rpc.ts`](src/rpc.ts).
- To find snapshot capture and offline verification (each logged transaction against its raw bytes), visit [`src/snapshot.ts`](src/snapshot.ts).
- To find signer recovery for logged transactions, visit [`src/signers.ts`](src/signers.ts) and [`src/tx.ts`](src/tx.ts).
- To find the Ethereum address derivation from the MPC public key, visit [`src/address.ts`](src/address.ts).
- The CLI (`status`, `verify`, `snapshot`) can be found in [`bin/handover.ts`](bin/handover.ts); report formatting in [`src/report.ts`](src/report.ts).
- Tests are in [`test/`](test/); the synthetic fixtures (labelled `SYNTHETIC`, not chain data) and their generator are in [`test/fixtures/`](test/fixtures/).

## Run

```bash
pnpm --filter @handover/cleancheck test
HANDOVER_CONTRACT=handover-v2-alpha.testnet pnpm --silent --filter @handover/cleancheck cli status 0
pnpm --silent --filter @handover/cleancheck cli verify "$PWD/evidence/snapshots/token-0-final.json"
```
