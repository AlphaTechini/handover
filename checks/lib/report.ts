// PASS/FAIL reporting shared by every check.
//
// report() prints a verdict and, for live runs, appends one JSON line to
// evidence/checks.log. Offline self-tests and infrastructure errors (RPC
// unreachable) do not write to the log, so the log only holds real results.
// Evidence fields are sanitised: keys named like secrets are dropped, and any
// string containing the NEAR private key value is redacted.

import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVIDENCE_DIR, EnvError } from './env';

export type Status = 'PASS' | 'FAIL';

export interface ReportInput {
  /** Check id, e.g. "01-funding". */
  id: string;
  status: Status;
  /** One-line summary printed after the verdict. */
  summary: string;
  /** Evidence values to print and log. Secret-looking keys are dropped. */
  evidence?: Record<string, unknown>;
  /** Reasons, printed under FAIL. */
  reasons?: string[];
  /** Set for offline self-tests. Printed, never written to evidence/checks.log. */
  offline?: boolean;
}

export const LOG_FILE = resolve(EVIDENCE_DIR, 'checks.log');

const SECRET_KEY = /private|secret|seed|mnemonic|password|token_key/i;

function redactValue(v: unknown): unknown {
  if (typeof v === 'string') {
    let out = v.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{40,}/g, 'ed25519:<redacted>');
    const k = process.env.NEAR_PRIVATE_KEY?.trim();
    if (k && k.length > 8 && out.includes(k)) out = out.split(k).join('<redacted>');
    return out;
  }
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === 'object') return sanitize(v as Record<string, unknown>);
  return v;
}

export function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = redactValue(v);
  }
  return out;
}

function jsonSafe(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
}

export function report(input: ReportInput): void {
  const evidence = sanitize(input.evidence ?? {});
  const bar = '-'.repeat(60);
  const lines: string[] = [];
  lines.push(bar);
  lines.push(`${input.status}  ${input.id}${input.offline ? '  (offline self-test)' : ''}`);
  lines.push(`      ${input.summary}`);
  for (const [k, v] of Object.entries(evidence)) {
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      lines.push(`      ${k}:`);
      for (const item of v) lines.push(`        - ${item}`);
      continue;
    }
    const shown = typeof v === 'string' ? v : jsonSafe(v);
    lines.push(`      ${k}: ${shown}`);
  }
  if (input.status === 'FAIL' && input.reasons?.length) {
    for (const r of input.reasons) lines.push(`      - ${r}`);
  }
  if (input.offline) lines.push('      (offline self-test: not recorded in evidence/checks.log)');
  lines.push(bar);
  console.log(lines.join('\n'));

  if (input.offline) return;
  try {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      check: input.id,
      status: input.status,
      summary: input.summary,
      evidence,
    };
    appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.error(`warning: could not write ${LOG_FILE}: ${(err as Error).message}`);
  }
}

/** Exit codes: 0 PASS, 1 FAIL, 2 usage or environment error. */
export function exitFor(status: Status): number {
  return status === 'PASS' ? 0 : 1;
}

/** Usage and environment errors print to stderr and exit 2. Anything else is an infrastructure failure, exit 1, not logged. */
export function runMain(id: string, main: () => Promise<number>): void {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      if (err instanceof EnvError) {
        console.error(`${id}: ${err.message}`);
        process.exitCode = 2;
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`FAIL  ${id}`);
      console.error(`      could not complete the check: ${msg}`);
      console.error('      nothing was recorded in evidence/checks.log; fix the cause and re-run.');
      process.exitCode = 1;
    },
  );
}
