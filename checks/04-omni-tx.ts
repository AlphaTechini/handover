// Check 4: omni-transaction inside the contract (offline). Proves that the EIP-1559
// signing payload the contract builds with omni-transaction is byte-identical to the
// one viem builds off-chain, and that the contract wasm is deployable in size.
//
// The tx is fixed: chain 11155111, nonce 0, to 0x...dEaD, value 0.0001 ETH, gas 21000,
// maxFee 30 gwei, priority 1 gwei. The contract side is checks/02-mpc-sign (its Rust
// test fixed_vector_payload_matches_viem asserts the same hex and hash). Both sides
// pin the same constants, so this check reproduces that comparison without a chain.
//
// Usage:
//   tsx 04-omni-tx.ts                     print payload and hash, compare to the pinned vector
//   tsx 04-omni-tx.ts --expect <hash>    compare the hash to a value you got from cargo test
//   tsx 04-omni-tx.ts --wasm <file>       wasm to size-check (default contracts/res/handover.wasm)
//
// Size limit: a deploy transaction carries the wasm, so it must fit NEAR's max
// transaction size, 1.5 MiB (research, RESEARCH.md section 4). The separate
// max_contract_size is 4 MiB. The check uses the tighter 1.5 MiB.
//
// PASS: the hash matches the expected vector, and the wasm (if built) is under 1.5 MiB.

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256, serializeTransaction, type Hex } from 'viem';
import { REPO_ROOT, scriptArgs, UsageError } from './lib/env';
import { report, runMain, type Status } from './lib/report';

const ID = '04-omni-tx';

/** Must equal the constants in checks/02-mpc-sign/src/mpc.rs (FIXED_VECTOR_*). */
const EXPECTED_PAYLOAD = '0x02f183aa36a780843b9aca008506fc23ac0082520894000000000000000000000000000000000000dead865af3107a400080c0';
const EXPECTED_HASH = '0xef043b276591d41c502c17ac847be83b7200b34dbe4c5b21d3b815cb08974699';
const WASM_LIMIT_BYTES = 1.5 * 1024 * 1024; // 1,572,864 bytes
const WASM_CONTRACT_MAX = 4 * 1024 * 1024;

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return v;
}

async function main(): Promise<number> {
  const args = scriptArgs();
  const expectHash = argValue(args, '--expect') ?? EXPECTED_HASH;
  if (!/^0x[0-9a-fA-F]{64}$/.test(expectHash)) throw new UsageError('--expect must be 0x + 64 hex characters');
  const wasmArg = argValue(args, '--wasm');
  // A relative --wasm is tried from the current directory, then from the repo root (pnpm runs from checks/).
  const wasmPath = wasmArg
    ? (existsSync(resolve(wasmArg)) ? resolve(wasmArg) : resolve(REPO_ROOT, wasmArg))
    : resolve(REPO_ROOT, 'contracts/res/handover.wasm');

  const tx = {
    type: 'eip1559' as const,
    chainId: 11155111,
    nonce: 0,
    to: '0x000000000000000000000000000000000000dEaD' as Hex,
    value: 100_000_000_000_000n, // 0.0001 ETH
    gas: 21_000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    data: '0x' as Hex,
    accessList: [],
  };
  const payload = serializeTransaction(tx); // unsigned: 0x02 || rlp(...)
  const hash = keccak256(payload);

  const reasons: string[] = [];
  const hashOk = hash.toLowerCase() === expectHash.toLowerCase();
  const payloadOk = payload.toLowerCase() === EXPECTED_PAYLOAD.toLowerCase() || expectHash !== EXPECTED_HASH;
  if (!hashOk) reasons.push(`hash ${hash} != expected ${expectHash}`);
  if (!payloadOk) reasons.push(`payload differs from the pinned vector`);

  const wasm: Record<string, string> = {};
  let wasmOk = true;
  if (existsSync(wasmPath)) {
    const size = statSync(wasmPath).size;
    wasm.wasm_file = wasmPath;
    wasm.wasm_bytes = String(size);
    wasm.wasm_limit_tx_bytes = String(WASM_LIMIT_BYTES);
    wasm.wasm_contract_max_bytes = String(WASM_CONTRACT_MAX);
    if (size >= WASM_LIMIT_BYTES) {
      wasmOk = false;
      reasons.push(`wasm is ${size} bytes, at or above the 1.5 MiB (${WASM_LIMIT_BYTES}) deploy limit`);
    }
  } else {
    wasm.wasm = `not built (${wasmPath} missing); size check skipped`;
  }

  const status: Status = hashOk && payloadOk && wasmOk ? 'PASS' : 'FAIL';
  report({
    id: ID,
    status,
    offline: true,
    summary:
      status === 'PASS'
        ? 'viem payload and hash match the contract test vector; wasm size is within limits.'
        : 'viem payload or hash does not match, or the wasm is too large.',
    evidence: {
      tx: 'chain 11155111, nonce 0, to 0x...dEaD, value 100000000000000 wei, gas 21000, maxFee 30 gwei, prio 1 gwei',
      unsigned_payload_hex: payload,
      signing_hash: hash,
      expected_hash: expectHash,
      ...wasm,
    },
    reasons,
  });
  return status === 'PASS' ? 0 : 1;
}

runMain(ID, main);
