import type {
  ChainInput,
  CleanCheckResult,
  SignedTxRecord,
  Verdict,
  WalletInput,
} from './types';

/**
 * Pure clean check. No I/O.
 *
 * Evaluation order (see SPEC.md "Clean check semantics"):
 *  1. The signature log must hold exactly nonces 0..nextNonce-1, once each.
 *  2. The chain must not be ahead of the contract (confirmed, and pending if given).
 *  3. A signature request in flight is "busy".
 *  4. confirmed < nextNonce is "dirty"; pending = log entries with nonce >= confirmed.
 *  5. Otherwise "clean".
 *
 * Throws TypeError on malformed input.
 */
export function cleanCheck(
  wallet: WalletInput,
  sigLog: SignedTxRecord[],
  chain: ChainInput,
): CleanCheckResult {
  validateInputs(wallet, sigLog, chain);

  const issued = wallet.nextNonce;
  const confirmed = chain.confirmedNonce;
  const pendingNonce = chain.pendingNonce;
  const chainFields = {
    issuedNonce: issued,
    chainNonce: confirmed,
    pendingChainNonce: pendingNonce ?? null,
  };
  const done = (
    verdict: Verdict,
    reasons: string[],
    pending: SignedTxRecord[] = [],
    inMempool: SignedTxRecord[] = [],
  ): CleanCheckResult => ({ verdict, reasons, pending, inMempool, ...chainFields });

  // 1. Signature log integrity.
  const logProblems = checkLog(issued, sigLog);
  if (logProblems.length > 0) return done('inconsistent', logProblems);

  // 2. Chain must not be ahead of what the contract signed.
  const chainProblems: string[] = [];
  if (confirmed > issued) {
    chainProblems.push(
      `Sepolia nonce ${confirmed} is ahead of the contract's ${issued} issued signatures: the address moved without a contract signature.`,
    );
  }
  if (pendingNonce !== undefined) {
    if (pendingNonce < confirmed) {
      chainProblems.push(
        `Sepolia pending nonce ${pendingNonce} is below its confirmed nonce ${confirmed}.`,
      );
    }
    if (pendingNonce > issued) {
      chainProblems.push(
        `Sepolia pending nonce ${pendingNonce} is ahead of the contract's ${issued} issued signatures: the address has transactions the contract never signed.`,
      );
    }
  }
  if (chainProblems.length > 0) return done('inconsistent', chainProblems);

  const summary = issuedSummary(issued, confirmed);

  // 3. A signature request in flight can add a new signed transaction at any moment.
  if (wallet.inFlight) {
    return done('busy', [
      summary,
      'A signature request is in flight; a new signed transaction may appear.',
    ]);
  }

  // 4. Some issued signatures have not been mined.
  if (confirmed < issued) {
    const pending = sigLog
      .filter((e) => e.nonce >= confirmed)
      .sort((a, b) => a.nonce - b.nonce);
    const inMempool =
      pendingNonce === undefined ? [] : pending.filter((e) => e.nonce < pendingNonce);
    const reasons = [summary];
    const n = pending.length;
    const notMined = `${n} signed ${plural(n, 'transaction', 'transactions')} (${nonceWord(pending.map((e) => e.nonce))}) ${plural(n, 'is', 'are')} not mined yet`;
    reasons.push(
      inMempool.length === 0 ? `${notMined} and could still be broadcast.` : `${notMined}.`,
    );
    if (pendingNonce !== undefined && inMempool.length > 0) {
      const m = inMempool.length;
      reasons.push(
        `${m === 1 ? 'One' : String(m)} of them ${plural(m, 'is', 'are')} already in the Sepolia mempool (${nonceWord(inMempool.map((e) => e.nonce))}; pending nonce ${pendingNonce}).`,
      );
    }
    return done('dirty', reasons, pending, inMempool);
  }

  // 5. Clean.
  const reasons =
    issued === 0
      ? ['Contract has issued no signatures and Sepolia confirmed nonce is 0. Nothing is pending.']
      : [`${summary.replace(/\.$/, '')}. Every signature has been used.`];
  return done('clean', reasons);
}

export function isClean(result: CleanCheckResult): boolean {
  return result.verdict === 'clean';
}

// ---------------------------------------------------------------------------

function issuedSummary(issued: number, confirmed: number): string {
  const issuedPart =
    issued === 0
      ? 'Contract has issued no signatures'
      : issued === 1
        ? 'Contract issued 1 signature (nonce 0)'
        : `Contract issued ${issued} signatures (nonces 0-${issued - 1})`;
  return `${issuedPart}; Sepolia confirmed nonce is ${confirmed}.`;
}

function checkLog(issued: number, sigLog: SignedTxRecord[]): string[] {
  const counts = new Map<number, number>();
  for (const e of sigLog) counts.set(e.nonce, (counts.get(e.nonce) ?? 0) + 1);

  const problems: string[] = [];
  const missing: number[] = [];
  for (let n = 0; n < issued; n++) {
    if (!counts.has(n)) missing.push(n);
  }
  if (missing.length > 0) {
    problems.push(
      `Signature log is missing ${missing.length === 1 ? `nonce ${missing[0]}` : `nonces ${missing.join(', ')}`}.`,
    );
  }

  const duplicates = [...counts]
    .filter(([, c]) => c > 1)
    .map(([n]) => n)
    .sort((a, b) => a - b);
  for (const n of duplicates) {
    problems.push(`Signature log has ${counts.get(n)} entries with nonce ${n}.`);
  }

  const extra = [...counts.keys()].filter((n) => n >= issued).sort((a, b) => a - b);
  if (extra.length > 0) {
    problems.push(
      `Signature log has ${extra.length === 1 ? `nonce ${extra[0]}` : `nonces ${extra.join(', ')}`}, but the contract has issued only ${issued} ${plural(issued, 'signature', 'signatures')} (next_nonce ${issued}).`,
    );
  }
  return problems;
}

function validateInputs(wallet: WalletInput, sigLog: SignedTxRecord[], chain: ChainInput): void {
  if (typeof wallet !== 'object' || wallet === null) {
    throw new TypeError('wallet must be an object');
  }
  assertNonNegInt(wallet.nextNonce, 'wallet.nextNonce');
  assertBool(wallet.inFlight, 'wallet.inFlight');
  assertBool(wallet.listed, 'wallet.listed');

  if (!Array.isArray(sigLog)) throw new TypeError('sigLog must be an array');
  for (const [i, e] of sigLog.entries()) {
    if (typeof e !== 'object' || e === null) throw new TypeError(`sigLog[${i}] must be an object`);
    assertNonNegInt(e.nonce, `sigLog[${i}].nonce`);
  }

  if (typeof chain !== 'object' || chain === null) {
    throw new TypeError('chain must be an object');
  }
  assertNonNegInt(chain.confirmedNonce, 'chain.confirmedNonce');
  if (chain.pendingNonce !== undefined) {
    assertNonNegInt(chain.pendingNonce, 'chain.pendingNonce');
  }
}

function assertNonNegInt(v: unknown, name: string): asserts v is number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer, got ${String(v)}`);
  }
}

function assertBool(v: unknown, name: string): asserts v is boolean {
  if (typeof v !== 'boolean') throw new TypeError(`${name} must be a boolean, got ${String(v)}`);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function nonceWord(nonces: number[]): string {
  return `${nonces.length === 1 ? 'nonce' : 'nonces'} ${nonces.join(', ')}`;
}
