import type { SignedTxRecord, SignedTxView, WalletInput, WalletView } from './types';

/** Maps the contract's WalletView to the clean-check input. `listed` is true when a listing exists. */
export function fromWalletView(v: WalletView): WalletInput {
  return {
    nextNonce: v.next_nonce,
    inFlight: v.in_flight,
    listed: v.listing != null,
  };
}

export function fromSignedTxView(v: SignedTxView): SignedTxRecord {
  return {
    nonce: v.nonce,
    to: v.to,
    valueWei: v.value_wei,
    gasLimit: v.gas_limit,
    maxFeePerGas: v.max_fee_per_gas,
    maxPriorityFeePerGas: v.max_priority_fee_per_gas,
    txHash: v.tx_hash,
    rawSignedTxHex: v.raw_signed_tx_hex,
    signedAtNs: v.signed_at_ns,
  };
}
