import { describe, expect, it } from 'vitest';
import { cleanCheck } from '../src/check';
import { fromWalletView } from '../src/convert';
import type { SignedTxRecord, WalletView } from '../src/types';

const rec = (nonce: number): SignedTxRecord => ({
  nonce,
  to: `0x${'22'.repeat(20)}`,
  valueWei: '1',
  gasLimit: '21000',
  maxFeePerGas: '3',
  maxPriorityFeePerGas: '1',
  txHash: `0x${(nonce + 1).toString(16).padStart(64, '0')}` as `0x${string}`,
  rawSignedTxHex: '0x02',
  signedAtNs: '1',
});

describe('reserved transaction', () => {
  it('is busy with the retry reason', () => {
    const r = cleanCheck({ nextNonce: 1, inFlight: false, listed: false, reserved: { nonce: 1 } }, [rec(0)], {
      confirmedNonce: 1,
    });
    expect(r.verdict).toBe('busy');
    expect(r.reasons.at(-1)).toBe(
      'Signing attempt for nonce 1 did not complete; a signature for that exact transaction may exist. The owner must retry it before this wallet can be sold.',
    );
  });
  it('is inconsistent when reserved nonce differs from next nonce', () => {
    const r = cleanCheck({ nextNonce: 1, inFlight: false, listed: false, reserved: { nonce: 0 } }, [rec(0)], {
      confirmedNonce: 1,
    });
    expect(r.verdict).toBe('inconsistent');
  });
  it('in flight keeps its own busy reason', () => {
    const r = cleanCheck({ nextNonce: 0, inFlight: true, listed: false, reserved: { nonce: 0 } }, [], {
      confirmedNonce: 0,
    });
    expect(r.verdict).toBe('busy');
    expect(r.reasons.join(' ')).toContain('in flight');
  });
  it('null or absent reserved does not affect clean', () => {
    for (const reserved of [null, undefined]) {
      expect(cleanCheck({ nextNonce: 0, inFlight: false, listed: false, reserved }, [], { confirmedNonce: 0 }).verdict).toBe('clean');
    }
  });
  it('fromWalletView maps reserved', () => {
    const v: WalletView = {
      token_id: '0', owner_id: 'a.testnet', path: 'handover-0', next_nonce: 2, in_flight: false,
      listing: null, sig_count: 2, minted_at_ns: '1',
      reserved: { nonce: 2, to: '0x' + '22'.repeat(20), value_wei: '1', gas_limit: '21000', max_fee_per_gas: '3',
        max_priority_fee_per_gas: '1', payload_hash_hex: '0x00', requested_at_ns: '1', attempts: 1 },
    };
    expect(fromWalletView(v).reserved).toEqual({ nonce: 2 });
    expect(fromWalletView({ ...v, reserved: null }).reserved).toBeUndefined();
  });
});
