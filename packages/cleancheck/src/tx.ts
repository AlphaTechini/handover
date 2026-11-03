import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from './bytes';
import type { Hex } from './types';

/** Sepolia chain id; the contract fixes this in config. */
export const SEPOLIA_CHAIN_ID = 11155111n;

type RlpItem = Uint8Array | RlpItem[];

/** Minimal strict RLP decoder. Rejects non-canonical encodings and trailing bytes. */
export function rlpDecode(bytes: Uint8Array): RlpItem {
  const [item, end] = decodeItem(bytes, 0);
  if (end !== bytes.length) throw new Error('trailing bytes after RLP item');
  return item;
}

function decodeItem(b: Uint8Array, pos: number): [RlpItem, number] {
  if (pos >= b.length) throw new Error('unexpected end of RLP data');
  const p = b[pos]!;
  if (p < 0x80) return [b.slice(pos, pos + 1), pos + 1];
  if (p <= 0xb7) {
    const len = p - 0x80;
    const start = pos + 1;
    const end = checkedEnd(b, start, len);
    if (len === 1 && b[start]! < 0x80) throw new Error('non-canonical single byte string');
    return [b.slice(start, end), end];
  }
  if (p <= 0xbf) {
    const [len, start] = readLongLength(b, pos, p - 0xb7);
    const end = checkedEnd(b, start, len);
    return [b.slice(start, end), end];
  }
  if (p <= 0xf7) {
    const start = pos + 1;
    return decodeList(b, start, checkedEnd(b, start, p - 0xc0));
  }
  const [len, start] = readLongLength(b, pos, p - 0xf7);
  return decodeList(b, start, checkedEnd(b, start, len));
}

function decodeList(b: Uint8Array, start: number, end: number): [RlpItem[], number] {
  const items: RlpItem[] = [];
  let pos = start;
  while (pos < end) {
    const [item, next] = decodeItem(b, pos);
    items.push(item);
    pos = next;
  }
  if (pos !== end) throw new Error('RLP list length mismatch');
  return [items, end];
}

function readLongLength(b: Uint8Array, pos: number, lenOfLen: number): [number, number] {
  const start = pos + 1 + lenOfLen;
  if (start > b.length) throw new Error('truncated RLP length');
  if (b[pos + 1] === 0) throw new Error('non-canonical RLP length');
  let len = 0;
  for (let i = 0; i < lenOfLen; i++) len = len * 256 + b[pos + 1 + i]!;
  if (len < 56) throw new Error('non-canonical RLP length');
  return [len, start];
}

function checkedEnd(b: Uint8Array, start: number, len: number): number {
  const end = start + len;
  if (end > b.length) throw new Error('RLP item exceeds data');
  return end;
}

export interface DecodedSignedTx {
  type: 2;
  chainId: bigint;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  /** Lowercase 0x + 40 hex. */
  to: Hex;
  value: bigint;
}

/**
 * Decodes a signed EIP-1559 (type 0x02) transaction:
 * 0x02 || rlp([chainId, nonce, maxPriorityFee, maxFee, gasLimit, to, value, data, accessList, yParity, r, s]).
 * The signature is not verified here.
 */
