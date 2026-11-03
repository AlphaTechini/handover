import type { EthFees, Hex } from './types';
// TODO(chain-layer): implement with viem against SEPOLIA_RPC.
const ni = (): never => { throw new Error('not implemented'); };
export async function getBalance(address: Hex): Promise<bigint> { return ni(); }
export async function getNonces(address: Hex): Promise<{ latest: number; pending: number }> { return ni(); }
export async function getFees(): Promise<EthFees> { return ni(); }
/** eth_sendRawTransaction; treats "already known" / "nonce too low" for an already-mined tx as success */
export async function broadcast(rawSignedTxHex: Hex): Promise<Hex> { return ni(); }
export async function waitForReceipt(txHash: Hex): Promise<'success' | 'reverted'> { return ni(); }
export const etherscanTx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
export const etherscanAddress = (a: string) => `https://sepolia.etherscan.io/address/${a}`;
export const nearblocksTx = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
export const nearblocksAccount = (a: string) => `https://testnet.nearblocks.io/address/${a}`;
