import { describe, expect, it } from 'vitest';
import { formatEth, formatGwei, formatNear, isEthAddress, parseEth, parseNear, shortHex } from './format';

describe('format', () => {
	it('formats and parses ETH', () => {
		expect(formatEth(1_500_000_000_000_000_000n)).toBe('1.5');
		expect(formatEth(0n)).toBe('0');
		expect(parseEth('0.0001')).toBe(100_000_000_000_000n);
		expect(parseEth('2')).toBe(2n * 10n ** 18n);
	});
	it('formats and parses NEAR', () => {
		expect(formatNear('50000000000000000000000')).toBe('0.05');
		expect(parseNear('0.01')).toBe(10n ** 22n);
	});
	it('gwei', () => {
		expect(formatGwei(1_500_000_000n)).toBe('1.5');
		expect(formatGwei(30_000_000_000n)).toBe('30');
	});
	it('shortHex / address check', () => {
		expect(shortHex('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
		expect(isEthAddress('0x' + 'ab'.repeat(20))).toBe(true);
		expect(isEthAddress('0x12')).toBe(false);
	});
});