export function decodeSignedTx(rawHex: string): DecodedSignedTx {
  const raw = hexToBytes(rawHex);
  if (raw.length < 2 || raw[0] !== 0x02) {
    throw new Error('not an EIP-1559 (type 0x02) transaction');
  }
  const list = rlpDecode(raw.subarray(1));
  if (!Array.isArray(list) || list.length !== 12) {
    throw new Error('transaction payload is not a 12-field list');
  }
  const [chainId, nonce, prio, maxFee, gas, to, value] = list as Uint8Array[];
  for (const f of [chainId, nonce, prio, maxFee, gas, to, value]) {
    if (!(f instanceof Uint8Array)) throw new Error('transaction field is not a byte string');
  }
  if (to!.length !== 20) throw new Error('transaction "to" must be 20 bytes');
  const nonceBig = scalar(nonce!);
  if (nonceBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('nonce too large');
  return {
    type: 2,
    chainId: scalar(chainId!),
    nonce: Number(nonceBig),
    maxPriorityFeePerGas: scalar(prio!),
    maxFeePerGas: scalar(maxFee!),
    gasLimit: scalar(gas!),
    to: `0x${bytesToHex(to!)}`,
    value: scalar(value!),
  };
}

function scalar(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  if (bytes[0] === 0) throw new Error('non-canonical integer (leading zero)');
  return BigInt(`0x${bytesToHex(bytes)}`);
}

function rlpEncode(item: RlpItem): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0]! < 0x80) return item;
    return concat([lengthPrefix(item.length, 0x80), item]);
  }
  const payload = concat(item.map(rlpEncode));
  return concat([lengthPrefix(payload.length, 0xc0), payload]);
}

function lengthPrefix(len: number, base: number): Uint8Array {
  if (len <= 55) return Uint8Array.of(base + len);
  const bytes: number[] = [];
  for (let n = len; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return Uint8Array.of(base + 55 + bytes.length, ...bytes);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function padTo32(b: Uint8Array, name: string): Uint8Array {
  if (b.length > 32) throw new Error(`signature ${name} is longer than 32 bytes`);
  const out = new Uint8Array(32);
  out.set(b, 32 - b.length);
  return out;
}

/**
 * keccak256 of the unsigned payload that a signed EIP-1559 transaction commits to:
 * 0x02 || rlp([chainId, nonce, maxPriority, maxFee, gas, to, value, data, accessList]).
 * Returns raw bytes (32).
 */
export function signingHashOfSignedTx(rawHex: string): Uint8Array {
  const raw = hexToBytes(rawHex);
  if (raw.length < 2 || raw[0] !== 0x02) {
    throw new Error('not an EIP-1559 (type 0x02) transaction');
  }
  const list = rlpDecode(raw.subarray(1));
  if (!Array.isArray(list) || list.length !== 12) {
    throw new Error('transaction payload is not a 12-field list');
  }
  const unsigned = rlpEncode(list.slice(0, 9));
  return keccak_256(concat([Uint8Array.of(0x02), unsigned]));
}

/**
 * Recovers the Ethereum address that signed a raw EIP-1559 transaction (0x-hex), using the
 * (yParity, r, s) in the transaction. Returns the lowercase address.
 * Throws if the transaction does not decode or the signature is not a valid secp256k1 signature.
 */
export function recoverSigner(rawSignedTxHex: string): Hex {
  const raw = hexToBytes(rawSignedTxHex);
  // decodeSignedTx validates the envelope and canonical RLP.
  decodeSignedTx(rawSignedTxHex);
  const list = rlpDecode(raw.subarray(1)) as RlpItem[];
  const [yParity, r, s] = list.slice(9) as Uint8Array[];
  for (const f of [yParity, r, s]) {
    if (!(f instanceof Uint8Array)) throw new Error('signature field is not a byte string');
  }
  if (yParity!.length > 1 || (yParity!.length === 1 && yParity![0]! > 1)) {
    throw new Error('yParity must be 0 or 1');
  }
  const recovery = yParity!.length === 0 ? 0 : yParity![0]!;
  const hash = signingHashOfSignedTx(rawSignedTxHex);
  const sig65 = concat([Uint8Array.of(recovery), padTo32(r!, 'r'), padTo32(s!, 's')]);
  const pub = secp256k1.recoverPublicKey(sig65, hash, { prehash: false }); // 33-byte compressed
  const uncompressed = secp256k1.Point.fromBytes(pub).toBytes(false); // 0x04 || x || y
  return `0x${bytesToHex(keccak_256(uncompressed.subarray(1)).subarray(12))}`;
}
