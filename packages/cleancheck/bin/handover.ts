#!/usr/bin/env tsx
import { readFile, writeFile } from 'node:fs/promises';
import {
  assertSnapshot,
  captureSnapshot,
  ethAddressFromMpcKey,
  fetchMpcDerivedKey,
  formatReport,
  runCleanCheck,
  verifySnapshot,
  type Snapshot,
} from '../src/index';

const USAGE = `usage:
  handover status <token_id>            live check (needs HANDOVER_CONTRACT)
  handover verify <snapshot.json...>    offline check of saved snapshots
  handover snapshot <token_id> <out.json>   capture a live snapshot

env:
  HANDOVER_CONTRACT   NEAR contract account (required for status and snapshot)
  NEAR_RPC            default https://rpc.testnet.near.org
  SEPOLIA_RPC         default https://ethereum-sepolia-rpc.publicnode.com
  MPC_CONTRACT        default v1.signer-prod.testnet`;

const DEFAULTS = {
  nearRpc: 'https://rpc.testnet.near.org',
  sepoliaRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  mpc: 'v1.signer-prod.testnet',
};

class UsageError extends Error {}

function parseTokenId(v: string | undefined): string {
  if (v === undefined || !/^\d+$/.test(v)) throw new UsageError(`token_id must be a decimal number, got ${String(v)}`);
  return v;
}

function requireContract(): string {
  const c = process.env.HANDOVER_CONTRACT;
  if (!c) throw new UsageError('HANDOVER_CONTRACT is not set');
  return c;
}

function color(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}

async function deriveAddress(nearRpc: string, mpc: string, contract: string, tokenId: string) {
  const key = await fetchMpcDerivedKey(nearRpc, mpc, contract, `handover-${tokenId}`);
  return ethAddressFromMpcKey(key);
}

async function status(args: string[]): Promise<number> {
  const tokenId = parseTokenId(args[0]);
  const contract = requireContract();
  const nearRpc = process.env.NEAR_RPC ?? DEFAULTS.nearRpc;
  const sepoliaRpc = process.env.SEPOLIA_RPC ?? DEFAULTS.sepoliaRpc;
  const mpc = process.env.MPC_CONTRACT ?? DEFAULTS.mpc;

  const address = await deriveAddress(nearRpc, mpc, contract, tokenId);
  const report = await runCleanCheck({ nearRpc, sepoliaRpc, contractId: contract, tokenId, address });
  console.log(
    formatReport(
      {
        contractId: contract,
        tokenId,
        address,
        balanceWei: report.balanceWei,
        result: report,
        sigLogLength: report.sigLog.length,
      },
      { color: color() },
    ),
  );
  return 0;
}

async function verify(args: string[]): Promise<number> {
  if (args.length === 0) throw new UsageError('verify needs at least one snapshot file');
  let allOk = true;
  for (const [i, file] of args.entries()) {
    if (i > 0) console.log('');
    console.log(`== ${file} ==`);
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    assertSnapshot(parsed);
    const snap: Snapshot = parsed;
    const result = verifySnapshot(snap);
    const expected = snap.expect ?? 'clean';
    const ok = result.verdict === expected;
    allOk &&= ok;
    console.log(
      formatReport(
        {
          contractId: snap.contractId,
          tokenId: snap.tokenId,
          address: snap.address,
          balanceWei: BigInt(snap.chain.balanceWei),
          result,
          synthetic: snap.synthetic,
          note: snap.note,
          capturedAt: snap.capturedAt,
          sigLogLength: snap.sigLog.length,
        },
        { color: color() },
      ),
    );
    console.log(
      `  expected: ${expected}  ${ok ? 'OK' : `MISMATCH (got ${result.verdict})`}`,
    );
  }
  return allOk ? 0 : 1;
}

async function snapshotCmd(args: string[]): Promise<number> {
  const tokenId = parseTokenId(args[0]);
  const out = args[1];
  if (!out) throw new UsageError('snapshot needs an output path');
  const contract = requireContract();
  const nearRpc = process.env.NEAR_RPC ?? DEFAULTS.nearRpc;
  const sepoliaRpc = process.env.SEPOLIA_RPC ?? DEFAULTS.sepoliaRpc;
  const mpc = process.env.MPC_CONTRACT ?? DEFAULTS.mpc;

  const address = await deriveAddress(nearRpc, mpc, contract, tokenId);
  const snap = await captureSnapshot({ nearRpc, sepoliaRpc, contractId: contract, tokenId, address });
  await writeFile(out, `${JSON.stringify(snap, null, 2)}\n`);
  console.log(`Wrote snapshot for token ${tokenId} (${snap.sigLog.length} log entries) to ${out}`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'status':
      return status(rest);
    case 'verify':
      return verify(rest);
    case 'snapshot':
      return snapshotCmd(rest);
    default:
      console.error(USAGE);
      return cmd === undefined || cmd === '--help' || cmd === '-h' ? 0 : 2;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
