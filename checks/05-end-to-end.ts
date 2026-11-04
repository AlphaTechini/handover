// Check 5: end to end. Proves the full path on testnet: the contract signed a
// Sepolia transfer for the token's derived address, the transaction broadcasts
// and mines, and the clean check agrees with what happened on chain.
//
//   1. derive the token's Ethereum address (live derived_public_key -> cleancheck)
//   2. read the Sepolia balance and the contract wallet and signature log
//   3. if nothing is signed yet: print the request_transfer command and exit 1
//   4. broadcast every signed transaction not yet mined (viem sendRawTransaction;
//      "nonce too low" and "already known" count as already done)
//   5. wait for receipts; write tx hashes to evidence/e2e-<timestamp>.json
//   6. run the clean check (@handover/cleancheck runCleanCheck) and print the verdict
//
// Requesting the transfer is done with near-cli-rs (printed below), because it needs
// your NEAR key. This script never signs with a NEAR key.
//
// Usage: tsx 05-end-to-end.ts [--to 0x...]
//   --to   recipient for the printed request command (default 0x...dEaD, like check 4)
// Env: HANDOVER_CONTRACT, TOKEN_ID, NEAR_ACCOUNT_ID, NEAR_RPC, SEPOLIA_RPC, MPC_CONTRACT.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ethAddressFromMpcKey,
  ethBalance,
  toChecksumAddress,
  ethNonce,
  fetchMpcDerivedKey,
  fetchSigLog,
  fetchWallet,
  formatEth,
  formatReport,
  fromSignedTxView,
  runCleanCheck,
  type SignedTxRecord,
} from '@handover/cleancheck';
import { createPublicClient, http, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import {
  EVIDENCE_DIR,
  getHandoverContract,
  getMpcContract,
  getNearAccountId,
  getNearRpc,
  getSepoliaRpc,
  getTokenId,
  parseEthAddress,
  scriptArgs,
  UsageError,
} from './lib/env';
import { report, runMain, type Status } from './lib/report';

const ID = '05-end-to-end';
const TRANSFER_VALUE_WEI = '100000000000000'; // 0.0001 ETH
const GAS_LIMIT = '21000';
const MAX_FEE = '30000000000'; // 30 gwei
const MAX_PRIO = '1000000000'; // 1 gwei
const SIGN_DEPOSIT = '10000000000000000000001 yoctoNEAR'; // sign fee (0.01 NEAR) + 1 yocto; the contract keeps the fee and forwards the rest to MPC, no refund
const ALREADY_DONE = /nonce too low|already known|known transaction|already imported|already exists/i;
const DEFAULT_TO = '0x000000000000000000000000000000000000dEaD';

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return v;
}

function requestCommand(contract: string, account: string, tokenId: string, to: string): string {
  const args = JSON.stringify({
    token_id: tokenId,
    to,
    value_wei: TRANSFER_VALUE_WEI,
    gas_limit: GAS_LIMIT,
    max_fee_per_gas: MAX_FEE,
    max_priority_fee_per_gas: MAX_PRIO,
  });
  return [
    'near contract call-function as-transaction',
    contract,
    'request_transfer',
    `json-args '${args}'`,
    "prepaid-gas '300 Tgas'",
    `attached-deposit '${SIGN_DEPOSIT}'`,
    `sign-as ${account}`,
    'network-config testnet sign-with-legacy-keychain send',
  ].join(' \\\n  ');
}

interface Sent {
  nonce: number;
  tx_hash: string;
  broadcast: 'sent' | 'already_done' | 'error';
  error?: string;
  receipt_status?: 'success' | 'reverted' | 'not_mined';
  block_number?: string;
}

