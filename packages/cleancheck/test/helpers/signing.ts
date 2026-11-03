import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '../../src/bytes';
import type { Hex } from '../../src/types';
import { buildRawTx, rlpEncode, scalarBytes } from './encode';

/**
 * THROWAWAY TEST KEY. Private key 0x...01 is public knowledge and controls nothing of value.
 * Its Ethereum address is 0x7e5f4552091a69125d5dfcb7b8c2659029395bdf. Used only to sign synthetic
 * fixtures so that signer recovery can be exercised without a real wallet.
 */
export const TEST_KEY: Hex = `0x${'00'.repeat(31)}01`;
export const TEST_KEY_ADDRESS: Hex = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';

/** Second throwaway key (0x...02), used to produce "wrong signer" fixtures. */
export const OTHER_KEY: Hex = `0x${'00'.repeat(31)}02`;

export interface SignParams {
  chainId?: bigint;
  to: Hex;
  value: bigint;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

/** Signs a plain EIP-1559 transfer with `key` and returns the raw 0x02 transaction. */
export function signedTxWithKey(key: Hex, nonce: number, p?: Partial<SignParams>): Hex {
  const f = {
    chainId: 11155111n,
    to: '0x2222222222222222222222222222222222222222' as Hex,
    value: BigInt(nonce + 1) * 10n ** 15n,
    gasLimit: 21000n,
    maxFeePerGas: 3_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    ...p,
  };
  const unsigned = rlpEncode([
    scalarBytes(f.chainId),
    scalarBytes(BigInt(nonce)),
    scalarBytes(f.maxPriorityFeePerGas),
    scalarBytes(f.maxFeePerGas),
    scalarBytes(f.gasLimit),
    hexToBytes(f.to),
    scalarBytes(f.value),
    new Uint8Array(),
    [],
  ]);
  const payload = new Uint8Array(unsigned.length + 1);
  payload[0] = 0x02;
  payload.set(unsigned, 1);
  const hash = keccak_256(payload);
  const sig = secp256k1.sign(hash, hexToBytes(key), { prehash: false, format: 'recovered' });
  // 'recovered' format: recovery byte, then r (32), then s (32).
  const recovery = sig[0]! as 0 | 1;
  return buildRawTx({
    ...f,
    nonce,
    r: sig.subarray(1, 33),
    s: sig.subarray(33, 65),
    yParity: recovery,
  });
}

export function addressOfKey(key: Hex): Hex {
  const pub = secp256k1.getPublicKey(hexToBytes(key), false);
  return `0x${bytesToHex(keccak_256(pub.subarray(1)).subarray(12))}`;
}
