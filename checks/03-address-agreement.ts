// Check 3: address agreement. For one (predecessor, path), proves that independent
// routes give the same Ethereum address:
//
//   a. live derived_public_key over NEAR RPC, then ethAddressFromMpcKey
//      (from @handover/cleancheck). The reference route.
//   b. pure @noble derivation with the pinned testnet root key (RESEARCH.md section 2).
//      Its NAJ string must equal the live derived_public_key output. Only when
//      MPC_CONTRACT is v1.signer-prod.testnet, the signer the root key belongs to.
//   c. chainsig.js 1.1.16 deriveAddressAndPublicKey (the reference library). For a known
//      MPC contract id it derives locally from the pinned root and makes no RPC call,
//      so it cross-checks the maths, not the live key.
//   d. optional: the address recovered by viem recoverAddress from a real MPC
//      signature saved by check 2 (--sig evidence/sig-<tx>.json).
//
// chainsig.js (c) can be unavailable: 1.1.16 imports @noble/curves/utils, and its
// pinned @noble/curves ^1.9.0 has no such export. In that case route (c) is reported as
// SKIPPED with the reason, and the other routes still decide the verdict. This needs a
// root-level pnpm override to fix, outside checks/.
//
// Usage:
//   tsx 03-address-agreement.ts --offline
//       Self-test with the research vector (handover.testnet + handover-0). No network.
//       Not recorded in evidence/checks.log.
//   tsx 03-address-agreement.ts [predecessor] [path] [--sig <file>]
//       Live. Defaults: predecessor PROBE_CONTRACT, path "handover-check".
//
// PASS: every route that ran agrees, and at least two routes ran.
// Exit 0 PASS, 1 FAIL, 2 usage/env error.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256, sha3_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';
import { ethAddressFromMpcKey, fetchMpcDerivedKey, toChecksumAddress } from '@handover/cleancheck';
import { createPublicClient, http, recoverAddress, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { getMpcContract, getNearRpc, getProbeContract, getSepoliaRpc, REPO_ROOT, scriptArgs, UsageError } from './lib/env';
import { report, runMain, type Status } from './lib/report';

const ID = '03-address-agreement';
const MPC_TESTNET = 'v1.signer-prod.testnet';
/** Pinned root key of v1.signer-prod.testnet (chainsig.js ROOT_PUBLIC_KEYS.TESTNET). */
export const MPC_ROOT_TESTNET =
  'secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3';
/** Research vector (RESEARCH.md section 2). Synthetic: derived, not a live account. */
const VECTOR = {
  predecessor: 'handover.testnet',
  path: 'handover-0',
  naj: 'secp256k1:4ZE6nid2gYmBdoGrVdyKBbs6LdZ6vRGDLRvcwP1qkxcB4jDJxuMJGybKHpn7BsaMEyo3FrpXcWnCwcPV75A49DEX',
  address: '0x9196D767BDFdc03437342D17c3cEA857f473084F',
};

/** Pure derivation (no RPC): child = root + tweak*G, tweak = SHA3-256("near-mpc-recovery v0.1.0 epsilon derivation:<pred>,<path>"). */
export function deriveNoble(rootNaj: string, predecessor: string, path: string): { naj: string; address: string } {
  const raw = base58.decode(rootNaj.split(':')[1]!);
  if (raw.length !== 64) throw new Error('pinned root key is not 64 bytes');
  const root = secp256k1.Point.fromHex('04' + bytesToHex(raw));
  const tweak = BigInt('0x' + bytesToHex(sha3_256(utf8ToBytes(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`))));
  if (tweak === 0n || tweak >= secp256k1.Point.Fn.ORDER) throw new Error('derivation tweak out of range');
  const child = root.add(secp256k1.Point.BASE.multiply(tweak)).toBytes(false); // 04||X||Y
  return {
    naj: 'secp256k1:' + base58.encode(child.slice(1)),
    address: '0x' + bytesToHex(keccak_256(child.slice(1)).slice(-20)),
  };
}

interface SigFile {
  payload_hash: string;
  response: { big_r: { affine_point: string }; s: { scalar: string }; recovery_id: number };
}

function readSigFile(arg: string): { file: string; sig: SigFile } {
  // Relative paths: try the current directory first, then the repo root (pnpm runs scripts from checks/).
  const file = existsSync(arg) ? resolve(arg) : resolve(REPO_ROOT, arg);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new UsageError(`cannot read --sig file ${file}: ${(err as Error).message}`);
  }
  const j = json as Partial<SigFile>;
  if (!j.payload_hash || !j.response?.big_r?.affine_point || !j.response.s?.scalar || j.response.recovery_id === undefined) {
    throw new UsageError(`--sig file ${file} needs payload_hash and response.{big_r,s,recovery_id} (written by check 2)`);
  }
  return { file, sig: j as SigFile };
}

/** Returns the chainsig.js address, or a reason it could not run. Dynamic import so a load failure does not kill the script. */
async function chainsigAddress(predecessor: string, path: string, mpc: string, rpc: string): Promise<{ address: string } | { skipped: string }> {
  let mod: typeof import('chainsig.js');
  try {
    mod = await import('chainsig.js');
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'import error';
    return { skipped: `chainsig.js 1.1.16 does not load here (${code}); see the header comment` };
  }
  const contract = new mod.contracts.ChainSignatureContract({ networkId: 'testnet', contractId: mpc, fallbackRpcUrls: [rpc] });
  const publicClient = createPublicClient({ chain: sepolia, transport: http(getSepoliaRpc(), { timeout: 20_000 }) });
  const evm = new mod.chainAdapters.evm.EVM({ publicClient, contract });
  const r = await evm.deriveAddressAndPublicKey(predecessor, path);
  return { address: String(r.address) };
}

interface Row {
  route: string;
  address?: string;
  ok?: boolean; // undefined when skipped
  note?: string;
}

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function formatRows(rows: Row[]): string[] {
  return rows.map((r) => {
    if (r.ok === undefined) return `${r.route}: SKIPPED (${r.note ?? 'unavailable'})`;
    const addr = r.address ? toChecksumAddress(r.address) : 'n/a';
    return `${r.route}: ${addr} ${r.ok ? 'agree' : 'DISAGREE'}${r.note ? ` [${r.note}]` : ''}`;
  });
}

function verdict(rows: Row[]): { status: Status; compared: number; reasons: string[] } {
  const ran = rows.filter((r) => r.ok !== undefined);
  const bad = ran.filter((r) => !r.ok);
  const reasons = bad.map((r) => `${r.route}: ${r.address ?? 'n/a'}${r.note ? ` (${r.note})` : ''}`);
  for (const r of rows.filter((x) => x.ok === undefined)) reasons.push(`${r.route} skipped: ${r.note ?? 'unavailable'}`);
  if (ran.length < 2) reasons.push('fewer than two routes ran, so there is nothing to compare');
  if (ran.length < 2 && reasons.length === 0) reasons.push('fewer than two routes ran');
  const status: Status = bad.length === 0 && ran.length >= 2 ? 'PASS' : 'FAIL';
  return { status, compared: ran.length, reasons };
}

async function offline(): Promise<number> {
  const noble = deriveNoble(MPC_ROOT_TESTNET, VECTOR.predecessor, VECTOR.path);
  const rows: Row[] = [
    // The published vector is itself an independent expected value, so it counts as a route.
    { route: 'research vector (expected, RESEARCH.md section 2)', address: VECTOR.address, ok: true },
    {
      route: 'noble derivation, pinned root',
      address: noble.address,
      ok: eq(noble.address, VECTOR.address) && noble.naj === VECTOR.naj,
      note: noble.naj === VECTOR.naj ? 'NAJ matches the vector' : `NAJ ${noble.naj} differs from the vector`,
    },
  ];
  const cs = await chainsigAddress(VECTOR.predecessor, VECTOR.path, MPC_TESTNET, 'https://test.rpc.fastnear.com');
  if ('skipped' in cs) rows.push({ route: 'chainsig.js 1.1.16', note: cs.skipped });
  else rows.push({ route: 'chainsig.js 1.1.16 (local fast path, no RPC)', address: cs.address, ok: eq(cs.address, VECTOR.address) });

  const v = verdict(rows);
  report({
    id: ID,
    status: v.status,
    offline: true,
    summary: `Offline self-test against the research vector (${VECTOR.predecessor} + ${VECTOR.path}); ${v.compared} route(s) compared.`,
    evidence: {
      vector_address: toChecksumAddress(VECTOR.address),
      vector_naj: VECTOR.naj,
      routes: formatRows(rows),
      label: 'SYNTHETIC vector from RESEARCH.md, not a live account',
    },
    reasons: v.reasons,
  });
  return v.status === 'PASS' ? 0 : 1;
}

async function live(predecessor: string, path: string, sigFile: string | undefined): Promise<number> {
  const rpc = getNearRpc();
  const mpc = getMpcContract();

  const liveNaj = await fetchMpcDerivedKey(rpc, mpc, predecessor, path);
  const liveAddr = ethAddressFromMpcKey(liveNaj);
  const rows: Row[] = [{ route: 'live derived_public_key -> cleancheck', address: liveAddr, ok: true, note: 'reference' }];

  if (mpc === MPC_TESTNET) {
    const n = deriveNoble(MPC_ROOT_TESTNET, predecessor, path);
    rows.push({
      route: 'noble derivation, pinned testnet root',
      address: n.address,
      ok: eq(n.address, liveAddr) && n.naj === liveNaj,
      note: n.naj === liveNaj ? 'NAJ equals the live key' : `NAJ ${n.naj} differs from live`,
    });
  }

  const cs = await chainsigAddress(predecessor, path, mpc, rpc);
  if ('skipped' in cs) rows.push({ route: 'chainsig.js 1.1.16', note: cs.skipped });
  else rows.push({ route: 'chainsig.js 1.1.16 deriveAddressAndPublicKey', address: cs.address, ok: eq(cs.address, liveAddr) });

  if (sigFile) {
    const { file, sig } = readSigFile(sigFile);
    const recovered = await recoverAddress({
      hash: sig.payload_hash as Hex,
      signature: {
        r: `0x${sig.response.big_r.affine_point.replace(/^0x/i, '').slice(2)}` as Hex,
        s: `0x${sig.response.s.scalar.replace(/^0x/i, '')}` as Hex,
        yParity: sig.response.recovery_id as 0 | 1,
      },
    });
    rows.push({ route: `recovered from MPC signature (${file})`, address: recovered, ok: eq(recovered, liveAddr) });
  }

  const v = verdict(rows);
  report({
    id: ID,
    status: v.status,
    summary:
      v.status === 'PASS'
        ? `${v.compared} routes agree on one address for (${predecessor}, ${path}).`
        : `Routes disagree, or too few ran, for (${predecessor}, ${path}).`,
    evidence: {
      predecessor,
      path,
      mpc_contract: mpc,
      address: toChecksumAddress(liveAddr),
      live_derived_public_key: liveNaj,
      routes: formatRows(rows),
    },
    reasons: v.reasons,
  });
  return v.status === 'PASS' ? 0 : 1;
}

async function main(): Promise<number> {
  const args = scriptArgs();
  if (args.includes('--offline')) return offline();

  const sigAt = args.indexOf('--sig');
  const sigFile = sigAt >= 0 ? args[sigAt + 1] : undefined;
  if (sigAt >= 0 && (!sigFile || sigFile.startsWith('--'))) throw new UsageError('--sig needs a file path');
  const positional = args.filter((a, i) => !a.startsWith('--') && (sigAt < 0 || i !== sigAt + 1));
  const predecessor = positional[0] ?? getProbeContract();
  const path = positional[1] ?? 'handover-check';
  if (!path.startsWith('handover-')) throw new UsageError(`path should look like handover-<token>, got "${path}"`);
  return live(predecessor, path, sigFile);
}

runMain(ID, main);
