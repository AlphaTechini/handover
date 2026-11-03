import type { ContractConfig, Listing, SignedTx, WalletState } from './types';
// TODO(chain-layer): views via NEAR RPC, calls via the connected near-connect wallet.
const ni = (): never => { throw new Error('not implemented'); };
export async function getConfig(): Promise<ContractConfig> { return ni(); }
export async function getWallet(tokenId: string): Promise<WalletState | null> { return ni(); }
export async function getSigLog(tokenId: string, fromIndex?: number, limit?: number): Promise<SignedTx[]> { return ni(); }
export async function getListing(tokenId: string): Promise<Listing | null> { return ni(); }
export async function listListings(fromIndex?: number, limit?: number): Promise<Listing[]> { return ni(); }
export async function tokensForOwner(accountId: string): Promise<string[]> { return ni(); }
export async function totalSupply(): Promise<number> { return ni(); }
/** Mints to the connected account; resolves to the new token id */
export async function mint(): Promise<string> { return ni(); }
export interface TransferRequest { tokenId: string; to: `0x${string}`; valueWei: bigint; gasLimit?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; }
/** Asks the contract to sign a plain ETH transfer; resolves to the recorded signed tx */
export async function requestTransfer(req: TransferRequest): Promise<SignedTx> { return ni(); }
export async function listToken(tokenId: string, priceYocto: string): Promise<void> { return ni(); }
export async function delistToken(tokenId: string): Promise<void> { return ni(); }
export async function buyToken(tokenId: string, priceYocto: string): Promise<void> { return ni(); }
