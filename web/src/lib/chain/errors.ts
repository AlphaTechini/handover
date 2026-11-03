// Extracts human-readable failure messages from NEAR execution outcomes (pure).

const BOILERPLATE = [
	/^Smart contract panicked:\s*/i,
	/^wasm execution failed with error:\s*/i,
	/^FunctionCallError\(.*?ExecutionError\(\s*"?/i
];

/** Strips NEAR runtime boilerplate so a contract panic string reads as the contract wrote it. */
export function cleanPanicMessage(raw: string): string {
	let s = raw.trim();
	let prev: string;
	do {
		prev = s;
		for (const re of BOILERPLATE) s = s.replace(re, '');
		s = s.trim();
	} while (s !== prev);
	// Debug-style wrappers: ...ExecutionError("msg")...
	const m = /ExecutionError\("((?:[^"\\]|\\.)*)"\)/.exec(s);
	if (m) s = cleanPanicMessage(m[1].replace(/\\"/g, '"'));
	return s;
}

/** Finds the first contract error string inside a failure object. */
function findMessage(node: unknown, depth = 0): string | null {
	if (depth > 8 || node == null) return null;
	if (typeof node === 'string') return node;
	if (typeof node !== 'object') return null;
	const o = node as Record<string, unknown>;
	if (typeof o.ExecutionError === 'string') return o.ExecutionError;
	for (const key of ['ActionError', 'kind', 'FunctionCallError', 'Failure', 'error_message', 'ExecutionError']) {
		if (key in o) {
			const r = findMessage(o[key], depth + 1);
			if (r) return r;
		}
	}
	for (const v of Object.values(o)) {
		const r = findMessage(v, depth + 1);
		if (r) return r;
	}
	return null;
}

function failureOf(status: unknown): unknown {
	if (status && typeof status === 'object' && 'Failure' in (status as object)) {
		return (status as { Failure: unknown }).Failure;
	}
	return undefined;
}

/**
 * Returns the panic/failure message of an outcome, or null when it succeeded.
 * Looks at the final status first, then at every receipt outcome.
 */
export function extractOutcomeError(outcome: any): string | null {
	const failures: unknown[] = [];
	const top = failureOf(outcome?.status);
	if (top !== undefined) failures.push(top);
	const receipts: any[] = outcome?.receipts_outcome ?? outcome?.receiptsOutcome ?? [];
	for (const r of receipts) {
		const f = failureOf(r?.outcome?.status);
		if (f !== undefined) failures.push(f);
	}
	for (const f of failures) {
		const msg = findMessage(f);
		if (msg) return cleanPanicMessage(msg);
	}
	return failures.length > 0 ? 'Transaction failed' : null;
}

/** NEAR transaction hash from an outcome, if present. */
export function outcomeTxHash(outcome: any): string | null {
	return (
		outcome?.transaction_outcome?.id ??
		outcome?.transactionOutcome?.id ??
		outcome?.transaction?.hash ??
		null
	);
}

/** Decodes `status.SuccessValue` (base64 JSON). Null when absent or empty. */
export function decodeSuccessValue<T>(outcome: any): T | null {
	const b64 = outcome?.status?.SuccessValue;
	if (typeof b64 !== 'string' || b64 === '') return null;
	const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	const text = new TextDecoder().decode(bytes);
	return text === '' ? null : (JSON.parse(text) as T);
}

/** True when the contract refused a buy because the wallet moved after the buyer's clean check. */
export function isWalletChangedError(message: string): boolean {
	return /changed since you checked/i.test(message);
}
