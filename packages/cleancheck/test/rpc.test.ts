import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ethBalance,
  ethNonce,
  fetchMpcDerivedKey,
  fetchSigLog,
  fetchWallet,
  nearView,
  runCleanCheck,
} from '../src/rpc';
import type { SignedTxView } from '../src/types';
import { installMockRpc, type MockChainState } from './helpers/mock-rpc';
import { syntheticTx, syntheticWallet, SYNTHETIC_ADDRESS, SYNTHETIC_CONTRACT } from './helpers/fixture';

const NEAR = 'https://near.synthetic.test';
const ETH = 'https://eth.synthetic.test';
const MPC = 'v1.signer.synthetic.test';

function state(overrides: Partial<MockChainState> = {}): MockChainState {
  return {
    wallets: { '0': syntheticWallet(3) },
    sigLogs: { '0': [0, 1, 2].map((n) => syntheticTx(n)) },
    eth: { latest: 1, pending: 2, balance: 2_500_000_000_000_000_000n },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nearView', () => {
  it('sends a call_function query with base64 JSON args and decodes the result bytes', async () => {
    const calls = installMockRpc(state());
    const wallet = await nearView<unknown>(NEAR, SYNTHETIC_CONTRACT, 'get_wallet', { token_id: '0' });
    expect(wallet).toEqual(syntheticWallet(3));

    const body = calls[0]!.body;
    expect(calls[0]!.url).toBe(NEAR);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 'handover',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: SYNTHETIC_CONTRACT,
        method_name: 'get_wallet',
      },
    });
    const sentArgs = Buffer.from(body.params.args_base64, 'base64').toString('utf8');
    expect(JSON.parse(sentArgs)).toEqual({ token_id: '0' });
  });

  it('throws with the RPC message on a top-level error', async () => {
    installMockRpc(state({ nearError: { message: 'contract panicked' } }));
    await expect(nearView(NEAR, SYNTHETIC_CONTRACT, 'get_wallet', {})).rejects.toThrow(
      /contract panicked/,
    );
  });

  it('throws when result.error is a string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: { error: 'method not found' } }))),
    );
    await expect(nearView(NEAR, SYNTHETIC_CONTRACT, 'nope', {})).rejects.toThrow(/method not found/);
  });

  it('throws on a non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await expect(nearView(NEAR, SYNTHETIC_CONTRACT, 'get_wallet', {})).rejects.toThrow(/HTTP 503/);
  });
});

describe('contract readers', () => {
  it('fetchWallet returns the wallet, or null when absent', async () => {
    installMockRpc(state());
    expect(await fetchWallet(NEAR, SYNTHETIC_CONTRACT, '0')).toEqual(syntheticWallet(3));
    expect(await fetchWallet(NEAR, SYNTHETIC_CONTRACT, '99')).toBeNull();
  });

  it('fetchSigLog pages 50 at a time until a short page', async () => {
    const log: SignedTxView[] = [];
    for (let n = 0; n < 120; n++) log.push(syntheticTx(n));
    const calls = installMockRpc(state({ sigLogs: { '0': log } }));

    const got = await fetchSigLog(NEAR, SYNTHETIC_CONTRACT, '0');
    expect(got.map((t) => t.nonce)).toEqual(log.map((t) => t.nonce));
    const offsets = calls.map((c) => JSON.parse(Buffer.from(c.body.params.args_base64, 'base64').toString()));
    expect(offsets).toEqual([
      { token_id: '0', from_index: 0, limit: 50 },
      { token_id: '0', from_index: 50, limit: 50 },
      { token_id: '0', from_index: 100, limit: 50 },
    ]);
  });

  it('fetchSigLog requests one more page when the log is an exact multiple of 50', async () => {
    const log: SignedTxView[] = [];
    for (let n = 0; n < 50; n++) log.push(syntheticTx(n));
    const calls = installMockRpc(state({ sigLogs: { '0': log } }));
    const got = await fetchSigLog(NEAR, SYNTHETIC_CONTRACT, '0');
    expect(got).toHaveLength(50);
    expect(calls).toHaveLength(2);
  });

  it('fetchSigLog returns an empty array for a wallet with no signatures', async () => {
    installMockRpc(state({ sigLogs: {} }));
    expect(await fetchSigLog(NEAR, SYNTHETIC_CONTRACT, '0')).toEqual([]);
  });

  it('fetchMpcDerivedKey asks for domain 0 with path and predecessor', async () => {
    const calls = installMockRpc(state({ derivedKey: 'secp256k1:SYNTHETIC' }));
    const key = await fetchMpcDerivedKey(NEAR, MPC, SYNTHETIC_CONTRACT, 'handover-0');
    expect(key).toBe('secp256k1:SYNTHETIC');
    expect(calls[0]!.body.params.account_id).toBe(MPC);
    expect(calls[0]!.body.params.method_name).toBe('derived_public_key');
    expect(JSON.parse(Buffer.from(calls[0]!.body.params.args_base64, 'base64').toString())).toEqual({
      path: 'handover-0',
      predecessor: SYNTHETIC_CONTRACT,
      domain_id: 0,
    });
  });
});

