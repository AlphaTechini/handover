import type { CleanCheckResult, Hex, SignedTxRecord, Verdict } from './types';

const ETH_DECIMALS = 18;

/** Wei to a decimal ETH string with trailing zeros trimmed, e.g. 1500000000000000000n -> "1.5". */
export function formatEth(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const base = 10n ** BigInt(ETH_DECIMALS);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(ETH_DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toString()}${frac === '' ? '' : `.${frac}`}`;
}

export interface ReportInput {
  contractId?: string;
  tokenId: string;
  address: Hex;
  balanceWei: bigint;
  result: CleanCheckResult;
  /** Snapshot-only fields. */
  synthetic?: boolean;
  note?: string;
  capturedAt?: string;
  sigLogLength?: number;
}

export interface ReportOptions {
  /** ANSI colour for the verdict. Pass true only when stdout is a TTY. */
  color?: boolean;
}

const LABEL_WIDTH = 32;

export function formatReport(input: ReportInput, opts: ReportOptions = {}): string {
  const { result } = input;
  const lines: string[] = [];
  const row = (label: string, value: string) => lines.push(`  ${label.padEnd(LABEL_WIDTH)}${value}`);

  if (input.synthetic) {
    lines.push('*** SYNTHETIC FIXTURE: hand-made for tests, NOT chain data ***');
    if (input.note) lines.push(`    ${input.note}`);
    lines.push('');
  }

  row('Token', input.tokenId);
  if (input.contractId !== undefined) row('Contract', input.contractId);
  row('Address', input.address);
  row('Balance', `${formatEth(input.balanceWei)} ETH (${input.balanceWei.toString()} wei)`);
  if (input.capturedAt !== undefined) row('Captured', input.capturedAt);
  if (input.sigLogLength !== undefined) row('Signature log entries', String(input.sigLogLength));
  lines.push('');

  row('Contract next_nonce (issued)', String(result.issuedNonce));
  row('Sepolia nonce (latest)', String(result.chainNonce));
  row(
    'Sepolia nonce (pending)',
    result.pendingChainNonce === null ? 'not checked' : String(result.pendingChainNonce),
  );
  lines.push('');

  if (result.pending.length > 0) {
    lines.push(`  Pending signed transactions (${result.pending.length}):`);
    lines.push(`    ${'nonce'.padEnd(7)}${'to'.padEnd(44)}${'value (wei)'.padEnd(22)}${'mempool'.padEnd(9)}tx hash`);
    for (const p of result.pending) {
      lines.push(formatPendingLine(p, result));
    }
    lines.push('');
  }

  lines.push(`  VERDICT: ${colorVerdict(result.verdict, opts.color === true)}`);
  for (const r of result.reasons) lines.push(`    - ${r}`);
  return lines.join('\n');
}

function formatPendingLine(p: SignedTxRecord, result: CleanCheckResult): string {
  const inMempool = result.inMempool.some((m) => m.nonce === p.nonce && m.txHash === p.txHash);
  return `    ${String(p.nonce).padEnd(7)}${p.to.padEnd(44)}${p.valueWei.padEnd(22)}${(inMempool ? 'yes' : 'no').padEnd(9)}${p.txHash}`;
}

const COLOURS: Record<Verdict, string> = {
  clean: '\x1b[32m',
  dirty: '\x1b[33m',
  busy: '\x1b[36m',
  inconsistent: '\x1b[31m',
};

function colorVerdict(verdict: Verdict, color: boolean): string {
  const label = verdict.toUpperCase();
  return color ? `${COLOURS[verdict]}\x1b[1m${label}\x1b[0m` : label;
}
