// Regenerates the synthetic snapshot fixtures in this directory.
// Every fixture is hand-made: signatures are fake, the address and recipient are placeholder
// values, and the snapshot is labelled "synthetic": true. Tx hashes are keccak256 of the raw bytes.
//   run: pnpm --filter @handover/cleancheck fixtures
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Snapshot } from '../../src/snapshot';
import { range, syntheticSnapshot, syntheticTx } from '../helpers/fixture';

const dir = import.meta.dirname;

const fixtures: Record<string, Snapshot> = {
  // 3 signatures issued, all 3 mined.
  'clean-3-issued.json': syntheticSnapshot({
    nextNonce: 3,
    sigLog: range(0, 3).map((n) => syntheticTx(n)),
    confirmedNonce: 3,
    pendingNonce: 3,
    expect: 'clean',
  }),
  // 3 signatures issued, only nonce 0 mined; nonce 1 is in the mempool, nonce 2 is not.
  'dirty-pending.json': syntheticSnapshot({
    nextNonce: 3,
    sigLog: range(0, 3).map((n) => syntheticTx(n)),
    confirmedNonce: 1,
    pendingNonce: 2,
    expect: 'dirty',
  }),
  // All issued signatures mined, but a new signature request is in flight.
  'busy-in-flight.json': syntheticSnapshot({
    nextNonce: 3,
    inFlight: true,
    sigLog: range(0, 3).map((n) => syntheticTx(n)),
    confirmedNonce: 3,
    pendingNonce: 3,
    expect: 'busy',
  }),
  // The log is missing nonce 1, so it cannot be trusted.
  'inconsistent-missing-nonce.json': syntheticSnapshot({
    nextNonce: 3,
    sigLog: [0, 2].map((n) => syntheticTx(n)),
    confirmedNonce: 3,
    expect: 'inconsistent',
  }),
  // Nonce 2's tx_hash was altered after signing; it no longer matches its raw bytes.
  'inconsistent-hash-mismatch.json': syntheticSnapshot({
    nextNonce: 3,
    sigLog: [
      syntheticTx(0),
      syntheticTx(1),
      syntheticTx(2, { tx_hash: `0x${'ab'.repeat(32)}` }),
    ],
    confirmedNonce: 3,
    expect: 'inconsistent',
  }),
};

for (const [name, snap] of Object.entries(fixtures)) {
  await writeFile(join(dir, name), `${JSON.stringify(snap, null, 2)}\n`);
  console.log(`wrote ${name}`);
}