describe('Sepolia readers', () => {
  it('ethNonce reads latest and pending tags', async () => {
    const calls = installMockRpc(state({ eth: { latest: 4, pending: 6, balance: 0n } }));
    expect(await ethNonce(ETH, SYNTHETIC_ADDRESS, 'latest')).toBe(4);
    expect(await ethNonce(ETH, SYNTHETIC_ADDRESS, 'pending')).toBe(6);
    expect(calls[0]!.body).toMatchObject({ method: 'eth_getTransactionCount', params: [SYNTHETIC_ADDRESS, 'latest'] });
    expect(calls[1]!.body.params[1]).toBe('pending');
  });

  it('ethNonce rejects a non-hex result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '7' }))),
    );
    await expect(ethNonce(ETH, SYNTHETIC_ADDRESS, 'latest')).rejects.toThrow(/hex quantity/);
  });

  it('ethNonce surfaces JSON-RPC errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code: -32000, message: 'rate limited' } }))),
    );
    await expect(ethNonce(ETH, SYNTHETIC_ADDRESS, 'latest')).rejects.toThrow(/rate limited/);
  });

  it('ethBalance returns a bigint in wei', async () => {
    installMockRpc(state({ eth: { latest: 0, pending: 0, balance: 2_500_000_000_000_000_000n } }));
    const b = await ethBalance(ETH, SYNTHETIC_ADDRESS);
    expect(typeof b).toBe('bigint');
    expect(b).toBe(2_500_000_000_000_000_000n);
  });
});

describe('runCleanCheck', () => {
  it('composes contract and Sepolia state into a dirty verdict with the pending list', async () => {
    installMockRpc(state()); // 3 issued, Sepolia latest 1, pending 2
    const r = await runCleanCheck({
      nearRpc: NEAR,
      sepoliaRpc: ETH,
      contractId: SYNTHETIC_CONTRACT,
      tokenId: '0',
      address: SYNTHETIC_ADDRESS,
    });
    expect(r.verdict).toBe('dirty');
    expect(r.pending.map((p) => p.nonce)).toEqual([1, 2]);
    expect(r.inMempool.map((p) => p.nonce)).toEqual([1]);
    expect(r.balanceWei).toBe(2_500_000_000_000_000_000n);
    expect(r.wallet).toEqual(syntheticWallet(3));
    expect(r.sigLog).toHaveLength(3);
    expect(r.sigLog[0]!.valueWei).toBe('1000000000000000');
  });

  it('reports clean when Sepolia has caught up', async () => {
    installMockRpc(state({ eth: { latest: 3, pending: 3, balance: 0n } }));
    const r = await runCleanCheck({
      nearRpc: NEAR,
      sepoliaRpc: ETH,
      contractId: SYNTHETIC_CONTRACT,
      tokenId: '0',
      address: SYNTHETIC_ADDRESS,
    });
    expect(r.verdict).toBe('clean');
  });

  it('throws when the wallet does not exist', async () => {
    installMockRpc(state({ wallets: {} }));
    await expect(
      runCleanCheck({
        nearRpc: NEAR,
        sepoliaRpc: ETH,
        contractId: SYNTHETIC_CONTRACT,
        tokenId: '42',
        address: SYNTHETIC_ADDRESS,
      }),
    ).rejects.toThrow(/no wallet for token 42/);
  });

  it('propagates NEAR errors', async () => {
    installMockRpc(state({ nearError: { message: 'unknown account' } }));
    await expect(
      runCleanCheck({
        nearRpc: NEAR,
        sepoliaRpc: ETH,
        contractId: SYNTHETIC_CONTRACT,
        tokenId: '0',
        address: SYNTHETIC_ADDRESS,
      }),
    ).rejects.toThrow(/unknown account/);
  });
});
