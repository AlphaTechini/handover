import type { NearWalletState } from './types';
// TODO(chain-layer): implement with @hot-labs/near-connect.
export const nearWallet: NearWalletState = $state({ accountId: null, connecting: false, ready: false });
export async function initWallet(): Promise<void> { throw new Error('not implemented'); }
export async function connectWallet(): Promise<void> { throw new Error('not implemented'); }
export async function disconnectWallet(): Promise<void> { throw new Error('not implemented'); }
