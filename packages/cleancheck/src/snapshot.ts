import { keccak256Hex } from './address';
import { hexToBytes, isHex } from './bytes';
import { cleanCheck } from './check';
import { fromSignedTxView, fromWalletView } from './convert';
import { signerRecoveryProblems } from './signers';
import { decodeSignedTx, SEPOLIA_CHAIN_ID, type DecodedSignedTx } from './tx';
import { ethBalance, ethNonce, fetchSigLog, fetchWallet } from './rpc';
import type { CleanCheckResult, Hex, SignedTxView, Verdict, WalletView } from './types';

/**
 * Offline snapshot of one wallet: the contract's view, the signature log, and the Sepolia nonces
 * and balance at capture time. Used to verify a clean check without network access.
 */
export interface Snapshot {
  kind: 'handover-snapshot';
  version: 1;
  /** True for hand-made test fixtures. Real captures set this to false. */
  synthetic: boolean;
  note?: string;
  capturedAt: string;
  contractId: string;
  tokenId: string;
  address: Hex;
  wallet: WalletView;
  sigLog: SignedTxView[];
  chain: {
    confirmedNonce: number;
    pendingNonce?: number;
    /** Decimal wei string. */
    balanceWei: string;
  };
  /** Optional expected verdict, checked by `handover verify`. Defaults to "clean". */
  expect?: Verdict;
}

export interface CaptureSnapshotParams {
  nearRpc: string;
  sepoliaRpc: string;
  contractId: string;
  tokenId: string;
  address: Hex;
  note?: string;
}

/** Throws TypeError unless `s` has the snapshot envelope and field types. */
export function assertSnapshot(s: unknown): asserts s is Snapshot {
  if (typeof s !== 'object' || s === null) fail('not an object');
  const o = s as Record<string, unknown>;
  if (o.kind !== 'handover-snapshot') fail('kind must be "handover-snapshot"');
  if (o.version !== 1) fail(`unsupported version ${String(o.version)}`);
  if (typeof o.synthetic !== 'boolean') fail('synthetic must be a boolean');
  if (typeof o.capturedAt !== 'string') fail('capturedAt must be a string');
  if (typeof o.contractId !== 'string') fail('contractId must be a string');
  if (typeof o.tokenId !== 'string') fail('tokenId must be a string');
  if (!isHex(o.address, 20)) fail('address must be 0x + 40 hex');
  if (typeof o.wallet !== 'object' || o.wallet === null) fail('wallet must be an object');
  if (!Array.isArray(o.sigLog)) fail('sigLog must be an array');
  const chain = o.chain as Record<string, unknown> | null | undefined;
  if (typeof chain !== 'object' || chain === null) fail('chain must be an object');
  if (typeof chain.confirmedNonce !== 'number') fail('chain.confirmedNonce must be a number');
  if (typeof chain.balanceWei !== 'string' || !/^\d+$/.test(chain.balanceWei)) {
    fail('chain.balanceWei must be a decimal string');
  }
  if (o.expect !== undefined && !VERDICTS.includes(o.expect as Verdict)) {
    fail(`expect must be one of ${VERDICTS.join(', ')}`);
  }
}

function fail(msg: string): never {
  throw new TypeError(`invalid snapshot: ${msg}`);
}

const VERDICTS: Verdict[] = ['clean', 'dirty', 'busy', 'inconsistent'];

/**
 * Re-runs the clean check on a snapshot and verifies every signed transaction in its log:
 * tx_hash must equal keccak256 of the raw bytes, and the raw transaction must encode the same
 * nonce, chain id (Sepolia), to, value, gas limit and fees as the log entry.
 * Any mismatch makes the verdict "inconsistent".
 *
 * Every signature is also recovered and must come from `s.address`.
 */
