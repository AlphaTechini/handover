// Pure snake_case (contract wire format) -> camelCase (UI types) converters. No env/config imports,
// so they can be unit-tested without SvelteKit.
import type { ListingView, ReservedTxView, SignedTxView, WalletView } from '@handover/cleancheck';
import type { ContractConfig, Hex, Listing, ReservedTx, SignedTx, WalletState } from './types';

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
		attempts: v.attempts,
		requestedAtBlock: v.requested_at_block ?? 0
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
		reserved: v.reserved ? toReserved(v.reserved) : null,
		transferCallPending: v.transfer_call_pending === true,
		ethAddress: (v.eth_address ?? null) as Hex | null
	};
}

export interface ConfigView {
	mpc_contract_id: string;
	chain_id: number;
	path_prefix: string;
	sign_fee?: string;
	mint_fee?: string;
	release_after_blocks?: number;
}

/** Defaults mirror SPEC D3 (0.01 NEAR sign fee, 0.05 NEAR mint fee) for contracts that omit them. */
export const DEFAULT_SIGN_FEE_YOCTO = '10000000000000000000000';
export const DEFAULT_MINT_FEE_YOCTO = '50000000000000000000000';

export const DEFAULT_RELEASE_AFTER_BLOCKS = 300;

export function toConfig(v: ConfigView): ContractConfig {
	return {
		mpcContractId: v.mpc_contract_id,
		chainId: v.chain_id,
		pathPrefix: v.path_prefix,
		signFeeYocto: v.sign_fee ?? DEFAULT_SIGN_FEE_YOCTO,
		mintFeeYocto: v.mint_fee ?? DEFAULT_MINT_FEE_YOCTO,
		releaseAfterBlocks: v.release_after_blocks ?? DEFAULT_RELEASE_AFTER_BLOCKS
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

/** Deposit for request_transfer / retry_reserved: the contract keeps sign_fee and forwards the remaining 1 yocto (or more) to MPC. */
export function signDepositYocto(signFeeYocto: string): string {
	return (BigInt(signFeeYocto) + 1n).toString();
}

/**
 * True when the owner may call release_stuck: a request is in flight and the current NEAR block height is
 * beyond the request's block plus the release window. `height` is the current block height.
 */
export function canReleaseStuck(
	wallet: Pick<WalletState, 'inFlight' | 'reserved'>,
	config: Pick<ContractConfig, 'releaseAfterBlocks'>,
	height: number
): boolean {
	if (!wallet.inFlight || !wallet.reserved) return false;
	return height > wallet.reserved.requestedAtBlock + config.releaseAfterBlocks;
}

/** Blocks left before release_stuck becomes available (0 when it already is). */
export function blocksUntilRelease(
	wallet: Pick<WalletState, 'inFlight' | 'reserved'>,
	config: Pick<ContractConfig, 'releaseAfterBlocks'>,
	height: number
): number {
	if (!wallet.inFlight || !wallet.reserved) return 0;
	return Math.max(0, wallet.reserved.requestedAtBlock + config.releaseAfterBlocks + 1 - height);
}
