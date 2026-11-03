// Display helpers (pure). TODO(chain-layer) may extend.
export function formatEth(wei: bigint, digits = 6): string { const s = wei.toString().padStart(19, '0'); const i = s.slice(0, -18); const f = s.slice(-18).slice(0, digits).replace(/0+$/, ''); return f ? `${i}.${f}` : i; }
export function formatNear(yocto: string | bigint, digits = 4): string { const s = BigInt(yocto).toString().padStart(25, '0'); const i = s.slice(0, -24); const f = s.slice(-24).slice(0, digits).replace(/0+$/, ''); return f ? `${i}.${f}` : i; }
export function parseEth(eth: string): bigint { const [i, f = ''] = eth.trim().split('.'); return BigInt(i || '0') * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18)); }
export function parseNear(near: string): bigint { const [i, f = ''] = near.trim().split('.'); return BigInt(i || '0') * 10n ** 24n + BigInt((f + '0'.repeat(24)).slice(0, 24)); }
export const shortHex = (h: string, n = 4) => (h.length > 2 + n * 2 ? `${h.slice(0, 2 + n)}…${h.slice(-n)}` : h);
export const nsToDate = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n));
