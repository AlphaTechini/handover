// Token side of v2: calldata encoding for gas estimation, gas limits, ERC-20 metadata, and the
// token holdings of a wallet. Holdings come from Blockscout's public API (keyless, CORS open);
// it is the only module that knows that provider.
import { decodeFunctionData, encodeFunctionData, formatUnits, parseAbi, parseTransaction, type Hex } from 'viem';
import { pc } from './eth';
import { MIN_GAS_LIMIT } from './fees';
import type { TokenStandard } from './handover';

const ABI = parseAbi([
	'function transfer(address to, uint256 amount) returns (bool)',
	'function safeTransferFrom(address from, address to, uint256 id)',
	'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
	'function decimals() view returns (uint8)',
	'function symbol() view returns (string)'
]);

/** Token transfers run token code and receiver hooks, so the contract allows more gas for them. */
export const MAX_TOKEN_GAS_LIMIT = 500000n;

/**
 * Calldata of a token transfer, byte for byte what the contract builds (`tx.rs`
 * `validate_token_transfer`). Used only to estimate gas; the contract encodes its own copy.
 */
export function encodeTokenTransfer(standard: TokenStandard, from: Hex, to: Hex, id: bigint, amount: bigint): Hex {
	if (standard === 'erc20') return encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [to, amount] });
	if (standard === 'erc721') return encodeFunctionData({ abi: ABI, functionName: 'safeTransferFrom', args: [from, to, id] });
	return encodeFunctionData({ abi: ABI, functionName: 'safeTransferFrom', args: [from, to, id, amount, '0x'] });
}

/** Estimate plus 20% headroom, capped; null when the transfer needs more than the contract signs. */
export function pickTokenGasLimit(estimate: bigint): bigint | null {
	if (estimate > MAX_TOKEN_GAS_LIMIT) return null;
	const padded = (estimate * 120n) / 100n;
	if (padded < MIN_GAS_LIMIT) return MIN_GAS_LIMIT;
	return padded > MAX_TOKEN_GAS_LIMIT ? MAX_TOKEN_GAS_LIMIT : padded;
}

/** Gas limit for a token transfer out of `from`. Throws when the node says it would revert. */
export async function tokenTransferGasLimit(from: Hex, token: Hex, data: Hex): Promise<bigint | null> {
	return pickTokenGasLimit(await pc().estimateGas({ account: from, to: token, data }));
}

export interface Erc20Meta {
	symbol: string;
	decimals: number;
}

export async function readErc20Meta(token: Hex): Promise<Erc20Meta> {
	const [symbol, decimals] = await Promise.all([
		pc().readContract({ address: token, abi: ABI, functionName: 'symbol' }).catch(() => 'tokens'),
		pc().readContract({ address: token, abi: ABI, functionName: 'decimals' })
	]);
	return { symbol: String(symbol), decimals: Number(decimals) };
}

export interface TokenHolding {
	standard: TokenStandard;
	token: Hex;
	symbol: string;
	name: string;
	decimals: number;
	/** null for ERC-20 */
	id: string | null;
	/** raw units (ERC-20 base units, ERC-1155 amount, 1 for ERC-721) */
	amount: bigint;
}

const BLOCKSCOUT = 'https://eth-sepolia.blockscout.com/api/v2';

const STANDARDS: Record<string, TokenStandard> = { 'ERC-20': 'erc20', 'ERC-721': 'erc721', 'ERC-1155': 'erc1155' };

/** Short human label for a holding, e.g. "50 HTT", "HTN #0", "2 × #7". */
export function formatHolding(h: TokenHolding): string {
	const name = h.symbol || h.name || 'token';
	if (h.standard === 'erc20') return `${formatUnits(h.amount, h.decimals)} ${name}`;
	if (h.standard === 'erc721') return `${name} #${h.id}`;
	return `${h.amount} × ${name} #${h.id}`;
}

export interface TokenCall {
	standard: TokenStandard;
	token: Hex;
	recipient: Hex;
	id: bigint | null;
	amount: bigint;
}

/** Decodes a logged signed transaction that moves a token; null for plain ETH transfers. */
export function describeTokenCall(rawSignedTxHex: Hex): TokenCall | null {
	try {
		const tx = parseTransaction(rawSignedTxHex);
		if (!tx.data || tx.data === '0x' || !tx.to) return null;
		const { functionName, args } = decodeFunctionData({ abi: ABI, data: tx.data });
		if (functionName === 'transfer') return { standard: 'erc20', token: tx.to, recipient: args[0], id: null, amount: args[1] };
		if (functionName === 'safeTransferFrom' && args.length === 3)
			return { standard: 'erc721', token: tx.to, recipient: args[1], id: args[2], amount: 1n };
		if (functionName === 'safeTransferFrom' && args.length === 5)
			return { standard: 'erc1155', token: tx.to, recipient: args[1], id: args[2], amount: args[3] };
	} catch {
		/* not a token call */
	}
	return null;
}

function holding(standard: TokenStandard, token: any, id: string | null, value: string | undefined): TokenHolding | null {
	const address = (token?.address_hash ?? token?.address) as Hex | undefined;
	if (!address) return null;
	return {
		standard,
		token: address,
		symbol: token.symbol ?? '',
		name: token.name ?? '',
		decimals: Number(token.decimals ?? 0),
		id,
		amount: BigInt(value ?? '0')
	};
}

async function getJson(path: string): Promise<any> {
	const res = await fetch(`${BLOCKSCOUT}${path}`);
	if (!res.ok) throw new Error(`Token index unavailable (${res.status})`);
	return res.json();
}

/**
 * Tokens held by an address on Sepolia, from Blockscout's index (may lag the chain by a few blocks).
 * ERC-20 balances come from `token-balances`; NFTs from `nft`, which also carries each token id.
 */
export async function getTokenHoldings(address: Hex): Promise<TokenHolding[]> {
	const [balances, nfts] = await Promise.all([
		getJson(`/addresses/${address}/token-balances`) as Promise<any[]>,
		getJson(`/addresses/${address}/nft?type=ERC-721,ERC-1155`) as Promise<{ items?: any[] }>
	]);
	const out: TokenHolding[] = [];
	for (const it of balances) {
		if (STANDARDS[it?.token?.type] !== 'erc20') continue;
		const h = holding('erc20', it.token, null, it.value);
		if (h && h.amount > 0n) out.push(h);
	}
	for (const it of nfts.items ?? []) {
		const standard = STANDARDS[it?.token_type ?? it?.token?.type];
		if (standard !== 'erc721' && standard !== 'erc1155') continue;
		const h = holding(standard, it.token, it.id ?? null, it.value);
		if (h && h.amount > 0n) out.push(h);
	}
	return out;
}
