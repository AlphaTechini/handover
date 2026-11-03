import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSnapshot, captureSnapshot, verifySnapshot, type Snapshot } from '../src/snapshot';
import { SEPOLIA_CHAIN_ID } from '../src/tx';
import type { SignedTxView, Verdict } from '../src/types';
import { buildRawTx, txHashOf } from './helpers/encode';
import { installMockRpc } from './helpers/mock-rpc';
import {
  range,
  SYNTHETIC_ADDRESS,
  SYNTHETIC_CONTRACT,
  syntheticSnapshot,
  syntheticTx,
  syntheticWallet,
} from './helpers/fixture';

const fixturesDir = join(import.meta.dirname, 'fixtures');

afterEach(() => {
  vi.unstubAllGlobals();
});

function cleanSnapshot(): Snapshot {
  return syntheticSnapshot({
    nextNonce: 3,
    sigLog: range(0, 3).map((n) => syntheticTx(n)),
    confirmedNonce: 3,
    pendingNonce: 3,
  });
}

/** Rebuilds a log entry around a custom raw transaction, with a consistent tx_hash. */
function entryFromRaw(nonce: number, raw: `0x${string}`, overrides: Partial<SignedTxView> = {}): SignedTxView {
  return { ...syntheticTx(nonce), raw_signed_tx_hex: raw, tx_hash: txHashOf(raw), ...overrides };
}

const rawTx = (over: Partial<Parameters<typeof buildRawTx>[0]> = {}) =>
  buildRawTx({
    chainId: SEPOLIA_CHAIN_ID,
    nonce: 1,
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 3_000_000_000n,
    gasLimit: 21000n,
    to: `0x${'22'.repeat(20)}`,
    value: 1_000_000_000_000_000n,
    r: new Uint8Array(32).fill(1),
    s: new Uint8Array(32).fill(2),
    ...over,
  });

describe('committed fixtures', () => {
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

  it('contains the expected fixtures', () => {
    expect(files.sort()).toEqual([
      'busy-in-flight.json',
      'clean-3-issued.json',
      'dirty-pending.json',
      'inconsistent-hash-mismatch.json',
      'inconsistent-missing-nonce.json',
    ]);
  });

  for (const file of files) {
    it(`${file} is labelled synthetic and verifies to its expected verdict`, () => {
      const snap: unknown = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
      assertSnapshot(snap);
      expect(snap.synthetic).toBe(true);
      expect(snap.note).toMatch(/NOT chain data/);
      expect(verifySnapshot(snap).verdict).toBe(snap.expect as Verdict);
    });
  }
});

describe('verifySnapshot', () => {
  it('a consistent clean snapshot is clean', () => {
    const r = verifySnapshot(cleanSnapshot());
    expect(r.verdict).toBe('clean');
    expect(r.reasons[0]).toContain('Every signature has been used');
  });

  it('a tx_hash that does not match the raw bytes is inconsistent', () => {
    const snap = cleanSnapshot();
    snap.sigLog[1]!.tx_hash = `0x${'cd'.repeat(32)}`;
    const r = verifySnapshot(snap);
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons.join('\n')).toMatch(/Signature log nonce 1: tx_hash .* does not equal keccak256/);
  });

  it('a raw transaction that encodes a different nonce is inconsistent', () => {
    const snap = cleanSnapshot();
    snap.sigLog[1] = entryFromRaw(1, rawTx({ nonce: 5 }));
    const r = verifySnapshot(snap);
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons.join('\n')).toContain('Signature log nonce 1: the raw transaction encodes nonce 5.');
  });

  it('a log value that differs from the raw transaction is inconsistent', () => {
    const snap = cleanSnapshot();
    snap.sigLog[0] = { ...snap.sigLog[0]!, value_wei: '999' };
    const r = verifySnapshot(snap);
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons.join('\n')).toMatch(/Signature log nonce 0: value_wei is 999 in the log/);
  });

  it('a log "to" that differs from the raw transaction is inconsistent', () => {
    const snap = cleanSnapshot();
    snap.sigLog[2] = { ...snap.sigLog[2]!, to: `0x${'33'.repeat(20)}` };
    const r = verifySnapshot(snap);
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons.join('\n')).toMatch(/Signature log nonce 2: to is/);
  });

  it('a raw transaction on another chain is inconsistent', () => {
    const snap = cleanSnapshot();
    snap.sigLog[0] = entryFromRaw(0, rawTx({ nonce: 0, chainId: 1n }));
    const r = verifySnapshot(snap);
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons.join('\n')).toContain('chain id is 1, not Sepolia');
  });

  it('raw bytes that are not a signed EIP-1559 transaction are inconsistent', () => {
    const snap = cleanSnapshot();
    snap.sigLog[0] = { ...snap.sigLog[0]!, raw_signed_tx_hex: '0x0102', tx_hash: txHashOf('0x0102') };
    const r = verifySnapshot(snap);
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons.join('\n')).toMatch(/does not decode as a signed EIP-1559/);
  });

  it('non-hex raw bytes are inconsistent rather than thrown', () => {
    const snap = cleanSnapshot();
    snap.sigLog[0] = { ...snap.sigLog[0]!, raw_signed_tx_hex: '0xzz' as `0x${string}` };
    const r = verifySnapshot(snap);
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons.join('\n')).toContain('not valid hex');
  });

  it('integrity failures override a busy verdict', () => {
    const snap = syntheticSnapshot({
      nextNonce: 3,
      inFlight: true,
      sigLog: range(0, 3).map((n) => syntheticTx(n)),
      confirmedNonce: 3,
    });
    expect(verifySnapshot(snap).verdict).toBe('busy');
    snap.sigLog[0]!.tx_hash = `0x${'00'.repeat(32)}`;
    expect(verifySnapshot(snap).verdict).toBe('inconsistent');
  });

  it('structural problems in the log are reported with the cleanCheck reasons', () => {
    const snap = syntheticSnapshot({
      nextNonce: 3,
      sigLog: [syntheticTx(0), syntheticTx(2)],
      confirmedNonce: 3,
    });
    const r = verifySnapshot(snap);
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons[0]).toBe('Signature log is missing nonce 1.');
  });
});

