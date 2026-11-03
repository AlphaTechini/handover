// Check 6: Sepolia RPC. Proves the endpoint the app will use answers the calls it
// needs, at a rate that fits a demo, and that it accepts sendRawTransaction.
//
//   - eth_chainId must be 0xaa36a7 (11155111)
//   - eth_blockNumber, eth_getTransactionCount (latest and pending),
//     eth_maxPriorityFeePerGas and eth_feeHistory each run 10 rounds; latency is measured
//   - eth_sendRawTransaction with an obviously invalid raw tx must return a JSON-RPC
//     error (the method is reachable). An HTTP or network error is a FAIL.
//   - a CORS preflight (OPTIONS with Origin) must be answered with
//     Access-Control-Allow-Origin, so a browser on the app origin can call it.
//
// Node has no CORS enforcement, so the preflight only approximates a browser. The
// real browser test is the web app running on its origin (see checks/README.md).
//
// Usage: tsx 06-sepolia-rpc.ts [--address 0x...] [--origin https://...]
//   --address  address for eth_getTransactionCount (default SEPOLIA_FUNDED_ADDRESS or the zero address)
//   --origin   Origin header for the preflight (default http://localhost:5173)

import { createPublicClient, http, HttpRequestError, RpcError, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { getSepoliaFundedAddress, getSepoliaRpc, parseEthAddress, scriptArgs, UsageError } from './lib/env';
import { report, runMain, type Status } from './lib/report';

const ID = '06-sepolia-rpc';
const ROUNDS = 10;
const EXPECTED_CHAIN_ID = '0xaa36a7';
const ZERO = '0x0000000000000000000000000000000000000000' as Hex;

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return v;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

interface Timing {
  method: string;
  ok: number;
  failed: number;
  ms: number[];
  lastError?: string;
}

async function main(): Promise<number> {
  const args = scriptArgs();
  const rpc = getSepoliaRpc();
  const addrArg = argValue(args, '--address') ?? getSepoliaFundedAddress();
  const address = addrArg ? parseEthAddress(addrArg, '--address') : ZERO;
  const origin = argValue(args, '--origin') ?? 'http://localhost:5173';

  const client = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 15_000, retryCount: 0 }) });
  const calls: Array<{ method: string; run: () => Promise<unknown> }> = [
    { method: 'eth_chainId', run: () => client.request({ method: 'eth_chainId' }) },
    { method: 'eth_blockNumber', run: () => client.request({ method: 'eth_blockNumber' }) },
    { method: 'eth_getTransactionCount (latest)', run: () => client.request({ method: 'eth_getTransactionCount', params: [address, 'latest'] }) },
    { method: 'eth_getTransactionCount (pending)', run: () => client.request({ method: 'eth_getTransactionCount', params: [address, 'pending'] }) },
    { method: 'eth_maxPriorityFeePerGas', run: () => client.request({ method: 'eth_maxPriorityFeePerGas' }) },
    { method: 'eth_feeHistory', run: () => client.request({ method: 'eth_feeHistory', params: ['0x4', 'latest', [25, 75]] }) },
  ];

  const timings: Timing[] = calls.map((c) => ({ method: c.method, ok: 0, failed: 0, ms: [] }));
  let chainId: unknown = undefined;
  let blockNumber: unknown = undefined;
  let http5xx: string | undefined;

  for (let round = 0; round < ROUNDS; round++) {
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i]!;
      const t = timings[i]!;
      const t0 = performance.now();
      try {
        const v = await c.run();
        t.ms.push(performance.now() - t0);
        t.ok++;
        if (round === 0 && c.method === 'eth_chainId') chainId = v;
        if (round === 0 && c.method === 'eth_blockNumber') blockNumber = v;
      } catch (err) {
        t.failed++;
        t.lastError = (err instanceof Error ? err.message : String(err)).split('\n')[0];
        if (err instanceof HttpRequestError && err.status !== undefined) http5xx = `HTTP ${err.status} from ${rpc}`;
      }
    }
  }

  // Nothing answered at all: an unreachable endpoint is an infrastructure error, not a verdict.
  const everyCallDead = timings.every((t) => t.ok === 0);
  if (everyCallDead && !http5xx) {
    throw new Error(`could not reach Sepolia RPC ${rpc}: ${(timings[0]?.lastError ?? 'no response').replace(/\.+$/, '')}. Check the network or proxy and re-run.`);
  }

  // Invalid raw transaction: must be a JSON-RPC error, not an HTTP error.
  let sendRawResult: 'json-rpc error' | 'http error' | 'network error' | 'accepted' | 'other error' = 'other error';
  let sendRawDetail = '';
  try {
    await client.request({ method: 'eth_sendRawTransaction', params: ['0x02'] });
    sendRawResult = 'accepted';
    sendRawDetail = 'node accepted an invalid transaction (unexpected)';
  } catch (err) {
    if (err instanceof RpcError) {
      // Covers RpcRequestError and the mapped subclasses (InvalidParamsRpcError, ...).
      sendRawResult = 'json-rpc error';
      sendRawDetail = `code ${err.code}: ${err.details ?? err.shortMessage}`;
    } else if (err instanceof HttpRequestError && err.status !== undefined) {
      sendRawResult = 'http error';
      sendRawDetail = `HTTP ${err.status}`;
    } else if (err instanceof HttpRequestError) {
      sendRawResult = 'network error';
      sendRawDetail = (err.shortMessage ?? err.message).split('\n')[0] ?? '';
    } else {
      sendRawResult = 'other error';
      sendRawDetail = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';
    }
  }

  // CORS preflight, as a browser sends before a JSON POST.
  let cors: { ok: boolean; detail: string } = { ok: false, detail: 'not run' };
  try {
    const res = await fetch(rpc, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const acao = res.headers.get('access-control-allow-origin');
    const allowsOrigin = acao !== null && (acao === '*' || acao === origin);
    cors = {
      ok: res.status < 400 && allowsOrigin,
      detail: `status ${res.status}, access-control-allow-origin: ${acao ?? '(missing)'}`,
    };
  } catch (err) {
    cors = { ok: false, detail: `preflight request failed: ${(err as Error).message}` };
  }

  const callsOk = timings.every((t) => t.failed === 0 && t.ok === ROUNDS);
  const chainOk = typeof chainId === 'string' && chainId.toLowerCase() === EXPECTED_CHAIN_ID;
  const sendOk = sendRawResult === 'json-rpc error';
  const reasons: string[] = [];
  for (const t of timings) {
    if (t.failed > 0) reasons.push(`${t.method}: ${t.failed}/${ROUNDS} rounds failed (${t.lastError ?? 'unknown'})`);
  }
  if (!chainOk) reasons.push(`eth_chainId returned ${String(chainId)}, expected ${EXPECTED_CHAIN_ID} (Sepolia)`);
  if (!sendOk) reasons.push(`eth_sendRawTransaction gave ${sendRawResult} (${sendRawDetail}); expected a JSON-RPC error`);
  if (!cors.ok) reasons.push(`CORS preflight: ${cors.detail}`);
  if (http5xx) reasons.push(http5xx);
  if (sendRawResult === 'network error') reasons.push(`eth_sendRawTransaction: network error (${sendRawDetail})`);

  const latency = timings.map((t) => {
    const s = [...t.ms].sort((a, b) => a - b);
    return {
      method: t.method,
      ok: `${t.ok}/${ROUNDS}`,
      median_ms: s.length ? Math.round(percentile(s, 50)) : NaN,
      p95_ms: s.length ? Math.round(percentile(s, 95)) : NaN,
      max_ms: s.length ? Math.round(s[s.length - 1]!) : NaN,
    };
  });
  console.log('');
  for (const row of latency) {
    const f = (n: number) => (Number.isNaN(n) ? 'n/a' : `${n} ms`);
    console.log(`  ${row.method.padEnd(36)} ok ${row.ok.padEnd(6)} median ${f(row.median_ms).padEnd(8)} p95 ${f(row.p95_ms).padEnd(8)} max ${f(row.max_ms)}`);
  }
  console.log('');

  const status: Status = callsOk && chainOk && sendOk && cors.ok ? 'PASS' : 'FAIL';
  report({
    id: ID,
    status,
    summary:
      status === 'PASS'
        ? `Sepolia RPC answered all calls ${ROUNDS} times, accepts sendRawTransaction, and passes the CORS preflight.`
        : 'The Sepolia RPC did not meet one or more requirements.',
    evidence: {
      sepolia_rpc: rpc,
      chain_id: chainId === undefined ? 'n/a' : String(chainId),
      block_number_hex: blockNumber === undefined ? 'n/a' : String(blockNumber),
      address_for_nonce: address,
      send_raw_transaction: `${sendRawResult}: ${sendRawDetail}`,
      cors_preflight: `${cors.ok ? 'ok' : 'fail'} (${cors.detail}; origin ${origin}; approximation, see README)`,
      latency_median_ms: latency.map((r) => `${r.method}: ${Number.isNaN(r.median_ms) ? 'n/a' : r.median_ms}`),
    },
    reasons,
  });
  return status === 'PASS' ? 0 : 1;
}

runMain(ID, main);
