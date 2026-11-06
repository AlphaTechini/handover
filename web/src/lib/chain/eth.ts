import { createPublicClient, http, keccak256, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';
import { ETH_EXPLORER, NEAR_EXPLORER, SEPOLIA_RPC } from './config';
import { clampFees, FALLBACK_FEES, isAlreadyKnownError, pickGasLimit, withHeadroom } from './fees';
import type { EthFees, Hex } from './types';

let client: PublicClient | null = null;
export function pc(): PublicClient {
	return (client ??= createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) }) as PublicClient);
}

/** Balance at `block` when given (a node that has not reached it errors instead of answering stale), else latest. */
export async function getBalance(address: Hex, block?: bigint): Promise<bigint> {
	return pc().getBalance(block === undefined ? { address } : { address, blockNumber: block });
}

export async function getNonces(address: Hex): Promise<{ latest: number; pending: number }> {
	const [latest, pending] = await Promise.all([
		pc().getTransactionCount({ address, blockTag: 'latest' }),
		pc().getTransactionCount({ address, blockTag: 'pending' })
	]);
	return { latest, pending };
}

/** EIP-1559 fees with 20% headroom on maxFee; clamped to the contract's 1 gwei floor; falls back to 30 / 1.5 gwei if estimation fails. */
export async function getFees(): Promise<EthFees> {
	try {
		const est = await pc().estimateFeesPerGas();
		if (est.maxFeePerGas == null || est.maxPriorityFeePerGas == null) return FALLBACK_FEES;
		return clampFees(withHeadroom({ maxFeePerGas: est.maxFeePerGas, maxPriorityFeePerGas: est.maxPriorityFeePerGas }));
	} catch {
		return FALLBACK_FEES;
	}
}

/**
 * Gas limit for sending `value` from `from` to `to`, always estimated: an empty recipient account
 * and an EIP-7702 smart account both look like plain addresses but cost far more than 21000.
 * Null means the recipient needs more gas than the contract will sign. Throws if estimation fails.
 */
export async function transferGasLimit(from: Hex, to: Hex, value: bigint): Promise<bigint | null> {
	return pickGasLimit(await pc().estimateGas({ account: from, to, value }));
}

/** eth_sendRawTransaction; treats "already known" / "nonce too low" as success and returns keccak256(raw) */
export async function broadcast(rawSignedTxHex: Hex): Promise<Hex> {
	try {
		return await pc().sendRawTransaction({ serializedTransaction: rawSignedTxHex });
	} catch (err) {
		const text = [err instanceof Error ? err.message : '', (err as any)?.details ?? '', (err as any)?.shortMessage ?? ''].join(' ');
		if (isAlreadyKnownError(text)) return keccak256(rawSignedTxHex);
		throw err;
	}
}

export async function waitForReceipt(txHash: Hex): Promise<'success' | 'reverted'> {
	return (await waitForMined(txHash)).status;
}

export async function waitForMined(txHash: Hex): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint }> {
	const r = await pc().waitForTransactionReceipt({ hash: txHash, timeout: 120_000, pollingInterval: 3_000 });
	return { status: r.status, blockNumber: r.blockNumber };
}

export const etherscanTx = (h: string) => `${ETH_EXPLORER}/tx/${h}`;
export const etherscanAddress = (a: string) => `${ETH_EXPLORER}/address/${a}`;
export const nearblocksTx = (h: string) => `${NEAR_EXPLORER}/txns/${h}`;
export const nearblocksAccount = (a: string) => `${NEAR_EXPLORER}/address/${a}`;
