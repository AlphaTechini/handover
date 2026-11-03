/** Hex string with 0x prefix. */
export type Hex = `0x${string}`;

// ---------------------------------------------------------------------------
// Wire types: the NEAR contract's JSON, snake_case, exactly as returned.
// ---------------------------------------------------------------------------

export interface ListingView {
  token_id: string;
  seller_id: string;
  /** yoctoNEAR, decimal string. */
  price: string;
  listed_at_ns: string;
}

export interface ReservedTxView {
  nonce: number;
  to: string;
  value_wei: string;
  gas_limit: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  payload_hash_hex: string;
  requested_at_ns: string;
  attempts: number;
  /** NEAR block height of the signing request. Absent in old fixtures. */
  requested_at_block?: number;
}

export interface WalletView {
  token_id: string;
  owner_id: string;
  path: string;
  next_nonce: number;
  in_flight: boolean;
  listing: ListingView | null;
  sig_count: number;
  minted_at_ns: string;
  /** Transaction reserved by a signing attempt that did not complete. Absent in old fixtures. */
  reserved?: ReservedTxView | null;
  /** True while an nft_transfer_call is unresolved (the owner may change). Absent in old fixtures. */
  transfer_call_pending?: boolean;
  /** Trust-on-first-use signer address recorded by the contract (0x lowercase), or null. Absent in old fixtures. */
  eth_address?: string | null;
}

export interface SignedTxView {
  nonce: number;
  /** 0x + 40 lowercase hex. */
  to: Hex;
  value_wei: string;
  gas_limit: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  /** 0x + 64 hex. */
  tx_hash: Hex;
  raw_signed_tx_hex: Hex;
  signed_at_ns: string;
}

// ---------------------------------------------------------------------------
// Domain types (camelCase).
// ---------------------------------------------------------------------------

export interface WalletInput {
  nextNonce: number;
  inFlight: boolean;
  listed: boolean;
  /** Set when a signing attempt for this nonce did not complete. */
  reserved?: { nonce: number } | null;
  /** An nft_transfer_call is unresolved; the owner may change. */
  transferCallPending?: boolean;
  /** Address recorded by the contract at the first signature (trust on first use). */
  ethAddress?: Hex | null;
}

export interface SignedTxRecord {
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

export interface ChainInput {
  /** Sepolia `eth_getTransactionCount(address, "latest")`. */
  confirmedNonce: number;
  /** Sepolia `eth_getTransactionCount(address, "pending")`, if known. */
  pendingNonce?: number;
  /**
   * The wallet address derived from the MPC public key. When given and `wallet.ethAddress` is set,
   * the two must match (case-insensitive), otherwise the verdict is "inconsistent".
   */
  derivedAddress?: Hex;
}

export type Verdict = 'clean' | 'dirty' | 'busy' | 'inconsistent';

export interface CleanCheckResult {
  verdict: Verdict;
  reasons: string[];
  /** Signed transactions with nonce >= confirmed nonce, sorted by nonce. */
  pending: SignedTxRecord[];
  /** Subset of `pending` already in the Sepolia mempool (needs `pendingNonce`). */
  inMempool: SignedTxRecord[];
  issuedNonce: number;
  chainNonce: number;
  pendingChainNonce: number | null;
}
