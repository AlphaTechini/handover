import { describe, expect, it } from 'vitest';
import { fromSignedTxView, fromWalletView } from '../src/convert';
import { decodeSignedTx, rlpDecode, SEPOLIA_CHAIN_ID } from '../src/tx';
import type { SignedTxView, WalletView } from '../src/types';
import { buildRawTx, rlpEncode } from './helpers/encode';
import { syntheticTx, syntheticWallet } from './helpers/fixture';

describe('fromWalletView', () => {
  it('maps snake_case wire fields to the clean-check input', () => {
    const v: WalletView = syntheticWallet(4, true);
    expect(fromWalletView(v)).toEqual({ nextNonce: 4, inFlight: true, listed: false });
  });

  it('treats a non-null listing as listed', () => {
    const v: WalletView = {
      ...syntheticWallet(0),
      listing: { token_id: '0', seller_id: 'seller.test', price: '1', listed_at_ns: '2' },
    };
    expect(fromWalletView(v).listed).toBe(true);
  });

  it('treats a missing listing as not listed', () => {
    const v = { ...syntheticWallet(0) } as Partial<WalletView>;
    delete v.listing;
    expect(fromWalletView(v as WalletView).listed).toBe(false);
  });
});

describe('fromSignedTxView', () => {
  it('maps every field to camelCase', () => {
    const v: SignedTxView = syntheticTx(2);
    expect(fromSignedTxView(v)).toEqual({
      nonce: 2,
      to: v.to,
      valueWei: v.value_wei,
      gasLimit: v.gas_limit,
      maxFeePerGas: v.max_fee_per_gas,
      maxPriorityFeePerGas: v.max_priority_fee_per_gas,
      txHash: v.tx_hash,
      rawSignedTxHex: v.raw_signed_tx_hex,
      signedAtNs: v.signed_at_ns,
    });
  });
});

describe('rlpDecode', () => {
  it('round-trips nested lists and strings of several lengths', () => {
    const items = [
      new Uint8Array(),
      new Uint8Array([0x7f]),
      new Uint8Array([0x80]),
      new Uint8Array(55).fill(1),
      new Uint8Array(56).fill(2),
      new Uint8Array(300).fill(3),
      [new Uint8Array([9]), [new Uint8Array([1, 2])]],
    ];
    for (const item of items) {
      const decoded = rlpDecode(rlpEncode(item));
      expect(rlpEncode(decoded)).toEqual(rlpEncode(item));
    }
  });

  it('rejects non-canonical single bytes', () => {
    expect(() => rlpDecode(Uint8Array.of(0x81, 0x05))).toThrow(/non-canonical/);
  });

  it('rejects trailing bytes and truncated items', () => {
    expect(() => rlpDecode(Uint8Array.of(0x01, 0x02))).toThrow(/trailing/);
    expect(() => rlpDecode(Uint8Array.of(0x83, 0x01))).toThrow(/exceeds/);
  });
});

describe('decodeSignedTx', () => {
  const to = `0x${'ab'.repeat(20)}` as const;

  it('decodes the fields of a signed EIP-1559 transaction', () => {
    const raw = buildRawTx({
      chainId: SEPOLIA_CHAIN_ID,
      nonce: 7,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_500_000_000n,
      gasLimit: 21000n,
      to,
      value: 123456789012345678n,
      r: new Uint8Array(32).fill(5),
      s: new Uint8Array(32).fill(6),
    });
    expect(decodeSignedTx(raw)).toEqual({
      type: 2,
      chainId: SEPOLIA_CHAIN_ID,
      nonce: 7,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_500_000_000n,
      gasLimit: 21000n,
      to,
      value: 123456789012345678n,
    });
  });

  it('decodes zero-valued fields (empty RLP strings)', () => {
    const raw = buildRawTx({
      chainId: SEPOLIA_CHAIN_ID,
      nonce: 0,
      maxPriorityFeePerGas: 0n,
      maxFeePerGas: 0n,
      gasLimit: 0n,
      to,
      value: 0n,
      r: new Uint8Array(),
      s: new Uint8Array(),
    });
    const d = decodeSignedTx(raw);
    expect(d.nonce).toBe(0);
    expect(d.value).toBe(0n);
  });

  it('rejects non-type-2 payloads and malformed lists', () => {
    expect(() => decodeSignedTx('0x01c0')).toThrow(/type 0x02/);
    const twelveShort = `0x02${Buffer.from(rlpEncode([new Uint8Array([1])])).toString('hex')}`;
    expect(() => decodeSignedTx(twelveShort)).toThrow(/12-field/);
  });

  it('rejects a non-canonical integer with a leading zero byte', () => {
    const payload = rlpEncode([
      new Uint8Array([0x01]),
      new Uint8Array([0x00, 0x05]), // nonce with leading zero
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(20),
      new Uint8Array(),
      new Uint8Array(),
      [],
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(),
    ]);
    const raw = `0x02${Buffer.from(payload).toString('hex')}`;
    expect(() => decodeSignedTx(raw)).toThrow(/non-canonical/);
  });
});