describe('assertSnapshot', () => {
  const valid = cleanSnapshot();

  it('accepts a well-formed snapshot', () => {
    expect(() => assertSnapshot(valid)).not.toThrow();
  });

  const breaks: Array<[string, (s: any) => void]> = [
    ['wrong kind', (s) => (s.kind = 'other')],
    ['unsupported version', (s) => (s.version = 2)],
    ['non-boolean synthetic', (s) => (s.synthetic = 'yes')],
    ['bad address', (s) => (s.address = '0x1234')],
    ['missing wallet', (s) => delete s.wallet],
    ['sigLog not an array', (s) => (s.sigLog = {})],
    ['missing chain', (s) => delete s.chain],
    ['balance not decimal', (s) => (s.chain.balanceWei = '1.5')],
    ['unknown expect verdict', (s) => (s.expect = 'maybe')],
  ];
  for (const [name, mutate] of breaks) {
    it(`rejects a snapshot with ${name}`, () => {
      const s = structuredClone(valid) as any;
      mutate(s);
      expect(() => assertSnapshot(s)).toThrow(TypeError);
    });
  }

  it('rejects non-objects', () => {
    expect(() => assertSnapshot(null)).toThrow(TypeError);
    expect(() => assertSnapshot('snapshot')).toThrow(TypeError);
  });
});

describe('captureSnapshot', () => {
  const params = {
    nearRpc: 'https://near.synthetic.test',
    sepoliaRpc: 'https://eth.synthetic.test',
    contractId: SYNTHETIC_CONTRACT,
    tokenId: '0',
    address: SYNTHETIC_ADDRESS,
  };

  it('builds a non-synthetic snapshot from NEAR and Sepolia state', async () => {
    installMockRpc({
      wallets: { '0': syntheticWallet(3) },
      sigLogs: { '0': range(0, 3).map((n) => syntheticTx(n)) },
      eth: { latest: 1, pending: 2, balance: 42n },
    });
    const snap = await captureSnapshot({ ...params, note: 'unit test' });
    expect(snap).toMatchObject({
      kind: 'handover-snapshot',
      version: 1,
      synthetic: false,
      contractId: SYNTHETIC_CONTRACT,
      tokenId: '0',
      address: SYNTHETIC_ADDRESS,
      note: 'unit test',
      chain: { confirmedNonce: 1, pendingNonce: 2, balanceWei: '42' },
    });
    expect(snap.sigLog).toHaveLength(3);
    expect(Number.isNaN(Date.parse(snap.capturedAt))).toBe(false);
    expect(verifySnapshot(snap).verdict).toBe('dirty');
  });

  it('throws when the wallet does not exist', async () => {
    installMockRpc({ wallets: {}, sigLogs: {}, eth: { latest: 0, pending: 0, balance: 0n } });
    await expect(captureSnapshot(params)).rejects.toThrow(/no wallet/);
  });
});
