import { describe, expect, it } from 'vitest';
import { clampFees, FALLBACK_FEES, FIXED_GAS_LIMIT, MIN_MAX_FEE_PER_GAS, isAlreadyKnownError, withHeadroom } from './fees';

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
	it('gas limit is fixed at 21000', () => expect(FIXED_GAS_LIMIT).toBe(21000n));
});
