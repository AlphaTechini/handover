import { describe, expect, it } from 'vitest';
import { cleanPanicMessage, isWalletChangedError, decodeSuccessValue, extractOutcomeError, outcomeTxHash } from './errors';

const failure = (msg: string) => ({ Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: msg } } } } });

describe('panic extraction', () => {
	it('strips boilerplate', () => {
		expect(cleanPanicMessage('Smart contract panicked: Only the token owner can sign')).toBe('Only the token owner can sign');
		expect(cleanPanicMessage('wasm execution failed with error: Smart contract panicked: nope')).toBe('nope');
	});
	it('reads top-level failure', () => {
		expect(extractOutcomeError({ status: failure('Smart contract panicked: Token is listed') })).toBe('Token is listed');
	});
	it('reads receipt failure when top-level status is ok-ish', () => {
		const o = { status: { SuccessValue: '' }, receipts_outcome: [{ outcome: { status: failure('Smart contract panicked: bad deposit') } }] };
		expect(extractOutcomeError(o)).toBe('bad deposit');
	});
	it('returns null on success', () => {
		expect(extractOutcomeError({ status: { SuccessValue: '' }, receipts_outcome: [{ outcome: { status: { SuccessValue: '' } } }] })).toBeNull();
	});
	it('generic message for unknown failure shapes', () => {
		expect(extractOutcomeError({ status: { Failure: {} } })).toBe('Transaction failed');
	});
});

describe('outcome helpers', () => {
	it('decodes SuccessValue json', () => {
		const b64 = btoa(JSON.stringify({ token_id: '7' }));
		expect(decodeSuccessValue({ status: { SuccessValue: b64 } })).toEqual({ token_id: '7' });
		expect(decodeSuccessValue({ status: { SuccessValue: btoa('null') } })).toBeNull();
		expect(decodeSuccessValue({ status: { SuccessValue: '' } })).toBeNull();
	});
	it('finds the tx hash', () => {
		expect(outcomeTxHash({ transaction_outcome: { id: 'abc' } })).toBe('abc');
		expect(outcomeTxHash({ transaction: { hash: 'def' } })).toBe('def');
		expect(outcomeTxHash({})).toBeNull();
	});
});

describe('isWalletChangedError', () => {
	it('matches the contract buy rejection', () => {
		expect(isWalletChangedError('Wallet changed since you checked it')).toBe(true);
		expect(isWalletChangedError('Attach exactly the listed price')).toBe(false);
	});
});
