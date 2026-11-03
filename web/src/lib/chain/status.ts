import type { WalletStatus } from './types';
// TODO(chain-layer): combine contract state + Sepolia nonce through @handover/cleancheck.
export async function getWalletStatus(tokenId: string): Promise<WalletStatus> { throw new Error('not implemented'); }
