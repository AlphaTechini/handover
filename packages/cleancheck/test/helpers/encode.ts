import { keccak256Hex } from '../../src/address';
import { bytesToHex, hexToBytes } from '../../src/bytes';
import type { Hex } from '../../src/types';

// Test-only encoders. The package itself only needs decoding.

export type RlpInput = Uint8Array | RlpInput[];

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function lengthPrefix(len: number, shortBase: number, longBase: number): Uint8Array {
  if (len <= 55) return Uint8Array.of(shortBase + len);
  const hex = len.toString(16);
  const lenBytes = hexToBytes(hex.length % 2 ? `0${hex}` : hex);
  return concat([Uint8Array.of(longBase + lenBytes.length), lenBytes]);
}

export function rlpEncode(item: RlpInput): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0]! < 0x80) return item;
    return concat([lengthPrefix(item.length, 0x80, 0xb7), item]);
  }
  const payload = concat(item.map(rlpEncode));
  return concat([lengthPrefix(payload.length, 0xc0, 0xf7), payload]);
}

/** Minimal big-endian bytes of a non-negative integer (0 is the empty string). */
export function scalarBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array();
  const hex = n.toString(16);
  return hexToBytes(hex.length % 2 ? `0${hex}` : hex);
}

export interface TxFields {
  chainId: bigint;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: Hex;
  value: bigint;
  /** Signature components. Not verified by the package; any bytes are accepted. */
  r: Uint8Array;
  s: Uint8Array;
  /** 0 or 1. Defaults to 0. */
  yParity?: 0 | 1;
}

/** Builds a signed EIP-1559 raw transaction (0x02 || rlp([...12 fields])) as 0x-hex. */
export function buildRawTx(f: TxFields): Hex {
  const payload = rlpEncode([
    scalarBytes(f.chainId),
    scalarBytes(BigInt(f.nonce)),
    scalarBytes(f.maxPriorityFeePerGas),
    scalarBytes(f.maxFeePerGas),
    scalarBytes(f.gasLimit),
    hexToBytes(f.to),
    scalarBytes(f.value),
    new Uint8Array(), // data: plain transfer
    [], // access list
    f.yParity === 1 ? Uint8Array.of(1) : new Uint8Array(),
    stripZeros(f.r),
    stripZeros(f.s),
  ]);
  return `0x02${bytesToHex(payload)}` as Hex;
}

function stripZeros(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length && b[i] === 0) i++;
  return b.subarray(i);
}

export function txHashOf(raw: Hex): Hex {
  return keccak256Hex(hexToBytes(raw));
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 (Bitcoin alphabet) encoder for test vectors. */
export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)]! + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}
