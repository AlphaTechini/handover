import type { Hex } from './types';

const HEX_RE = /^(0x)?([0-9a-fA-F]*)$/;

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Parses hex with optional 0x prefix. Throws TypeError on odd length or non-hex characters. */
export function hexToBytes(hex: string): Uint8Array {
  const m = HEX_RE.exec(hex);
  if (!m || m[2]!.length % 2 !== 0) {
    throw new TypeError(`invalid hex string: ${truncate(hex)}`);
  }
  const digits = m[2]!;
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** True if `v` is a 0x-prefixed hex string, optionally with an exact byte length. */
export function isHex(v: unknown, bytes?: number): v is Hex {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]*$/.test(v) || v.length % 2 !== 0) return false;
  return bytes === undefined || v.length === 2 + bytes * 2;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Canonical lowercase 0x-hex form. */
export function toHex(bytes: Uint8Array): Hex {
  return `0x${bytesToHex(bytes)}`;
}

function truncate(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}
