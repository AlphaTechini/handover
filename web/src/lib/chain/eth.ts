import { createPublicClient, http, keccak256, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';
import { ETH_EXPLORER, NEAR_EXPLORER, SEPOLIA_RPC } from './config';
import { clampFees, FALLBACK_FEES, isAlreadyKnownError, withHeadroom } from './fees';
import type { EthFees, Hex } from './types';

let client: PublicClient | null = null;
function pc(): PublicClient {
	return (client ??= createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) }) as PublicClient);
}

export async function getBalance(address: Hex): Promise<bigint> {
	return pc().getBalance({ address });
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
	const r = await pc().waitForTransactionReceipt({ hash: txHash, timeout: 120_000, pollingInterval: 3_000 });
	return r.status;
}

export const etherscanTx = (h: string) => `${ETH_EXPLORER}/tx/${h}`;
export const etherscanAddress = (a: string) => `${ETH_EXPLORER}/address/${a}`;
export const nearblocksTx = (h: string) => `${NEAR_EXPLORER}/txns/${h}`;
export const nearblocksAccount = (a: string) => `${NEAR_EXPLORER}/address/${a}`;
