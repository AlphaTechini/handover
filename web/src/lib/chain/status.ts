import {
	cleanCheck,
	ethBalance,
	ethNonce,
	fetchSigLog,
	fetchWallet,
	fromSignedTxView,
	fromWalletView,
	signerRecoveryProblems
} from '@handover/cleancheck';
import { toSignedTx, toWalletState } from './convert';
import { HANDOVER_CONTRACT, NEAR_RPC, SEPOLIA_RPC } from './config';
import { walletAddress } from './address';
import { broadcast } from './eth';
import type { Hex, SignedTx, WalletStatus } from './types';

/** Reads contract + Sepolia state for a token and runs the clean check. Throws if the token has no wallet. */
export async function getWalletStatus(tokenId: string): Promise<WalletStatus> {
	if (!HANDOVER_CONTRACT) throw new Error('PUBLIC_HANDOVER_CONTRACT is not configured');
	const [walletView, sigViews, address] = await Promise.all([
		fetchWallet(NEAR_RPC, HANDOVER_CONTRACT, tokenId),
		fetchSigLog(NEAR_RPC, HANDOVER_CONTRACT, tokenId),
		walletAddress(tokenId)
	]);
	if (walletView === null) throw new Error(`Wallet ${tokenId} does not exist`);
	const [chainNonce, pendingChainNonce, balanceWei] = await Promise.all([
		ethNonce(SEPOLIA_RPC, address, 'latest'),
		ethNonce(SEPOLIA_RPC, address, 'pending'),
		ethBalance(SEPOLIA_RPC, address)
	]);
	const records = sigViews.map(fromSignedTxView);
	const result = cleanCheck(fromWalletView(walletView), records, {
		confirmedNonce: chainNonce,
		pendingNonce: pendingChainNonce,
		derivedAddress: address
	});
	// Every logged signature must recover to this wallet's address.
	const signerProblems = signerRecoveryProblems(address, records);
	return {
		tokenId,
		wallet: toWalletState(walletView),
		address,
		balanceWei,
		chainNonce,
		pendingChainNonce,
		verdict: signerProblems.length > 0 ? 'inconsistent' : result.verdict,
		reasons: signerProblems.length > 0 ? [...signerProblems, ...result.reasons] : result.reasons,
		pending: result.pending as SignedTx[],
		sigLog: sigViews.map(toSignedTx),
		checkedAt: Date.now()
	};
}

/** Fresh re-check (alias, e.g. right before a purchase). */
export const recheck = getWalletStatus;

/** Broadcasts every pending signed tx in nonce order; resolves to their Sepolia hashes. */
export async function broadcastPending(status: Pick<WalletStatus, 'pending'>): Promise<Hex[]> {
	const hashes: Hex[] = [];
	for (const tx of [...status.pending].sort((a, b) => a.nonce - b.nonce)) {
		hashes.push(await broadcast(tx.rawSignedTxHex));
	}
	return hashes;
}
