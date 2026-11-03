// Check 2: MPC sign from a contract. Proves that a deployed contract can get a
// secp256k1 signature from v1.signer-prod.testnet over an EIP-1559 payload, and
// records what that cost: deposit, gas, latency, and the response fields.
//
// Two modes:
//   tsx 02-mpc-sign.ts
//       Prints the build, deploy and call commands (near-cli-rs) and the live
//       derived_public_key for (PROBE_CONTRACT, "handover-check"). No verdict:
//       exits 2 because a PASS needs a real transaction.
//   tsx 02-mpc-sign.ts --parse <tx_hash> [--sender <account>]
//       Reads the outcome of the request_transfer call over NEAR RPC
//       (EXPERIMENTAL_tx_status), checks the MPC response, and prints the
//       latency and gas burnt. Saves the response to evidence/sig-<tx_hash>.json,
//       which check 3 reads with --sig.
//
// PASS: the callback returned a well-formed Secp256k1 response (r, s, recovery_id)
// together with the payload hash, and the transaction finished successfully.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchMpcDerivedKey } from '@handover/cleancheck';
import { EVIDENCE_DIR, getMpcContract, getNearAccountId, getNearRpc, getProbeContract, scriptArgs, UsageError } from './lib/env';
import { nearRpc } from './lib/near';
import { report, runMain, type Status } from './lib/report';

const ID = '02-mpc-sign';
const PATH_TOKEN = 'check';

interface TxOutcome {
  status: Record<string, unknown>;
  transaction_outcome: ReceiptOutcome;
  receipts_outcome: ReceiptOutcome[];
  final_execution_status?: string;
}
interface ReceiptOutcome {
  id: string;
  block_hash: string;
  outcome: {
    executor_id: string;
    gas_burnt: number;
    logs: string[];
    status: Record<string, unknown>;
  };
}

interface SignResult {
  nonce: number;
  payload_hash: string;
  response: {
    scheme: string;
    big_r: { affine_point: string };
    s: { scalar: string };
    recovery_id: number;
  };
  raw_tx_hex: string;
  tx_hash: string;
}

function printCommands(probe: string, sender: string, derivedKey: string): void {
  console.log('');
  console.log('Derived key (MPC derived_public_key, live):');
  console.log(`  ${derivedKey}`);
  console.log('');
  console.log('1. Build the probe (cargo-near 0.22.0; install from the release tarball, see checks/02-mpc-sign/README.md):');
  console.log('   cd checks/02-mpc-sign && cargo near build non-reproducible-wasm');
  console.log('2. Deploy with init (once; the probe owner is your NEAR account):');
  console.log(
    `   near contract deploy ${probe} use-file target/near/mpc_sign_probe.wasm with-init-call new_default_meta json-args '{"owner_id":"${sender}"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send`,
  );
  console.log('3. Request a signature (1 yocto goes to MPC; 300 Tgas attached). Copy the transaction hash it prints:');
  console.log(
    `   near contract call-function as-transaction ${probe} request_transfer json-args '{"token_id":"${PATH_TOKEN}","to":"0x000000000000000000000000000000000000dEaD","value_wei":"100000000000000"}' prepaid-gas '300 Tgas' attached-deposit '1 yoctoNEAR' sign-as ${sender} network-config testnet sign-with-legacy-keychain send`,
  );
  console.log('4. Read the outcome and record the evidence:');
  console.log(`   tsx checks/02-mpc-sign.ts --parse <tx_hash>`);
  console.log('');
  console.log('If the request is rejected, the error text is the evidence: record it in evidence/ and in checks/README.md.');
  console.log('');
}

function b64Json(v: unknown): unknown {
  if (typeof v !== 'string') return undefined;
  const text = Buffer.from(v, 'base64').toString('utf8');
  return JSON.parse(text) as unknown;
}

