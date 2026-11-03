import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { signTransaction } from 'viem/accounts';
import { bytesToHex } from '../src/bytes';
import { recoverSigner, signingHashOfSignedTx } from '../src/tx';
import { signedTxWithKey, TEST_KEY } from './helpers/signing';

describe('recoverSigner', () => {
  it('recovers the address of a viem-signed EIP-1559 tx (key 0x..01)', async () => {
    const account = privateKeyToAccount(TEST_KEY);
    for (const nonce of [0, 1, 7, 300]) {
      const raw = await signTransaction({
        privateKey: TEST_KEY,
        transaction: {
          type: 'eip1559',
          chainId: 11155111,
          nonce,
          to: '0x000000000000000000000000000000000000dEaD',
          value: 100n,
          gas: 21000n,
          maxFeePerGas: 30_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
        },
      });
      expect(recoverSigner(raw)).toBe(account.address.toLowerCase());
    }
  });

  it('matches the address of key 0x..01', () => {
    expect(recoverSigner(signedTxWithKey(TEST_KEY, 0))).toBe(
      '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
    );
  });

  it('a different key recovers to a different address', () => {
    const k2 = `0x${'00'.repeat(31)}02` as const;
    expect(recoverSigner(signedTxWithKey(k2, 0))).not.toBe(recoverSigner(signedTxWithKey(TEST_KEY, 0)));
  });

  it('matches the contract viem vector signing hash', () => {
    // contracts/handover/src/tests.rs: matches_independent_viem_vector (signature bytes there are fake,
    // so only the signing hash is comparable).
    const raw =
      '0x02f86d83aa36a780843b9aca008506fc23ac0082520894000000000000000000000000000000000000dead6480c001a0c0d51d5f0d0b6d1a0e5b6a4c9b4a2f9f3e2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c9faa000000000000000000000000000000000000000000000000000000000001';
    expect(bytesToHex(signingHashOfSignedTx(raw))).toBe(
      '6f461ed39123624da7f0ac883f71819f2711ed8975bec819dfa2b0ac84cb61c9',
    );
  });

  it('throws on garbage and non-1559 input', () => {
    expect(() => recoverSigner('0x01c0')).toThrow();
    expect(() => recoverSigner('0x')).toThrow();
  });

  it('secp256k1 import sanity', () => {
    expect(secp256k1.getPublicKey(new Uint8Array(32).fill(1)).length).toBe(33);
  });
});
