import { ethAddressFromMpcKey } from './address';
import { bytesToBase64 } from './bytes';
import { cleanCheck } from './check';
import { signerRecoveryProblems } from './signers';
import { fromSignedTxView, fromWalletView } from './convert';
import type {
  CleanCheckResult,
  Hex,
  SignedTxRecord,
  SignedTxView,
  WalletView,
} from './types';

// Dependency-free: uses the global fetch, TextEncoder, btoa (Node 22 and browsers).

const SIG_LOG_PAGE = 50;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function postJson(url: string, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`request to ${url} failed: ${msg}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function describeRpcError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; data?: unknown };
    if (typeof e.message === 'string') return e.message;
    if (typeof e.data === 'string') return e.data;
  }
  return JSON.stringify(err);
}

/** NEAR `query` / `call_function` view call. Returns the decoded JSON result. */
export async function nearView<T>(
  rpcUrl: string,
  contractId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const argsBase64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(args)));
  const json = await postJson(rpcUrl, {
    jsonrpc: '2.0',
    id: 'handover',
    method: 'query',
    params: {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: method,
      args_base64: argsBase64,
    },
  });
  const err = json?.error ?? json?.result?.error;
  if (err !== undefined && err !== null) {
    throw new Error(`NEAR view ${contractId}.${method} failed: ${describeRpcError(err)}`);
  }
  const bytes = json?.result?.result;
  if (!Array.isArray(bytes)) {
    throw new Error(`NEAR view ${contractId}.${method}: response has no result bytes`);
  }
  const text = new TextDecoder().decode(Uint8Array.from(bytes as number[]));
  if (text === '') throw new Error(`NEAR view ${contractId}.${method}: empty result`);
  return JSON.parse(text) as T;
}

async function ethRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const json = await postJson(rpcUrl, { jsonrpc: '2.0', id: 1, method, params });
  if (json?.error) {
    throw new Error(`${method} failed: ${describeRpcError(json.error)}`);
  }
  return json.result as T;
}

function parseQuantity(hex: unknown, what: string): bigint {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`${what}: expected hex quantity, got ${JSON.stringify(hex)}`);
  }
  return BigInt(hex);
}

// ---------------------------------------------------------------------------
// Handover contract readers
// ---------------------------------------------------------------------------

/** `get_wallet`. Returns null when the token has no wallet. */
export function fetchWallet(
  rpcUrl: string,
  contractId: string,
  tokenId: string,
): Promise<WalletView | null> {
  return nearView<WalletView | null>(rpcUrl, contractId, 'get_wallet', { token_id: tokenId });
}

/** Pages through `get_sig_log` (50 per page) until a short page. Returns wire-format entries. */
export async function fetchSigLog(
  rpcUrl: string,
  contractId: string,
  tokenId: string,
): Promise<SignedTxView[]> {
  const all: SignedTxView[] = [];
  for (let from = 0; ; from += SIG_LOG_PAGE) {
    const page = await nearView<SignedTxView[]>(rpcUrl, contractId, 'get_sig_log', {
      token_id: tokenId,
      from_index: from,
      limit: SIG_LOG_PAGE,
    });
    all.push(...page);
    if (page.length < SIG_LOG_PAGE) return all;
  }
}

/** MPC `derived_public_key` for a path and predecessor, domain 0 (secp256k1). Returns "secp256k1:<base58>". */
export async function fetchMpcDerivedKey(
  rpcUrl: string,
  mpcContractId: string,
  predecessor: string,
  path: string,
): Promise<string> {
  const key = await nearView<unknown>(rpcUrl, mpcContractId, 'derived_public_key', {
    path,
    predecessor,
    domain_id: 0,
  });
  if (typeof key !== 'string') throw new Error('derived_public_key did not return a string');
  return key;
}

// ---------------------------------------------------------------------------
// Sepolia (Ethereum JSON-RPC)
// ---------------------------------------------------------------------------

export async function ethNonce(
  rpcUrl: string,
  address: string,
  tag: 'latest' | 'pending',
): Promise<number> {
  const hex = await ethRpc<string>(rpcUrl, 'eth_getTransactionCount', [address, tag]);
  const n = parseQuantity(hex, 'eth_getTransactionCount');
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('nonce out of range');
  return Number(n);
}

export async function ethBalance(rpcUrl: string, address: string): Promise<bigint> {
  const hex = await ethRpc<string>(rpcUrl, 'eth_getBalance', [address, 'latest']);
  return parseQuantity(hex, 'eth_getBalance');
}

// ---------------------------------------------------------------------------
// Composed check
// ---------------------------------------------------------------------------

export interface RunCleanCheckParams {
  nearRpc: string;
  sepoliaRpc: string;
  contractId: string;
  tokenId: string;
  address: Hex;
}

export type CleanCheckReport = CleanCheckResult & {
  wallet: WalletView;
  sigLog: SignedTxRecord[];
  balanceWei: bigint;
};

/** Reads contract state and Sepolia state for one address, then runs the clean check. */
export async function runCleanCheck(params: RunCleanCheckParams): Promise<CleanCheckReport> {
  const { nearRpc, sepoliaRpc, contractId, tokenId, address } = params;
  const [wallet, sigViews, confirmedNonce, pendingNonce, balanceWei] = await Promise.all([
    fetchWallet(nearRpc, contractId, tokenId),
    fetchSigLog(nearRpc, contractId, tokenId),
    ethNonce(sepoliaRpc, address, 'latest'),
    ethNonce(sepoliaRpc, address, 'pending'),
    ethBalance(sepoliaRpc, address),
  ]);
  if (wallet === null) {
    throw new Error(`no wallet for token ${tokenId} on contract ${contractId}`);
  }
  const sigLog = sigViews.map(fromSignedTxView);
  const result = cleanCheck(fromWalletView(wallet), sigLog, {
    confirmedNonce,
    pendingNonce,
    derivedAddress: address,
  });
  const signerProblems = signerRecoveryProblems(address, sigLog);
  if (signerProblems.length > 0) {
    return {
      ...result,
      verdict: 'inconsistent',
      reasons: [...signerProblems, ...result.reasons],
      wallet,
      sigLog,
      balanceWei,
    };
  }
  return { ...result, wallet, sigLog, balanceWei };
}
