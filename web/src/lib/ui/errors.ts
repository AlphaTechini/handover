// Turns whatever a chain call threw into something a person can read.
// Contract refusals are shown verbatim: the demo depends on a visible, honest refusal.

export type ErrorKind =
	| 'unavailable'
	| 'refused'
	| 'rejected'
	| 'network'
	| 'not-configured'
	| 'not-connected'
	| 'incomplete'
	| 'unknown';

export interface DescribedError {
	kind: ErrorKind;
	title: string;
	detail: string;
	/** The original message, untouched */
	raw: string;
	/** For contract refusals: the panic message as the contract wrote it */
	refusal?: string;
}

export function errorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (typeof e === 'string') return e;
	try {
		return JSON.stringify(e);
	} catch {
		return String(e);
	}
}

/** Extracts the contract's own panic text from a NEAR execution error, if there is one. */
export function contractRefusal(raw: string): string | undefined {
	const patterns = [
		/Smart contract panicked:\s*([^"\n]+)/i,
		/Smart contract panicked:\s*([\s\S]+?)(?:\n|$)/i,
		/panicked at [^:]*:\s*([\s\S]+?)(?:\n|$)/i,
		/"ExecutionError"\s*:\s*"([^"]+)"/i,
		/FunctionCallError\(ExecutionError\("([^"]+)"\)\)/i
	];
	for (const p of patterns) {
		const m = raw.match(p);
		if (m?.[1]) {
			const msg = m[1]
				.replace(/^Smart contract panicked:\s*/i, '')
				.replace(/\\"/g, '"')
				.replace(/["'}\])\s,.]+$/, '')
				.trim();
			if (msg) return msg;
		}
	}
	return undefined;
}

/**
 * @param opts.contractCall the error came from a contract change call (request_transfer, list, buy...).
 *   The chain layer strips NEAR's "Smart contract panicked:" prefix, so for these calls any message
 *   that is not a known client-side condition is the contract's own panic text and is shown verbatim.
 */
export function describeError(e: unknown, opts: { contractCall?: boolean } = {}): DescribedError {
	const raw = errorMessage(e);
	const lower = raw.toLowerCase();
	const refusal = contractRefusal(raw);
	if (refusal) {
		return { kind: 'refused', title: 'The contract refused', detail: refusal, raw, refusal };
	}
	if (lower.includes('not implemented')) {
		return {
			kind: 'unavailable',
			title: 'Chain connection unavailable',
			detail: 'This build of the app cannot reach NEAR or Sepolia yet, so live data could not be loaded.',
			raw
		};
	}
	if (lower.includes('not configured') || lower.includes('public_handover_contract')) {
		return {
			kind: 'not-configured',
			title: 'Contract not configured',
			detail: 'Set PUBLIC_HANDOVER_CONTRACT to the deployed Handover contract account to load live data.',
			raw
		};
	}
	if (lower.includes('connect a near wallet') || lower.includes('connector is not available')) {
		return { kind: 'not-connected', title: 'Wallet not connected', detail: 'Connect a NEAR testnet wallet and try again.', raw };
	}
	if (lower.includes('signing did not complete') || lower.includes('timed out waiting for the mpc signature')) {
		return {
			kind: 'incomplete',
			title: 'Signing did not complete',
			detail: lower.includes('timed out')
				? 'The NEAR signing network has not answered yet. Re-check the wallet in a moment: the signature may still land.'
				: 'The contract kept this transfer reserved, because a signature for it may exist. Retry it from the wallet page.',
			raw
		};
	}
	if (/(user )?(rejected|denied|cancel+ed|closed)/i.test(raw)) {
		// Some wallets report a closed popup this way even after the transaction ran, so never claim nothing was sent.
		return {
			kind: 'rejected',
			title: 'Wallet did not confirm',
			detail:
				'Your wallet returned no result. If you cancelled, nothing was sent. If you approved it, it may still have run: check your account on NearBlocks before trying again.',
			raw
		};
	}
	if (/(failed to fetch|network|timeout|timed out|econn|503|502|429)/i.test(raw)) {
		return { kind: 'network', title: 'Network problem', detail: 'An RPC endpoint did not respond. Check your connection and try again.', raw };
	}
	if (opts.contractCall && raw && !/does not exist|only available in the browser/i.test(raw)) {
		return { kind: 'refused', title: 'The contract refused', detail: raw, raw, refusal: raw };
	}
	return { kind: 'unknown', title: 'Something went wrong', detail: raw || 'Unknown error', raw };
}
