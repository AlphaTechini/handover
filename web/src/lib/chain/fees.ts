// Pure Ethereum fee/error helpers (no network, no config).
import type { EthFees } from './types';

export const FALLBACK_FEES: EthFees = { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_500_000_000n };

/** The contract rejects max_fee_per_gas below 1 gwei. */
export const MIN_MAX_FEE_PER_GAS = 1_000_000_000n;
/** The contract only signs plain transfers with exactly this gas limit. */
export const FIXED_GAS_LIMIT = 21000n;

/** Raises maxFeePerGas to the 1 gwei floor, keeps priority within 1..maxFee. */
export function clampFees(fees: EthFees): EthFees {
	const maxFeePerGas = fees.maxFeePerGas < MIN_MAX_FEE_PER_GAS ? MIN_MAX_FEE_PER_GAS : fees.maxFeePerGas;
	let maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
	if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas;
	if (maxPriorityFeePerGas < 1n) maxPriorityFeePerGas = 1n;
	return { maxFeePerGas, maxPriorityFeePerGas };
}

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
