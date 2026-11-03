// Public surface of the chain layer. UI code imports ONLY from `$lib/chain`.
// Implementation lives in sibling modules (config, near, handover, eth, address, status, wallet.svelte).
export * from './types';
export * from './config';
export * from './wallet.svelte';
export * from './handover';
export * from './eth';
export * from './address';
export * from './status';
export * from './format';
export { clampFees, FIXED_GAS_LIMIT, MIN_MAX_FEE_PER_GAS } from './fees';
export { isWalletChangedError } from './errors';
