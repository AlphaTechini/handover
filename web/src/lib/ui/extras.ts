// Defensive access to chain-layer additions agreed in SPEC (D1, D3) that the
// typed interface may not expose yet. Everything degrades gracefully when absent.
import * as chain from '$lib/chain';
import type { ContractConfig, WalletState } from '$lib/chain';

export interface ReservedTxLike {
	nonce: number;
	to?: string;
	valueWei?: string;
	attempts?: number;
	requestedAtNs?: string;
}

const anyChain = chain as unknown as Record<string, unknown>;

/** The reserved (signed-or-maybe-signed) transaction for a wallet, if the contract reports one. */
export function reservedOf(w: WalletState | null | undefined): ReservedTxLike | null {
	if (!w) return null;
	const r = (w as WalletState & { reserved?: ReservedTxLike | null }).reserved;
	return r && typeof r === 'object' && typeof r.nonce === 'number' ? r : null;
}

/** chain.retryReserved(tokenId) when the chain layer provides it. */
export const retryReserved: ((tokenId: string) => Promise<unknown>) | undefined =
	typeof anyChain.retryReserved === 'function' ? (anyChain.retryReserved as (id: string) => Promise<unknown>) : undefined;

type FeeConfig = ContractConfig & { signFee?: string; signFeeYocto?: string; mintFee?: string; mintFeeYocto?: string };

let cfg: Promise<FeeConfig | null> | null = null;
/** get_config, fetched once per page load. Null when unavailable. */
export function feeConfig(): Promise<FeeConfig | null> {
	if (!cfg) {
		cfg = chain.getConfig().then(
			(c) => c as FeeConfig,
			() => {
				cfg = null;
				return null;
			}
		);
	}
	return cfg;
}

export const signFeeYocto = (c: FeeConfig | null) => c?.signFee ?? c?.signFeeYocto ?? null;
export const mintFeeYocto = (c: FeeConfig | null) => c?.mintFee ?? c?.mintFeeYocto ?? null;
