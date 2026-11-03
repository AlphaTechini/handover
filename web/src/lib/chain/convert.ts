// Pure snake_case (contract wire format) -> camelCase (UI types) converters. No env/config imports,
// so they can be unit-tested without SvelteKit.
import type { ListingView, ReservedTxView, SignedTxView, WalletView } from '@handover/cleancheck';
import type { Hex, Listing, ReservedTx, SignedTx, WalletState } from './types';

export function toListing(v: ListingView): Listing {
	return { tokenId: v.token_id, sellerId: v.seller_id, priceYocto: v.price, listedAtNs: v.listed_at_ns };
}

export function toSignedTx(v: SignedTxView): SignedTx {
	return {
		nonce: v.nonce,
		to: v.to,
		valueWei: v.value_wei,
		gasLimit: v.gas_limit,
		maxFeePerGas: v.max_fee_per_gas,
		maxPriorityFeePerGas: v.max_priority_fee_per_gas,
		txHash: v.tx_hash,
		rawSignedTxHex: v.raw_signed_tx_hex,
		signedAtNs: v.signed_at_ns
	};
}

export function toReserved(v: ReservedTxView): ReservedTx {
	return {
		nonce: v.nonce,
		to: v.to as Hex,
		valueWei: v.value_wei,
		gasLimit: v.gas_limit,
		maxFeePerGas: v.max_fee_per_gas,
		maxPriorityFeePerGas: v.max_priority_fee_per_gas,
		payloadHashHex: v.payload_hash_hex,
		requestedAtNs: v.requested_at_ns,
		attempts: v.attempts
	};
}

export function toWalletState(v: WalletView): WalletState {
	return {
		tokenId: v.token_id,
		ownerId: v.owner_id,
		path: v.path,
		nextNonce: v.next_nonce,
		inFlight: v.in_flight,
		listing: v.listing ? toListing(v.listing) : null,
		sigCount: v.sig_count,
		mintedAtNs: v.minted_at_ns,
		reserved: v.reserved ? toReserved(v.reserved) : null
	};
}

export interface ConfigView {
	mpc_contract_id: string;
	chain_id: number;
	path_prefix: string;
	sign_fee?: string;
	mint_fee?: string;
}

/** Defaults mirror SPEC D3 (0.01 NEAR sign fee, 0.05 NEAR mint fee) for contracts that omit them. */
export const DEFAULT_SIGN_FEE_YOCTO = '10000000000000000000000';
export const DEFAULT_MINT_FEE_YOCTO = '50000000000000000000000';

export function toConfig(v: ConfigView) {
	return {
		mpcContractId: v.mpc_contract_id,
		chainId: v.chain_id,
		pathPrefix: v.path_prefix,
		signFeeYocto: v.sign_fee ?? DEFAULT_SIGN_FEE_YOCTO,
		mintFeeYocto: v.mint_fee ?? DEFAULT_MINT_FEE_YOCTO
	};
}

export type SignProgress = 'signed' | 'failed' | 'waiting';

/**
 * Decides what a post-request wallet state means. `nonceBefore` is the nonce the request used.
 * - signed: next_nonce moved past it
 * - failed: a reserved tx is stored and nothing is in flight (MPC did not complete)
 * - waiting: otherwise (still in flight, or the transaction has not landed yet)
 */
export function classifySigning(nonceBefore: number, w: Pick<WalletView, 'next_nonce' | 'in_flight' | 'reserved'>): SignProgress {
	if (w.next_nonce > nonceBefore) return 'signed';
	if (w.reserved != null && !w.in_flight) return 'failed';
	return 'waiting';
}
