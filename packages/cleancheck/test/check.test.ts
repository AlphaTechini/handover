import { describe, expect, it } from 'vitest';
import { cleanCheck, isClean } from '../src/check';
import type { Hex, SignedTxRecord, WalletInput } from '../src/types';

const hashOf = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}` as Hex;

function rec(nonce: number): SignedTxRecord {
  return {
    nonce,
    to: `0x${'22'.repeat(20)}`,
    valueWei: '1000',
    gasLimit: '21000',
    maxFeePerGas: '3000000000',
    maxPriorityFeePerGas: '1000000000',
    txHash: hashOf(nonce + 1),
    rawSignedTxHex: '0x02',
    signedAtNs: '1700000000000000000',
  };
}

/** Log holding nonces from..to-1, in order. */
function logOf(from: number, to: number): SignedTxRecord[] {
  const out: SignedTxRecord[] = [];
  for (let n = from; n < to; n++) out.push(rec(n));
  return out;
}

const wallet = (nextNonce: number, extra: Partial<WalletInput> = {}): WalletInput => ({
  nextNonce,
  inFlight: false,
  listed: false,
  ...extra,
});

describe('cleanCheck: happy paths', () => {
  it('fresh wallet (nothing issued) with chain nonce 0 is clean', () => {
    const r = cleanCheck(wallet(0), [], { confirmedNonce: 0 });
    expect(r.verdict).toBe('clean');
    expect(isClean(r)).toBe(true);
    expect(r.reasons).toEqual([
      'Contract has issued no signatures and Sepolia confirmed nonce is 0. Nothing is pending.',
    ]);
    expect(r.pending).toEqual([]);
    expect(r.inMempool).toEqual([]);
    expect(r.issuedNonce).toBe(0);
    expect(r.chainNonce).toBe(0);
    expect(r.pendingChainNonce).toBeNull();
  });

  it('3 issued and chain nonce 3 is clean, with the spec reason text', () => {
    const r = cleanCheck(wallet(3), logOf(0, 3), { confirmedNonce: 3 });
    expect(r.verdict).toBe('clean');
    expect(r.reasons).toEqual([
      'Contract issued 3 signatures (nonces 0-2); Sepolia confirmed nonce is 3. Every signature has been used.',
    ]);
    expect(r.pending).toEqual([]);
  });

  it('a single issued signature that is mined is clean with singular wording', () => {
    const r = cleanCheck(wallet(1), logOf(0, 1), { confirmedNonce: 1 });
    expect(r.verdict).toBe('clean');
    expect(r.reasons[0]).toContain('Contract issued 1 signature (nonce 0)');
  });

  it('clean is independent of the pending chain nonce when it equals the confirmed nonce', () => {
    const r = cleanCheck(wallet(3), logOf(0, 3), { confirmedNonce: 3, pendingNonce: 3 });
    expect(r.verdict).toBe('clean');
    expect(r.pendingChainNonce).toBe(3);
    expect(r.inMempool).toEqual([]);
  });
});

describe('cleanCheck: dirty', () => {
  it('3 issued, chain nonce 1: dirty with pending nonces 1 and 2', () => {
    const r = cleanCheck(wallet(3), logOf(0, 3), { confirmedNonce: 1 });
    expect(r.verdict).toBe('dirty');
    expect(r.pending.map((p) => p.nonce)).toEqual([1, 2]);
    expect(r.pending[0]).toEqual(rec(1));
    expect(r.inMempool).toEqual([]);
    expect(r.reasons).toEqual([
      'Contract issued 3 signatures (nonces 0-2); Sepolia confirmed nonce is 1.',
      '2 signed transactions (nonces 1, 2) are not mined yet and could still be broadcast.',
    ]);
  });

  it('3 issued, chain nonce 0: all three pending', () => {
    const r = cleanCheck(wallet(3), logOf(0, 3), { confirmedNonce: 0 });
    expect(r.verdict).toBe('dirty');
    expect(r.pending.map((p) => p.nonce)).toEqual([0, 1, 2]);
  });

  it('pendingNonce marks which pending entries are already in the mempool', () => {
    const r = cleanCheck(wallet(3), logOf(0, 3), { confirmedNonce: 1, pendingNonce: 2 });
    expect(r.verdict).toBe('dirty');
    expect(r.inMempool.map((p) => p.nonce)).toEqual([1]);
    expect(r.pending.map((p) => p.nonce)).toEqual([1, 2]);
    expect(r.pendingChainNonce).toBe(2);
    expect(r.reasons.join(' ')).toContain('already in the Sepolia mempool (nonce 1; pending nonce 2)');
  });

  it('pendingNonce equal to next_nonce puts every pending entry in the mempool', () => {
    const r = cleanCheck(wallet(3), logOf(0, 3), { confirmedNonce: 1, pendingNonce: 3 });
    expect(r.inMempool.map((p) => p.nonce)).toEqual([1, 2]);
    expect(r.reasons.join(' ')).toContain('2 of them are already in the Sepolia mempool');
  });

  it('pending list is sorted by nonce even if the log is not', () => {
    const shuffled = [rec(2), rec(0), rec(1)];
    const r = cleanCheck(wallet(3), shuffled, { confirmedNonce: 0 });
    expect(r.pending.map((p) => p.nonce)).toEqual([0, 1, 2]);
  });
});

describe('cleanCheck: busy', () => {
  it('in flight with nonces matching is busy, not clean', () => {
    const r = cleanCheck(wallet(3, { inFlight: true }), logOf(0, 3), { confirmedNonce: 3 });
    expect(r.verdict).toBe('busy');
    expect(isClean(r)).toBe(false);
    expect(r.reasons).toContain(
      'A signature request is in flight; a new signed transaction may appear.',
    );
  });

  it('in flight with a dirty chain is busy, not dirty', () => {
    const r = cleanCheck(wallet(3, { inFlight: true }), logOf(0, 3), { confirmedNonce: 1 });
    expect(r.verdict).toBe('busy');
    expect(r.pending).toEqual([]);
  });

  it('in flight on a fresh wallet is busy', () => {
    expect(cleanCheck(wallet(0, { inFlight: true }), [], { confirmedNonce: 0 }).verdict).toBe('busy');
  });
});

describe('cleanCheck: inconsistent', () => {
  it('chain nonce ahead of issued signatures is inconsistent', () => {
    const r = cleanCheck(wallet(3), logOf(0, 3), { confirmedNonce: 5 });
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons).toEqual([
      "Sepolia nonce 5 is ahead of the contract's 3 issued signatures: the address moved without a contract signature.",
    ]);
  });

  it('pendingNonce ahead of issued signatures is inconsistent', () => {
    const r = cleanCheck(wallet(3), logOf(0, 3), { confirmedNonce: 1, pendingNonce: 4 });
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons.join(' ')).toContain("Sepolia pending nonce 4 is ahead of the contract's 3 issued signatures");
  });

  it('pendingNonce below confirmed nonce is inconsistent', () => {
    const r = cleanCheck(wallet(3), logOf(0, 3), { confirmedNonce: 2, pendingNonce: 1 });
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons).toEqual(['Sepolia pending nonce 1 is below its confirmed nonce 2.']);
  });

  it('log missing a nonce is inconsistent', () => {
    const r = cleanCheck(wallet(3), [rec(0), rec(2)], { confirmedNonce: 3 });
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons).toEqual(['Signature log is missing nonce 1.']);
  });

  it('log missing several nonces lists them all', () => {
    const r = cleanCheck(wallet(4), [rec(1)], { confirmedNonce: 4 });
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons).toEqual(['Signature log is missing nonces 0, 2, 3.']);
  });

  it('log with a duplicate nonce is inconsistent', () => {
    const r = cleanCheck(wallet(3), [rec(0), rec(1), rec(1), rec(2)], { confirmedNonce: 3 });
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons).toEqual(['Signature log has 2 entries with nonce 1.']);
  });

  it('log with an extra nonce beyond next_nonce is inconsistent', () => {
    const r = cleanCheck(wallet(3), [...logOf(0, 3), rec(3)], { confirmedNonce: 3 });
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons).toEqual([
      'Signature log has nonce 3, but the contract has issued only 3 signatures (next_nonce 3).',
    ]);
  });

  it('a log with entries but next_nonce 0 is inconsistent', () => {
    const r = cleanCheck(wallet(0), [rec(0)], { confirmedNonce: 0 });
    expect(r.verdict).toBe('inconsistent');
  });

  it('log problems take precedence over chain problems and in-flight', () => {
    const r = cleanCheck(wallet(3, { inFlight: true }), [rec(0)], { confirmedNonce: 9 });
    expect(r.verdict).toBe('inconsistent');
    expect(r.reasons).toEqual(['Signature log is missing nonces 1, 2.']);
  });

  it('chain-ahead takes precedence over in-flight', () => {
    const r = cleanCheck(wallet(3, { inFlight: true }), logOf(0, 3), { confirmedNonce: 4 });
    expect(r.verdict).toBe('inconsistent');
  });

  it('inconsistent results carry no pending entries', () => {
    const r = cleanCheck(wallet(3), [rec(0), rec(2)], { confirmedNonce: 0 });
    expect(r.pending).toEqual([]);
    expect(r.inMempool).toEqual([]);
  });
});

describe('cleanCheck: listed flag', () => {
  const cases: Array<[string, WalletInput, SignedTxRecord[], { confirmedNonce: number }]> = [
    ['clean', wallet(2), logOf(0, 2), { confirmedNonce: 2 }],
    ['dirty', wallet(2), logOf(0, 2), { confirmedNonce: 0 }],
    ['busy', wallet(2, { inFlight: true }), logOf(0, 2), { confirmedNonce: 2 }],
    ['inconsistent', wallet(2), logOf(0, 1), { confirmedNonce: 2 }],
  ];
  for (const [verdict, w, log, chain] of cases) {
    it(`does not change a ${verdict} verdict`, () => {
      const unlisted = cleanCheck({ ...w, listed: false }, log, chain);
      const listed = cleanCheck({ ...w, listed: true }, log, chain);
      expect(listed.verdict).toBe(unlisted.verdict);
      expect(listed.reasons).toEqual(unlisted.reasons);
    });
  }
});

describe('cleanCheck: input validation', () => {
  const good = { wallet: wallet(1), log: logOf(0, 1), chain: { confirmedNonce: 1 } };

  it('accepts valid inputs', () => {
    expect(() => cleanCheck(good.wallet, good.log, good.chain)).not.toThrow();
  });

  const badWallets: Array<[string, unknown]> = [
    ['null wallet', null],
    ['negative nextNonce', { nextNonce: -1, inFlight: false, listed: false }],
    ['fractional nextNonce', { nextNonce: 1.5, inFlight: false, listed: false }],
    ['NaN nextNonce', { nextNonce: Number.NaN, inFlight: false, listed: false }],
    ['string nextNonce', { nextNonce: '1', inFlight: false, listed: false }],
    ['unsafe nextNonce', { nextNonce: 2 ** 60, inFlight: false, listed: false }],
    ['non-boolean inFlight', { nextNonce: 1, inFlight: 'no', listed: false }],
    ['non-boolean listed', { nextNonce: 1, inFlight: false, listed: 1 }],
  ];
  for (const [name, w] of badWallets) {
    it(`throws TypeError for ${name}`, () => {
      expect(() => cleanCheck(w as WalletInput, good.log, good.chain)).toThrow(TypeError);
    });
  }

  it('throws TypeError when sigLog is not an array', () => {
    expect(() => cleanCheck(good.wallet, null as unknown as SignedTxRecord[], good.chain)).toThrow(TypeError);
  });

  it('throws TypeError for a sigLog entry without a valid nonce', () => {
    const bad = [{ ...rec(0), nonce: -1 }];
    expect(() => cleanCheck(wallet(1), bad, good.chain)).toThrow(TypeError);
    const missing = [{ ...rec(0), nonce: undefined }] as unknown as SignedTxRecord[];
    expect(() => cleanCheck(wallet(1), missing, good.chain)).toThrow(TypeError);
    const notObject = [null] as unknown as SignedTxRecord[];
    expect(() => cleanCheck(wallet(1), notObject, good.chain)).toThrow(TypeError);
  });

  const badChains: Array<[string, unknown]> = [
    ['null chain', null],
    ['negative confirmedNonce', { confirmedNonce: -1 }],
    ['fractional confirmedNonce', { confirmedNonce: 0.5 }],
    ['string confirmedNonce', { confirmedNonce: '0' }],
    ['negative pendingNonce', { confirmedNonce: 0, pendingNonce: -1 }],
    ['fractional pendingNonce', { confirmedNonce: 0, pendingNonce: 2.5 }],
    ['null pendingNonce', { confirmedNonce: 0, pendingNonce: null }],
  ];
  for (const [name, c] of badChains) {
    it(`throws TypeError for ${name}`, () => {
      expect(() => cleanCheck(good.wallet, good.log, c as typeof good.chain)).toThrow(TypeError);
    });
  }
});

describe('cleanCheck: transfer call and recorded signer', () => {
  it('transfer_call_pending is busy', () => {
    const r = cleanCheck(wallet(2, { transferCallPending: true }), logOf(0, 2), { confirmedNonce: 2 });
    expect(r.verdict).toBe('busy');
    expect(r.reasons).toContain('The NFT is in the middle of a transfer call; its owner may change.');
  });

  it('a recorded ethAddress that differs from the derived address is inconsistent (case-insensitive compare)', () => {
    const recorded = `0x${'ab'.repeat(20)}` as Hex;
    const same = cleanCheck(wallet(1, { ethAddress: recorded }), logOf(0, 1), {
      confirmedNonce: 1,
      derivedAddress: recorded.toUpperCase().replace('0X', '0x') as Hex,
    });
    expect(same.verdict).toBe('clean');
    const diff = cleanCheck(wallet(1, { ethAddress: recorded }), logOf(0, 1), {
      confirmedNonce: 1,
      derivedAddress: `0x${'cd'.repeat(20)}`,
    });
    expect(diff.verdict).toBe('inconsistent');
  });

  it('ethAddress is ignored when no derived address is provided, or when null', () => {
    expect(
      cleanCheck(wallet(1, { ethAddress: `0x${'ab'.repeat(20)}` }), logOf(0, 1), { confirmedNonce: 1 }).verdict,
    ).toBe('clean');
    expect(
      cleanCheck(wallet(1, { ethAddress: null }), logOf(0, 1), {
        confirmedNonce: 1,
        derivedAddress: `0x${'cd'.repeat(20)}`,
      }).verdict,
    ).toBe('clean');
  });
});
