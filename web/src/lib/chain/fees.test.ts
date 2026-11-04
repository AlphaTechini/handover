import { describe, expect, it } from 'vitest';
import {
	clampFees,
	FALLBACK_FEES,
	MAX_GAS_LIMIT,
	MIN_GAS_LIMIT,
	MIN_MAX_FEE_PER_GAS,
	isAlreadyKnownError,
	pickGasLimit,
	withHeadroom
} from './fees';

describe('fees', () => {
	it('adds 20% headroom to maxFee only', () => {
		expect(withHeadroom({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n })).toEqual({ maxFeePerGas: 120n, maxPriorityFeePerGas: 10n });
	});
	it('never lets maxFee fall below priority', () => {
		expect(withHeadroom({ maxFeePerGas: 1n, maxPriorityFeePerGas: 5n }).maxFeePerGas).toBe(5n);
	});
	it('fallback is 30 / 1.5 gwei', () => {
		expect(FALLBACK_FEES).toEqual({ maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_500_000_000n });
	});
	it('detects already-known errors', () => {
		expect(isAlreadyKnownError('ALREADY KNOWN')).toBe(true);
		expect(isAlreadyKnownError('nonce too low: next nonce 3')).toBe(true);
		expect(isAlreadyKnownError('insufficient funds')).toBe(false);
	});
	it('clamps maxFee up to 1 gwei and priority to at most maxFee', () => {
		expect(clampFees({ maxFeePerGas: 5n, maxPriorityFeePerGas: 4n })).toEqual({ maxFeePerGas: MIN_MAX_FEE_PER_GAS, maxPriorityFeePerGas: 4n });
		expect(clampFees({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 3_000_000_000n })).toEqual({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n });
	});
	it('never produces a zero priority fee and leaves valid fees alone', () => {
		expect(clampFees({ maxFeePerGas: 9_000_000_000n, maxPriorityFeePerGas: 0n }).maxPriorityFeePerGas).toBe(1n);
		expect(clampFees(FALLBACK_FEES)).toEqual(FALLBACK_FEES);
	});
	it('gas limit range matches the contract (21000..300000)', () => {
		expect(MIN_GAS_LIMIT).toBe(21000n);
		expect(MAX_GAS_LIMIT).toBe(300000n);
	});
	it('existing account gets exactly 21000', () => expect(pickGasLimit(21000n)).toBe(21000n));
	it('smart account estimate gets 20% headroom', () => expect(pickGasLimit(24393n)).toBe(29271n));
	it('empty account (Glamsterdam) fits under the cap', () => expect(pickGasLimit(207391n)).toBe(248869n));
	it('small estimates are raised to 21000 and big ones capped', () => {
		expect(pickGasLimit(15000n)).toBe(21000n);
		expect(pickGasLimit(280000n)).toBe(300000n);
	});
	it('refuses recipients that need more than the cap', () => expect(pickGasLimit(300001n)).toBeNull());
});
