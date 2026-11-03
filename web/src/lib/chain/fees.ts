// Pure Ethereum fee/error helpers (no network, no config).
import type { EthFees } from './types';

export const FALLBACK_FEES: EthFees = { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_500_000_000n };

/** Adds `percent`% headroom to maxFeePerGas (priority fee unchanged); maxFee never drops below priority. */
export function withHeadroom(fees: EthFees, percent = 20): EthFees {
	const maxFeePerGas = (fees.maxFeePerGas * BigInt(100 + percent)) / 100n;
	return {
		maxFeePerGas: maxFeePerGas < fees.maxPriorityFeePerGas ? fees.maxPriorityFeePerGas : maxFeePerGas,
		maxPriorityFeePerGas: fees.maxPriorityFeePerGas
	};
}

/** True for node errors meaning the exact transaction is already known or mined. */
export function isAlreadyKnownError(message: string): boolean {
	const m = message.toLowerCase();
	return m.includes('already known') || m.includes('nonce too low') || m.includes('known transaction');
}
