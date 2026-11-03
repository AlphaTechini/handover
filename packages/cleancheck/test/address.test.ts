import { describe, expect, it } from 'vitest';
import {
  base58Decode,
  ethAddressFromMpcKey,
  keccak256Hex,
  normalizeAddress,
  toChecksumAddress,
} from '../src/address';
import { base58Encode } from './helpers/encode';

// Public key of private key 1 (secp256k1 generator G), uncompressed x||y.
const G_X = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const G_Y = '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';
const G_XY = Uint8Array.from(Buffer.from(G_X + G_Y, 'hex'));
const ADDRESS_OF_KEY_1 = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';

describe('ethAddressFromMpcKey', () => {
  it('maps the public key of private key 1 to its known address (64-byte x||y)', () => {
    expect(ethAddressFromMpcKey(`secp256k1:${base58Encode(G_XY)}`)).toBe(ADDRESS_OF_KEY_1);
  });

  it('accepts the 65-byte form with the 0x04 prefix and gives the same address', () => {
    const prefixed = new Uint8Array(65);
    prefixed[0] = 0x04;
    prefixed.set(G_XY, 1);
    expect(ethAddressFromMpcKey(`secp256k1:${base58Encode(prefixed)}`)).toBe(ADDRESS_OF_KEY_1);
  });

  it('returns a lowercase 0x + 40 hex address', () => {
    const addr = ethAddressFromMpcKey(`secp256k1:${base58Encode(G_XY)}`);
    expect(addr).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('rejects keys without the secp256k1 prefix', () => {
    expect(() => ethAddressFromMpcKey(`ed25519:${base58Encode(G_XY)}`)).toThrow(TypeError);
    expect(() => ethAddressFromMpcKey(base58Encode(G_XY))).toThrow(TypeError);
  });

  it('rejects payloads of the wrong length', () => {
    expect(() => ethAddressFromMpcKey(`secp256k1:${base58Encode(G_XY.subarray(1))}`)).toThrow(/63 bytes|bytes/);
    const bad65 = new Uint8Array(65); // prefix byte is not 0x04
    bad65.set(G_XY, 1);
    expect(() => ethAddressFromMpcKey(`secp256k1:${base58Encode(bad65)}`)).toThrow(TypeError);
  });

  it('rejects characters outside the base58 alphabet', () => {
    expect(() => ethAddressFromMpcKey('secp256k1:0OIl')).toThrow(TypeError);
  });
});

describe('base58Decode', () => {
  it('round-trips bytes including leading zero bytes', () => {
    for (const bytes of [
      new Uint8Array([0, 0, 1, 2, 3]),
      new Uint8Array([0]),
      new Uint8Array([255, 0, 0]),
      G_XY,
    ]) {
      expect(Array.from(base58Decode(base58Encode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('decodes the known vector "2NEpo7TZRRrLZSi2U" to "Hello World!"', () => {
    expect(new TextDecoder().decode(base58Decode('2NEpo7TZRRrLZSi2U'))).toBe('Hello World!');
  });
});

describe('keccak256Hex', () => {
  it('matches the Ethereum keccak256 of empty input', () => {
    expect(keccak256Hex(new Uint8Array())).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
  });
});

describe('toChecksumAddress (EIP-55)', () => {
  it('matches the EIP-55 reference vectors', () => {
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    );
    expect(toChecksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359')).toBe(
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    );
  });

  it('accepts mixed-case input and rejects malformed addresses', () => {
    expect(toChecksumAddress('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED').toLowerCase()).toBe(
      '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
    );
    expect(() => toChecksumAddress('0x1234')).toThrow(TypeError);
    expect(() => toChecksumAddress('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toThrow(TypeError);
  });
});

describe('normalizeAddress', () => {
  it('lowercases a valid address and rejects invalid ones', () => {
    expect(normalizeAddress(ADDRESS_OF_KEY_1.toUpperCase().replace('0X', '0x'))).toBe(ADDRESS_OF_KEY_1);
    expect(() => normalizeAddress('0xzz')).toThrow(TypeError);
  });
});
