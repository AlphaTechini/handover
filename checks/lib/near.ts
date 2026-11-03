// Minimal NEAR JSON-RPC client for the checks. Uses global fetch only.
// Errors name the RPC URL and the RPC method so a proxy 403 or DNS failure is easy to read.

export class NearRpcError extends Error {
  override name = 'NearRpcError';
}

let idCounter = 0;

export async function nearRpc<T>(url: string, method: string, params: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++idCounter, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
    throw new NearRpcError(`could not reach NEAR RPC ${url} for ${method}: ${detail}. Check the network or proxy and re-run.`);
  }
  if (!res.ok) {
    throw new NearRpcError(`NEAR RPC ${url} returned HTTP ${res.status} for ${method}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message?: string; cause?: { name?: string; info?: unknown } } };
  if (json.error) {
    const cause = json.error.cause?.name ? ` (${json.error.cause.name})` : '';
    throw new NearRpcError(`NEAR RPC ${method} error: ${json.error.message ?? 'unknown'}${cause}`);
  }
  return json.result as T;
}

/** Yoctonear (decimal string) to NEAR with 5 decimals, for display. */
export function formatNear(yocto: bigint): string {
  const base = 10n ** 24n;
  const whole = yocto / base;
  const frac = ((yocto % base) / 10n ** 19n).toString().padStart(5, '0');
  return `${whole}.${frac}`;
}
