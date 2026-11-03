import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, toHex } from './bytes';
import type { Hex } from './types';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decodes base58 (Bitcoin alphabet, as used by NEAR key strings). Leading '1's become zero bytes. */
export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const digit = BASE58_ALPHABET.indexOf(ch);
    if (digit < 0) throw new TypeError(`invalid base58 character '${ch}'`);
    n = n * 58n + BigInt(digit);
  }
  const tail: number[] = [];
  while (n > 0n) {
    tail.push(Number(n & 0xffn));
    n >>= 8n;
  }
  tail.reverse();
  let leading = 0;
  for (const ch of s) {
    if (ch !== '1') break;
    leading++;
  }
  const out = new Uint8Array(leading + tail.length);
  out.set(tail, leading);
  return out;
}

/** Keccak-256 (Ethereum flavour, not NIST SHA3) of the bytes, as 0x-hex. */
export function keccak256Hex(data: Uint8Array): Hex {
  return toHex(keccak_256(data));
}

/**
 * Ethereum address of a NEAR MPC secp256k1 public key, given as "secp256k1:<base58>".
 * The payload is the uncompressed key without prefix (64 bytes x||y), or with the 0x04 prefix (65 bytes).
 * Returns the lowercase address.
 */
export function ethAddressFromMpcKey(key: string): Hex {
  const m = /^secp256k1:(.+)$/.exec(key);
  if (!m) {
    throw new TypeError(`expected a "secp256k1:<base58>" public key, got ${JSON.stringify(key)}`);
  }
  const raw = base58Decode(m[1]!);
  let xy: Uint8Array;
  if (raw.length === 64) {
    xy = raw;
  } else if (raw.length === 65 && raw[0] === 0x04) {
    xy = raw.subarray(1);
  } else {
    throw new TypeError(
      `secp256k1 public key must be 64 bytes (x||y) or 65 bytes (0x04||x||y), got ${raw.length} bytes`,
    );
  }
  const digest = keccak_256(xy);
  return `0x${bytesToHex(digest.subarray(12))}`;
}

/** EIP-55 checksummed form of an address. */
export function toChecksumAddress(address: string): Hex {
  const lower = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) {
    throw new TypeError(`invalid Ethereum address: ${address}`);
  }
  const body = lower.slice(2);
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(body)));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const c = body[i]!;
    out += c >= 'a' && c <= 'f' && parseInt(hash[i]!, 16) >= 8 ? c.toUpperCase() : c;
  }
  return out as Hex;
}

/** Lowercase address, validated. */
export function normalizeAddress(address: string): Hex {
  const lower = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) {
    throw new TypeError(`invalid Ethereum address: ${address}`);
  }
  return lower as Hex;
}
