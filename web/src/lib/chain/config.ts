// TODO(chain-layer): read from $env/static/public with sane testnet defaults.
export const NEAR_NETWORK: 'testnet' = 'testnet';
export const HANDOVER_CONTRACT = '';
export const MPC_CONTRACT = 'v1.signer-prod.testnet';
export const NEAR_RPC = '';
export const SEPOLIA_RPC = '';
export const SEPOLIA_CHAIN_ID = 11155111;
export const NEAR_EXPLORER = 'https://testnet.nearblocks.io';
export const ETH_EXPLORER = 'https://sepolia.etherscan.io';
/** Default gas attached to request_transfer (MPC sign needs a lot) */
export const SIGN_GAS = '300000000000000';
/** True when the contract id is configured; UI shows a setup notice otherwise */
export const isConfigured = (): boolean => HANDOVER_CONTRACT.length > 0;