function hexOf(v: unknown, bytes: number): boolean {
  return typeof v === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`, 'i').test(v);
}

async function blockTimestampNs(rpc: string, blockHash: string): Promise<bigint> {
  const block = await nearRpc<{ header: { timestamp_nanosec?: string; timestamp: number | string } }>(rpc, 'block', {
    block_id: blockHash,
  });
  const h = block.header;
  return BigInt(h.timestamp_nanosec ?? h.timestamp.toString());
}

async function parseMode(txHash: string, sender: string, probe: string, rpc: string): Promise<number> {
  const outcome = await nearRpc<TxOutcome>(rpc, 'EXPERIMENTAL_tx_status', [txHash, sender]);
  const reasons: string[] = [];

  const receipts = outcome.receipts_outcome ?? [];
  const gasBurnt = [outcome.transaction_outcome, ...receipts].map((r) => ({
    executor: r.outcome.executor_id,
    gas_tgas: Number(r.outcome.gas_burnt) / 1e12,
  }));
  const totalGasTgas = gasBurnt.reduce((a, b) => a + b.gas_tgas, 0);

  // Latency: transaction block to the last receipt executed by the probe (the callback).
  const callbackReceipt = [...receipts].reverse().find((r) => r.outcome.executor_id === probe);
  let latencySeconds: number | null = null;
  if (callbackReceipt) {
    const t0 = await blockTimestampNs(rpc, outcome.transaction_outcome.block_hash);
    const t1 = await blockTimestampNs(rpc, callbackReceipt.block_hash);
    latencySeconds = Number(t1 - t0) / 1e9;
  } else {
    reasons.push('no callback receipt found from the probe contract; latency not measured.');
  }

  const mpcReceipts = receipts
    .filter((r) => r.outcome.executor_id !== probe)
    .map((r) => ({ executor: r.outcome.executor_id, gas_tgas: Number(r.outcome.gas_burnt) / 1e12 }));

  const success = outcome.status && 'SuccessValue' in outcome.status;
  let result: SignResult | null = null;
  if (!success) {
    reasons.push(
      `the transaction has no final SuccessValue (status: ${JSON.stringify(outcome.status)}). If it is still running, wait and re-run; if it failed, read the receipt errors.`,
    );
  } else {
    const decoded = b64Json(outcome.status.SuccessValue);
    if (decoded === null) {
      reasons.push('the callback returned null: on_signed got an MPC error (timeout or failed respond). No signature was recorded.');
    } else if (decoded && typeof decoded === 'object') {
      result = decoded as SignResult;
    } else {
      reasons.push(`unexpected callback value: ${JSON.stringify(decoded)}`);
    }
  }

  // MPC hex has no 0x prefix (serde_with::Hex). Accept an optional 0x anyway.
  let shapeOk = false;
  let bigRPrefix = 'n/a';
  let sBytes: number | 'n/a' = 'n/a';
  if (result) {
    const resp = result.response;
    const ap = (resp?.big_r?.affine_point ?? '').replace(/^0x/i, '');
    const sc = (resp?.s?.scalar ?? '').replace(/^0x/i, '');
    const shapeProblems: string[] = [];
    if (resp?.scheme !== 'Secp256k1') shapeProblems.push(`scheme is ${String(resp?.scheme)}, expected Secp256k1`);
    if (!/^0[23][0-9a-f]{64}$/i.test(ap)) shapeProblems.push('big_r.affine_point is not 33 bytes with a 02/03 prefix');
    if (!hexOf(sc, 32)) shapeProblems.push('s.scalar is not 32 bytes of hex');
    if (!(resp?.recovery_id === 0 || resp?.recovery_id === 1)) shapeProblems.push(`recovery_id ${String(resp?.recovery_id)} is not 0 or 1`);
    if (!/^0x[0-9a-f]{64}$/i.test(result.payload_hash ?? '')) shapeProblems.push('payload_hash is not 0x + 32 bytes');
    if (!/^0x[0-9a-f]{64}$/i.test(result.tx_hash ?? '')) shapeProblems.push('tx_hash is not 0x + 32 bytes');
    if (shapeProblems.length === 0) {
      shapeOk = true;
      bigRPrefix = ap.slice(0, 2);
      sBytes = sc.length / 2;
    }
    reasons.push(...shapeProblems);
  }

  const status: Status = success && result && shapeOk ? 'PASS' : 'FAIL';

  if (result && shapeOk) {
    const dir = EVIDENCE_DIR;
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `sig-${txHash}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          note: 'MPC signature response captured by checks/02-mpc-sign.ts --parse. Real testnet data.',
          tx_hash_near: txHash,
          sender,
          probe_contract: probe,
          path: `handover-${PATH_TOKEN}`,
          payload_hash: result.payload_hash,
          response: result.response,
          raw_tx_hex: result.raw_tx_hex,
          tx_hash_sepolia: result.tx_hash,
          latency_seconds: latencySeconds,
          total_gas_tgas: Number(totalGasTgas.toFixed(3)),
          deposit_yocto: '1',
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`saved MPC response to ${file} (check 3 reads it with --sig)`);
  }

  report({
    id: ID,
    status,
    summary:
      status === 'PASS'
        ? 'MPC returned a secp256k1 signature to the probe contract.'
        : 'No valid MPC signature was returned for this transaction.',
    evidence: {
      near_tx_hash: txHash,
      sender,
      probe_contract: probe,
      path: `handover-${PATH_TOKEN}`,
      mpc_contract: getMpcContract(),
      deposit_yocto: '1',
      latency_seconds: latencySeconds === null ? 'n/a' : Number(latencySeconds.toFixed(3)),
      total_gas_tgas: Number(totalGasTgas.toFixed(3)),
      gas_by_receipt: gasBurnt.map((g) => `${g.executor}: ${g.gas_tgas} Tgas`),
      mpc_receipts: mpcReceipts.map((g) => `${g.executor}: ${g.gas_tgas} Tgas`),
      payload_hash: result?.payload_hash ?? 'n/a',
      response_scheme: result?.response?.scheme ?? 'n/a',
      big_r_prefix: bigRPrefix,
      s_bytes: sBytes,
      recovery_id: result?.response?.recovery_id ?? 'n/a',
      sepolia_tx_hash_from_probe: result?.tx_hash ?? 'n/a',
    },
    reasons,
  });
  return status === 'PASS' ? 0 : 1;
}

async function main(): Promise<number> {
  const args = scriptArgs();
  const parseAt = args.indexOf('--parse');
  const senderAt = args.indexOf('--sender');
  const sender = senderAt >= 0 ? args[senderAt + 1] : undefined;
  if (senderAt >= 0 && !sender) throw new UsageError('--sender needs an account id');
  const probe = getProbeContract();
  const acct = sender ?? getNearAccountId();
  const rpc = getNearRpc();

  if (parseAt < 0) {
    const derived = await fetchMpcDerivedKey(rpc, getMpcContract(), probe, `handover-${PATH_TOKEN}`);
    printCommands(probe, acct, derived);
    throw new UsageError('this mode gives no verdict. Run it again after the request, with --parse <tx_hash>.');
  }
  const txHash = args[parseAt + 1];
  if (!txHash || txHash.startsWith('--')) throw new UsageError('--parse needs the transaction hash printed by near-cli-rs');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(txHash)) {
    throw new UsageError(`"${txHash}" does not look like a NEAR transaction hash (base58, 43-44 chars)`);
  }
  return parseMode(txHash, acct, probe, rpc);
}

runMain(ID, main);
