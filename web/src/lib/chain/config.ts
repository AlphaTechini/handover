// Public configuration. SvelteKit 3 has no `$env/*` modules; PUBLIC_* variables are exposed through
// Vite (`envPrefix: 'PUBLIC_'` in vite.config.ts) and inlined at build time. A missing variable is
// `undefined` and falls back to a default, so it never breaks the build. See web/.env.example.
const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<
	string,
	string | undefined
>;

const pick = (v: string | undefined, fallback: string): string => {
	const t = (v ?? '').trim();
	return t.length > 0 ? t : fallback;
};

export const NEAR_NETWORK: 'testnet' = 'testnet';
export const HANDOVER_CONTRACT = pick(env.PUBLIC_HANDOVER_CONTRACT, '');
export const MPC_CONTRACT = pick(env.PUBLIC_MPC_CONTRACT, 'v1.signer-prod.testnet');
export const NEAR_RPC = pick(env.PUBLIC_NEAR_RPC, 'https://test.rpc.fastnear.com');
export const SEPOLIA_RPC = pick(env.PUBLIC_SEPOLIA_RPC, 'https://ethereum-sepolia-rpc.publicnode.com');
export const SEPOLIA_CHAIN_ID = 11155111;
export const NEAR_EXPLORER = 'https://testnet.nearblocks.io';
export const ETH_EXPLORER = 'https://sepolia.etherscan.io';
/** Default gas attached to request_transfer (MPC sign needs a lot) */
export const SIGN_GAS = '300000000000000';
/** Gas attached to nft_mint */
export const MINT_GAS = '100000000000000';
/** Gas attached to list / delist / buy */
export const MARKET_GAS = '100000000000000';
/** True when the contract id is configured; UI shows a setup notice otherwise */
export const isConfigured = (): boolean => HANDOVER_CONTRACT.length > 0;
