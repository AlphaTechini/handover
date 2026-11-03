import type { Hex, SignedTxRecord } from './types';
import { recoverSigner } from './tx';

/**
 * Recovers the signer of every logged raw transaction and returns one reason per entry that was
 * not signed by `address` (or whose signature cannot be recovered at all).
 */
export function signerRecoveryProblems(address: Hex, sigLog: SignedTxRecord[]): string[] {
  const expected = address.toLowerCase();
  const problems: string[] = [];
  for (const e of [...sigLog].sort((a, b) => a.nonce - b.nonce)) {
    let signer: string | null;
    try {
      signer = recoverSigner(e.rawSignedTxHex);
    } catch {
      signer = null;
    }
    if (signer !== expected) {
      problems.push(`Signed transaction at nonce ${e.nonce} was not signed by this wallet's key.`);
    }
  }
  return problems;
}
