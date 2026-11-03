import { nearView, type ListingView, type SignedTxView, type WalletView } from '@handover/cleancheck';
import { callContract, nearWallet } from './wallet.svelte';
import { HANDOVER_CONTRACT, MARKET_GAS, MINT_GAS, NEAR_RPC, SIGN_GAS } from './config';
import {
	classifySigning,
	toConfig,
	toListing,
	toSignedTx,
	toWalletState,
	type ConfigView
} from './convert';
import { getFees } from './eth';
import type { ContractConfig, Listing, SignedTx, WalletState } from './types';

function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
	if (!HANDOVER_CONTRACT) return Promise.reject(new Error('PUBLIC_HANDOVER_CONTRACT is not configured'));
	return nearView<T>(NEAR_RPC, HANDOVER_CONTRACT, method, args);
}

// --- views ------------------------------------------------------------------

const CONFIG_TTL_MS = 5_000;
let configCache: { at: number; value: Promise<ContractConfig> } | null = null;

export function getConfig(): Promise<ContractConfig> {
	const now = Date.now();
	if (configCache && now - configCache.at < CONFIG_TTL_MS) return configCache.value;
	const value = view<ConfigView>('get_config').then(toConfig);
	configCache = { at: now, value };
	value.catch(() => {
		if (configCache?.value === value) configCache = null;
	});
	return value;
}

export async function getWallet(tokenId: string): Promise<WalletState | null> {
	const w = await view<WalletView | null>('get_wallet', { token_id: tokenId });
	return w ? toWalletState(w) : null;
}

export async function getSigLog(tokenId: string, fromIndex = 0, limit = 50): Promise<SignedTx[]> {
	const rows = await view<SignedTxView[]>('get_sig_log', { token_id: tokenId, from_index: fromIndex, limit });
	return rows.map(toSignedTx);
}

export async function getListing(tokenId: string): Promise<Listing | null> {
	const l = await view<ListingView | null>('get_listing', { token_id: tokenId });
	return l ? toListing(l) : null;
}

export async function listListings(fromIndex = 0, limit = 50): Promise<Listing[]> {
	const rows = await view<ListingView[]>('list_listings', { from_index: fromIndex, limit });
	return rows.map(toListing);
}

export async function tokensForOwner(accountId: string): Promise<string[]> {
	const ids: string[] = [];
	const page = 50;
	for (let from = 0; ; from += page) {
		const rows = await view<{ token_id: string }[]>('nft_tokens_for_owner', {
			account_id: accountId,
			from_index: String(from),
			limit: page
		});
		ids.push(...rows.map((t) => t.token_id));
		if (rows.length < page) break;
	}
	return ids;
}

export async function totalSupply(): Promise<number> {
	const n = await view<string | number>('nft_total_supply');
	return Number(n);
}

// --- calls ------------------------------------------------------------------

/** Mints to the connected account; resolves to the new token id */
export async function mint(): Promise<string> {
	const cfg = await getConfig();
	const { value } = await callContract<{ token_id: string }>('nft_mint', {}, { gas: MINT_GAS, deposit: cfg.mintFeeYocto });
	if (value?.token_id != null) return String(value.token_id);
	// Wallet returned no outcome: newest token (highest id) owned by the account.
	if (nearWallet.accountId) {
		const ids = (await tokensForOwner(nearWallet.accountId)).map(BigInt);
		if (ids.length > 0) return ids.reduce((a, b) => (b > a ? b : a)).toString();
	}
	throw new Error('Mint was sent but the new token id could not be read; check My wallets');
}

export interface TransferRequest { tokenId: string; to: `0x${string}`; valueWei: bigint; gasLimit?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; }

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 90_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const SIGNING_INCOMPLETE = 'MPC signing did not complete; retry the reserved transaction';

/** Polls contract state until the signature with `nonce` is logged; throws if signing failed or timed out. */
async function awaitSignature(tokenId: string, nonce: number): Promise<SignedTx> {
	const deadline = Date.now() + POLL_TIMEOUT_MS;
	for (;;) {
		let raw: WalletView | null = null;
		try {
			raw = await view<WalletView | null>('get_wallet', { token_id: tokenId });
		} catch {
			/* transient RPC error: keep polling */
		}
		if (raw) {
			const progress = classifySigning(nonce, raw);
			if (progress === 'signed') {
				const log = await getSigLog(tokenId, nonce, 1);
				const hit = log.find((t) => t.nonce === nonce);
				if (hit) return hit;
			} else if (progress === 'failed') {
				throw new Error(SIGNING_INCOMPLETE);
			}
		}
		if (Date.now() >= deadline) throw new Error('Timed out waiting for the MPC signature; refresh and check the wallet');
		await sleep(POLL_INTERVAL_MS);
	}
}

async function signCall(tokenId: string, method: string, args: Record<string, unknown>, nonce: number): Promise<SignedTx> {
	const cfg = await getConfig();
	const { value } = await callContract<SignedTxView | null>(method, args, { gas: SIGN_GAS, deposit: cfg.signFeeYocto });
	if (value && value.nonce === nonce) return toSignedTx(value);
	return awaitSignature(tokenId, nonce);
}

/** Asks the contract to sign a plain ETH transfer; resolves to the recorded signed tx */
export async function requestTransfer(req: TransferRequest): Promise<SignedTx> {
	let { maxFeePerGas, maxPriorityFeePerGas } = req;
	if (maxFeePerGas === undefined || maxPriorityFeePerGas === undefined) {
		const fees = await getFees();
		maxFeePerGas ??= fees.maxFeePerGas;
		maxPriorityFeePerGas ??= fees.maxPriorityFeePerGas;
	}
	const before = await getWallet(req.tokenId);
	if (!before) throw new Error(`Wallet ${req.tokenId} does not exist`);
	return signCall(
		req.tokenId,
		'request_transfer',
		{
			token_id: req.tokenId,
			to: req.to.toLowerCase(),
			value_wei: req.valueWei.toString(),
			gas_limit: (req.gasLimit ?? 21000n).toString(),
			max_fee_per_gas: maxFeePerGas.toString(),
			max_priority_fee_per_gas: maxPriorityFeePerGas.toString()
		},
		before.nextNonce
	);
}

/** Re-requests a signature for the reserved transaction left by a failed attempt */
export async function retryReserved(tokenId: string): Promise<SignedTx> {
	const before = await getWallet(tokenId);
	if (!before) throw new Error(`Wallet ${tokenId} does not exist`);
	const nonce = before.reserved?.nonce ?? before.nextNonce;
	return signCall(tokenId, 'retry_reserved', { token_id: tokenId }, nonce);
}

export async function listToken(tokenId: string, priceYocto: string): Promise<void> {
	await callContract('list', { token_id: tokenId, price: priceYocto }, { gas: MARKET_GAS, deposit: '1' });
}

export async function delistToken(tokenId: string): Promise<void> {
	await callContract('delist', { token_id: tokenId }, { gas: MARKET_GAS, deposit: '1' });
}

export async function buyToken(tokenId: string, priceYocto: string): Promise<void> {
	await callContract('buy', { token_id: tokenId }, { gas: MARKET_GAS, deposit: priceYocto });
}

