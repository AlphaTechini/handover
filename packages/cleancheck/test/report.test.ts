import { describe, expect, it } from 'vitest';
import { formatEth, formatReport } from '../src/report';
import { cleanCheck } from '../src/check';
import { fromSignedTxView, fromWalletView } from '../src/convert';
import { range, SYNTHETIC_ADDRESS, syntheticTx, syntheticWallet } from './helpers/fixture';

describe('formatEth', () => {
  it('formats wei as trimmed decimal ETH', () => {
    expect(formatEth(0n)).toBe('0');
    expect(formatEth(1n)).toBe('0.000000000000000001');
    expect(formatEth(1_500_000_000_000_000_000n)).toBe('1.5');
    expect(formatEth(2n * 10n ** 18n)).toBe('2');
    expect(formatEth(10n ** 17n)).toBe('0.1');
  });
});

describe('formatReport', () => {
  const sigs = range(0, 3).map((n) => syntheticTx(n));
  const result = cleanCheck(fromWalletView(syntheticWallet(3)), sigs.map(fromSignedTxView), {
    confirmedNonce: 1,
    pendingNonce: 2,
  });
  const input = {
    tokenId: '0',
    address: SYNTHETIC_ADDRESS,
    balanceWei: 1_000_000_000_000_000_000n,
    result,
  };

  it('prints the verdict, nonces and pending list without colour by default', () => {
    const out = formatReport(input);
    expect(out).toContain('VERDICT: DIRTY');
    expect(out).toContain('Contract next_nonce (issued)');
    expect(out).toContain('Pending signed transactions (2):');
    expect(out).toContain(sigs[1]!.tx_hash);
    expect(out).not.toContain('\x1b[');
  });

  it('adds ANSI colour only when asked', () => {
    expect(formatReport(input, { color: true })).toContain('\x1b[');
  });

  it('flags synthetic snapshots prominently', () => {
    const out = formatReport({ ...input, synthetic: true, note: 'test note' });
    expect(out.split('\n')[0]).toContain('SYNTHETIC FIXTURE');
    expect(out).toContain('test note');
  });

  it('omits the pending section when nothing is pending', () => {
    const clean = cleanCheck(fromWalletView(syntheticWallet(3)), sigs.map(fromSignedTxView), {
      confirmedNonce: 3,
    });
    const out = formatReport({ ...input, result: clean });
    expect(out).not.toContain('Pending signed transactions');
    expect(out).toContain('VERDICT: CLEAN');
  });
});
