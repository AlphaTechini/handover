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
