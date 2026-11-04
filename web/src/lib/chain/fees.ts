// Pure Ethereum fee/error helpers (no network, no config).
import type { EthFees } from './types';

export const FALLBACK_FEES: EthFees = { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_500_000_000n };

/** The contract rejects max_fee_per_gas below 1 gwei. */
export const MIN_MAX_FEE_PER_GAS = 1_000_000_000n;
/**
 * Gas limit range the contract signs. 21000 is a transfer to an existing account; since Glamsterdam
 * (EIP-2780/EIP-8037) value sent to an empty account costs ~207k, and smart accounts run code on receive.
 */
export const MIN_GAS_LIMIT = 21000n;
export const MAX_GAS_LIMIT = 300000n;

/**
 * Gas limit from the node's estimate: exactly 21000 when that is all it needs, otherwise the
 * estimate plus 20% headroom, capped. Null when the recipient needs more than the cap.
 */
export function pickGasLimit(estimate: bigint): bigint | null {
	if (estimate > MAX_GAS_LIMIT) return null;
	if (estimate <= MIN_GAS_LIMIT) return MIN_GAS_LIMIT;
	const padded = (estimate * 120n) / 100n;
	return padded > MAX_GAS_LIMIT ? MAX_GAS_LIMIT : padded;
}

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
