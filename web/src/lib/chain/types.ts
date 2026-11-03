// Shared types for the web app's chain layer. These mirror the Handover contract's
// JSON views (snake_case on the wire, converted to camelCase here).

export type Hex = `0x${string}`;

export interface Listing {
	tokenId: string;
	sellerId: string;
	/** Price in yoctoNEAR, decimal string */
	priceYocto: string;
	listedAtNs: string;
}

/** Transaction reserved by a signing attempt that has not completed (a signature for it may exist). */
export interface ReservedTx {
	nonce: number;
	to: Hex;
	valueWei: string;
	gasLimit: string;
	maxFeePerGas: string;
	maxPriorityFeePerGas: string;
	payloadHashHex: string;
	requestedAtNs: string;
	attempts: number;
}

export interface WalletState {
	tokenId: string;
	ownerId: string;
	/** MPC derivation path, `handover-<tokenId>` */
	path: string;
	/** Next nonce the contract will hand out. Equals the number of signatures ever issued. */
	nextNonce: number;
	/** True while an MPC sign request is outstanding */
	inFlight: boolean;
	listing: Listing | null;
	sigCount: number;
	mintedAtNs: string;
	/** Set when a signing attempt did not complete; the owner must call retryReserved */
	reserved: ReservedTx | null;
}

export interface SignedTx {
	nonce: number;
	to: Hex;
	valueWei: string;
	gasLimit: string;
	maxFeePerGas: string;
	maxPriorityFeePerGas: string;
	txHash: Hex;
	rawSignedTxHex: Hex;
	signedAtNs: string;
}

export interface ContractConfig {
	mpcContractId: string;
	chainId: number;
	pathPrefix: string;
	/** Minimum deposit for request_transfer / retry_reserved, yoctoNEAR */
	signFeeYocto: string;
	/** Minimum deposit for nft_mint, yoctoNEAR */
	mintFeeYocto: string;
}

export interface EthFees {
	maxFeePerGas: bigint;
	maxPriorityFeePerGas: bigint;
}

export type Verdict = 'clean' | 'dirty' | 'busy' | 'inconsistent';

export interface WalletStatus {
	tokenId: string;
	wallet: WalletState;
	address: Hex;
	balanceWei: bigint;
	/** Confirmed nonce on Sepolia (eth_getTransactionCount at "latest") */
	chainNonce: number;
	/** Nonce including mempool ("pending") */
	pendingChainNonce: number;
	verdict: Verdict;
	reasons: string[];
	/** Signed transactions that exist but are not mined yet (nonce >= chainNonce) */
	pending: SignedTx[];
	sigLog: SignedTx[];
	checkedAt: number;
}

export interface NearWalletState {
	accountId: string | null;
	connecting: boolean;
	ready: boolean;
}
