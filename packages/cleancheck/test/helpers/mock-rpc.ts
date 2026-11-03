import { vi } from 'vitest';
import type { SignedTxView, WalletView } from '../../src/types';

export interface MockChainState {
  /** Keyed by token id. A null entry makes get_wallet return null. */
  wallets: Record<string, WalletView | null>;
  sigLogs: Record<string, SignedTxView[]>;
  /** Key returned by derived_public_key, e.g. "secp256k1:...". */
  derivedKey?: string;
  eth: { latest: number; pending: number; balance: bigint };
  /** Optional per-call overrides, used to inject errors. */
  nearError?: { message: string };
}

export interface MockCall {
  url: string;
  body: any;
}

/** Stubs global fetch with an in-memory NEAR + Ethereum JSON-RPC node. Returns the recorded calls. */
export function installMockRpc(state: MockChainState): MockCall[] {
  const calls: MockCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? 'null'));
    calls.push({ url: String(url), body });
    return new Response(JSON.stringify(respond(state, body)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function respond(state: MockChainState, body: any): unknown {
  if (body.method === 'query') {
    if (state.nearError) return { jsonrpc: '2.0', id: body.id, error: state.nearError };
    const p = body.params;
    const args = JSON.parse(new TextDecoder().decode(base64ToBytes(p.args_base64)));
    let value: unknown;
    switch (p.method_name) {
      case 'get_wallet':
        value = state.wallets[args.token_id] ?? null;
        break;
      case 'get_sig_log': {
        const all = state.sigLogs[args.token_id] ?? [];
        value = all.slice(args.from_index, args.from_index + args.limit);
        break;
      }
      case 'derived_public_key':
        value = state.derivedKey ?? null;
        break;
      default:
        return { jsonrpc: '2.0', id: body.id, error: { message: `unknown method ${p.method_name}` } };
    }
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
    return { jsonrpc: '2.0', id: body.id, result: { result: bytes, logs: [], block_height: 1 } };
  }
  if (body.method === 'eth_getTransactionCount') {
    const n = body.params[1] === 'pending' ? state.eth.pending : state.eth.latest;
    return { jsonrpc: '2.0', id: body.id, result: `0x${n.toString(16)}` };
  }
  if (body.method === 'eth_getBalance') {
    return { jsonrpc: '2.0', id: body.id, result: `0x${state.eth.balance.toString(16)}` };
  }
  return { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: `method not found: ${body.method}` } };
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