export function verifySnapshot(s: Snapshot): CleanCheckResult {
  assertSnapshot(s);
  const base = cleanCheck(fromWalletView(s.wallet), s.sigLog.map(fromSignedTxView), {
    confirmedNonce: s.chain.confirmedNonce,
    pendingNonce: s.chain.pendingNonce,
    derivedAddress: s.address,
  });
  const integrity = [
    ...s.sigLog.flatMap(txIntegrityProblems),
    ...signerRecoveryProblems(s.address, s.sigLog.map(fromSignedTxView)),
  ];
  if (integrity.length === 0) return base;
  return { ...base, verdict: 'inconsistent', reasons: [...integrity, ...base.reasons] };
}

function txIntegrityProblems(e: SignedTxView): string[] {
  const prefix = `Signature log nonce ${String(e.nonce)}:`;
  let raw: Uint8Array;
  try {
    raw = hexToBytes(e.raw_signed_tx_hex);
  } catch {
    return [`${prefix} raw_signed_tx_hex is not valid hex.`];
  }
  const problems: string[] = [];
  const computed = keccak256Hex(raw);
  if (computed !== e.tx_hash.toLowerCase()) {
    problems.push(
      `${prefix} tx_hash ${e.tx_hash} does not equal keccak256 of raw_signed_tx_hex (${computed}).`,
    );
  }

  let d: DecodedSignedTx;
  try {
    d = decodeSignedTx(e.raw_signed_tx_hex);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    problems.push(`${prefix} raw_signed_tx_hex does not decode as a signed EIP-1559 transaction (${msg}).`);
    return problems;
  }

  if (d.nonce !== e.nonce) {
    problems.push(`${prefix} the raw transaction encodes nonce ${d.nonce}.`);
  }
  if (d.chainId !== SEPOLIA_CHAIN_ID) {
    problems.push(`${prefix} the raw transaction chain id is ${d.chainId}, not Sepolia (${SEPOLIA_CHAIN_ID}).`);
  }
  if (e.to.toLowerCase() !== d.to) {
    problems.push(`${prefix} to is ${e.to} in the log but ${d.to} in the raw transaction.`);
  }
  const amounts: Array<[string, string, bigint]> = [
    ['value_wei', e.value_wei, d.value],
    ['gas_limit', e.gas_limit, d.gasLimit],
    ['max_fee_per_gas', e.max_fee_per_gas, d.maxFeePerGas],
    ['max_priority_fee_per_gas', e.max_priority_fee_per_gas, d.maxPriorityFeePerGas],
  ];
  for (const [name, logged, decoded] of amounts) {
    if (!/^\d+$/.test(logged) || BigInt(logged) !== decoded) {
      problems.push(
        `${prefix} ${name} is ${logged} in the log but ${decoded.toString()} in the raw transaction.`,
      );
    }
  }
  return problems;
}

/** Captures a live snapshot from NEAR and Sepolia. Throws if the wallet does not exist. */
export async function captureSnapshot(params: CaptureSnapshotParams): Promise<Snapshot> {
  const { nearRpc, sepoliaRpc, contractId, tokenId, address, note } = params;
  const [wallet, sigLog, confirmedNonce, pendingNonce, balanceWei] = await Promise.all([
    fetchWallet(nearRpc, contractId, tokenId),
    fetchSigLog(nearRpc, contractId, tokenId),
    ethNonce(sepoliaRpc, address, 'latest'),
    ethNonce(sepoliaRpc, address, 'pending'),
    ethBalance(sepoliaRpc, address),
  ]);
  if (wallet === null) {
    throw new Error(`no wallet for token ${tokenId} on contract ${contractId}`);
  }
  const snapshot: Snapshot = {
    kind: 'handover-snapshot',
    version: 1,
    synthetic: false,
    capturedAt: new Date().toISOString(),
    contractId,
    tokenId,
    address,
    wallet,
    sigLog,
    chain: { confirmedNonce, pendingNonce, balanceWei: balanceWei.toString() },
  };
  if (note !== undefined) snapshot.note = note;
  return snapshot;
}
