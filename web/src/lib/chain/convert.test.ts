import { describe, expect, it } from 'vitest';
import { classifySigning, toConfig, toSignedTx, toWalletState } from './convert';

const reserved = {
	nonce: 3, to: '0x' + '22'.repeat(20), value_wei: '5', gas_limit: '21000', max_fee_per_gas: '9',
	max_priority_fee_per_gas: '1', payload_hash_hex: '0xab', requested_at_ns: '77', attempts: 2
};
const wallet = {
	token_id: '4', owner_id: 'a.testnet', path: 'handover-4', next_nonce: 3, in_flight: false,
	listing: { token_id: '4', seller_id: 'a.testnet', price: '10', listed_at_ns: '9' },
	sig_count: 3, minted_at_ns: '1', reserved
};

describe('converters', () => {
	it('maps wallet view incl. listing and reserved', () => {
		const w = toWalletState(wallet);
		expect(w.tokenId).toBe('4');
		expect(w.nextNonce).toBe(3);
		expect(w.inFlight).toBe(false);
		expect(w.listing).toEqual({ tokenId: '4', sellerId: 'a.testnet', priceYocto: '10', listedAtNs: '9' });
		expect(w.reserved).toMatchObject({ nonce: 3, valueWei: '5', payloadHashHex: '0xab', requestedAtNs: '77', attempts: 2 });
	});
	it('missing reserved/listing become null', () => {
		const w = toWalletState({ ...wallet, listing: null, reserved: undefined });
		expect(w.listing).toBeNull();
		expect(w.reserved).toBeNull();
	});
	it('maps signed tx', () => {
		const t = toSignedTx({
			nonce: 0, to: ('0x' + '11'.repeat(20)) as `0x${string}`, value_wei: '1', gas_limit: '21000',
			max_fee_per_gas: '3', max_priority_fee_per_gas: '2', tx_hash: ('0x' + '00'.repeat(32)) as `0x${string}`,
			raw_signed_tx_hex: '0x02', signed_at_ns: '5'
		});
		expect(t).toMatchObject({ maxFeePerGas: '3', maxPriorityFeePerGas: '2', rawSignedTxHex: '0x02', signedAtNs: '5' });
	});
	it('maps config with fee defaults', () => {
		expect(toConfig({ mpc_contract_id: 'm', chain_id: 11155111, path_prefix: 'handover-', sign_fee: '1', mint_fee: '2' }))
			.toEqual({ mpcContractId: 'm', chainId: 11155111, pathPrefix: 'handover-', signFeeYocto: '1', mintFeeYocto: '2' });
		expect(toConfig({ mpc_contract_id: 'm', chain_id: 1, path_prefix: 'p' }).signFeeYocto).toBe('10000000000000000000000');
	});
});

describe('classifySigning', () => {
	it('signed when nonce advanced', () => expect(classifySigning(2, { next_nonce: 3, in_flight: false, reserved: null })).toBe('signed'));
	it('failed when reserved and idle', () => expect(classifySigning(3, { next_nonce: 3, in_flight: false, reserved })).toBe('failed'));
	it('waiting while in flight', () => expect(classifySigning(3, { next_nonce: 3, in_flight: true, reserved })).toBe('waiting'));
	it('waiting when nothing landed yet', () => expect(classifySigning(3, { next_nonce: 3, in_flight: false, reserved: null })).toBe('waiting'));
});