async function main(): Promise<number> {
  const args = scriptArgs();
  const to = parseEthAddress(argValue(args, '--to') ?? DEFAULT_TO, '--to');
  const contract = getHandoverContract();
  const tokenId = getTokenId();
  const acct = getNearAccountId();
  const nearRpc = getNearRpc();
  const sepRpc = getSepoliaRpc();
  const mpc = getMpcContract();

  const naj = await fetchMpcDerivedKey(nearRpc, mpc, contract, `handover-${tokenId}`);
  const address = ethAddressFromMpcKey(naj) as Hex;
  console.log(`token ${tokenId} derived address: ${toChecksumAddress(address)}`);

  const wallet = await fetchWallet(nearRpc, contract, tokenId);
  if (wallet === null) {
    report({
      id: ID,
      status: 'FAIL',
      summary: `No wallet for token ${tokenId} on ${contract}.`,
      evidence: { contract, token_id: tokenId, address },
      reasons: ['Mint the token first (nft_mint, attach 0.05 NEAR), then re-run.'],
    });
    return 1;
  }
  const views = await fetchSigLog(nearRpc, contract, tokenId);
  const log: SignedTxRecord[] = views.map(fromSignedTxView);
  const confirmed = await ethNonce(sepRpc, address, 'latest');
  const pending = log.filter((t) => t.nonce >= confirmed).sort((a, b) => a.nonce - b.nonce);

  const client = createPublicClient({ chain: sepolia, transport: http(sepRpc, { timeout: 30_000 }) });
  const balance = await ethBalance(sepRpc, address);
  console.log(`Sepolia balance: ${formatEth(balance)} ETH; confirmed nonce ${confirmed}; signed txs in log ${log.length}; pending ${pending.length}`);

  if (log.length === 0) {
    console.log('\nNothing is signed yet. Request the transfer with near-cli-rs:\n');
    console.log(`  ${requestCommand(contract, acct, tokenId, to)}\n`);
    console.log('Then re-run this check. The request needs the address to hold ETH to send (check 1 prints the faucet).');
    report({
      id: ID,
      status: 'FAIL',
      summary: 'No signed transaction in the contract log yet.',
      evidence: { contract, token_id: tokenId, address, sepolia_balance_wei: balance.toString() },
      reasons: ['request_transfer has not been called successfully for this token.'],
    });
    return 1;
  }

  // Funds check before broadcasting: each pending tx needs value + gasLimit * maxFee.
  const needed = pending.reduce((acc, t) => acc + BigInt(t.valueWei) + BigInt(t.gasLimit) * BigInt(t.maxFeePerGas), 0n);
  if (pending.length > 0 && balance < needed) {
    report({
      id: ID,
      status: 'FAIL',
      summary: `Address ${address} holds ${formatEth(balance)} ETH; the pending transactions need about ${formatEth(needed)} ETH.`,
      evidence: { address, sepolia_balance_wei: balance.toString(), needed_wei: needed.toString() },
      reasons: ['Fund the derived address with Sepolia ETH (faucet link in check 1), then re-run.'],
    });
    return 1;
  }

  const sent: Sent[] = [];
  for (const t of pending) {
    const entry: Sent = { nonce: t.nonce, tx_hash: t.txHash, broadcast: 'sent' };
    try {
      const hash = await client.sendRawTransaction({ serializedTransaction: t.rawSignedTxHex });
      if (hash.toLowerCase() !== t.txHash.toLowerCase()) {
        entry.broadcast = 'error';
        entry.error = `node returned ${hash}, log has ${t.txHash}`;
      }
    } catch (err) {
      // viem puts the node's own text in details; the first line of the message is generic.
      const e = err as { details?: string; message?: string };
      const msg = e.details ?? e.message ?? String(err);
      entry.broadcast = ALREADY_DONE.test(e.message ?? '') || ALREADY_DONE.test(msg) ? 'already_done' : 'error';
      entry.error = msg.split('\n')[0];
    }
    sent.push(entry);
    console.log(`nonce ${t.nonce}: ${entry.broadcast}${entry.error ? ` (${entry.error})` : ''}`);
  }

  for (const e of sent) {
    if (e.broadcast === 'error') continue;
    try {
      const receipt = await client.waitForTransactionReceipt({ hash: e.tx_hash as Hex, timeout: 300_000 });
      e.receipt_status = receipt.status;
      e.block_number = receipt.blockNumber.toString();
    } catch (err) {
      e.receipt_status = 'not_mined';
      e.error = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    }
    console.log(`nonce ${e.nonce}: receipt ${e.receipt_status}${e.block_number ? ` in block ${e.block_number}` : ''}`);
  }

  const checksum = toChecksumAddress(address);
  // Public RPCs are load-balanced: right after a receipt, the node answering the nonce query can
  // still be a block behind. Re-read until it has caught up with every nonce that just mined.
  const minedUpTo = Math.max(-1, ...sent.filter((e) => e.receipt_status === 'success').map((e) => e.nonce));
  let result = await runCleanCheck({ nearRpc, sepoliaRpc: sepRpc, contractId: contract, tokenId, address: checksum });
  for (let i = 0; i < 5 && result.chainNonce <= minedUpTo; i++) {
    await new Promise((r) => setTimeout(r, 3_000));
    result = await runCleanCheck({ nearRpc, sepoliaRpc: sepRpc, contractId: contract, tokenId, address: checksum });
  }
  console.log('');
  console.log(formatReport({ contractId: contract, tokenId, address: checksum, balanceWei: result.balanceWei, result, sigLogLength: result.sigLog.length }, { color: process.stdout.isTTY === true }));

  const allMined = sent.every((e) => e.receipt_status === 'success');
  const status: Status = result.verdict === 'clean' && allMined && result.sigLog.length > 0 ? 'PASS' : 'FAIL';

  const record = {
    timestamp: new Date().toISOString(),
    contract,
    token_id: tokenId,
    address: toChecksumAddress(address),
    verdict: result.verdict,
    issued_nonce: result.issuedNonce,
    chain_nonce: result.chainNonce,
    sent,
  };
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = resolve(EVIDENCE_DIR, `e2e-${record.timestamp.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  console.log(`\nwrote ${file}`);

  report({
    id: ID,
    status,
    summary:
      status === 'PASS'
        ? `Signed transfer(s) mined and the clean check reports ${result.verdict}.`
        : `Clean check verdict is ${result.verdict}, or a transaction did not mine.`,
    evidence: {
      contract,
      token_id: tokenId,
      address: toChecksumAddress(address),
      verdict: result.verdict,
      tx_hashes: sent.map((e) => `nonce ${e.nonce}: ${e.tx_hash} (${e.receipt_status ?? e.broadcast})`),
      evidence_file: file,
    },
    reasons: status === 'PASS' ? [] : [...result.reasons, ...sent.filter((e) => e.error && e.broadcast === 'error').map((e) => `nonce ${e.nonce}: ${e.error}`)],
  });
  return status === 'PASS' ? 0 : 1;
}

runMain(ID, main);
