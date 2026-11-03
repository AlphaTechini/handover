import { describe, expect, it } from 'vitest';
import { FALLBACK_FEES, isAlreadyKnownError, withHeadroom } from './fees';

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
});
