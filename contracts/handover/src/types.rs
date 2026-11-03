//! Stored (borsh) and returned (JSON) types.
//!
//! Storage types keep raw bytes; view types are the wire format in the project SPEC
//! (u128 as decimal strings, u64 nonces as JSON numbers, nanosecond timestamps as strings).

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

pub type TokenId = String;

/// A transaction that has been reserved for `nonce` but has no logged signature yet.
///
/// Why it exists (decision D1): the MPC `respond` transaction publishes a signature on chain
/// even when our yield times out or our callback fails. A failed attempt therefore does NOT
/// prove that no signature exists. The exact payload stays bound to its nonce until a
/// signature is logged, so any signature that leaks authorises the very same transaction.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct ReservedTx {
    pub nonce: u64,
    pub to: [u8; 20],
    pub value_wei: u128,
    pub gas_limit: u128,
    pub max_fee_per_gas: u128,
    pub max_priority_fee_per_gas: u128,
    pub payload_hash: [u8; 32],
    pub requested_at_ns: u64,
    /// Number of MPC `sign` calls made for this reservation (1 = first attempt).
    pub attempts: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct WalletState {
    /// Next Ethereum nonce the contract will hand out. Strictly sequential, starts at 0.
    pub next_nonce: u64,
    /// A call to the MPC contract is outstanding.
    pub in_flight: bool,
    pub reserved: Option<ReservedTx>,
    pub minted_at_ns: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub seller_id: AccountId,
    pub price: u128,
    pub listed_at_ns: u64,
}

/// One entry of the public signature log. The log is the complete list of every signature
/// the contract has ever obtained for the token's address.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct SignedTx {
    pub nonce: u64,
    pub to: [u8; 20],
    pub value_wei: u128,
    pub gas_limit: u128,
    pub max_fee_per_gas: u128,
    pub max_priority_fee_per_gas: u128,
    pub tx_hash: [u8; 32],
    pub raw_signed_tx: Vec<u8>,
    pub signed_at_ns: u64,
}

// ---------------------------------------------------------------- JSON views

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ConfigView {
    pub mpc_contract_id: AccountId,
    pub chain_id: u64,
    pub path_prefix: String,
    pub sign_fee: U128,
    pub mint_fee: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ListingView {
    pub token_id: TokenId,
    pub seller_id: AccountId,
    pub price: U128,
    pub listed_at_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ReservedTxView {
    pub nonce: u64,
    pub to: String,
    pub value_wei: U128,
    pub gas_limit: U128,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub payload_hash_hex: String,
    pub requested_at_ns: U64,
    pub attempts: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct WalletView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub path: String,
    pub next_nonce: u64,
    pub in_flight: bool,
    pub listing: Option<ListingView>,
    pub reserved: Option<ReservedTxView>,
    pub sig_count: u64,
    pub minted_at_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SignedTxView {
    pub nonce: u64,
    pub to: String,
    pub value_wei: U128,
    pub gas_limit: U128,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub tx_hash: String,
    pub raw_signed_tx_hex: String,
    pub signed_at_ns: U64,
}

fn hex0x(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

impl ReservedTx {
    pub fn view(&self) -> ReservedTxView {
        ReservedTxView {
            nonce: self.nonce,
            to: hex0x(&self.to),
            value_wei: U128(self.value_wei),
            gas_limit: U128(self.gas_limit),
            max_fee_per_gas: U128(self.max_fee_per_gas),
            max_priority_fee_per_gas: U128(self.max_priority_fee_per_gas),
            payload_hash_hex: hex0x(&self.payload_hash),
            requested_at_ns: U64(self.requested_at_ns),
            attempts: self.attempts,
        }
    }
}

impl SignedTx {
    pub fn view(&self) -> SignedTxView {
        SignedTxView {
            nonce: self.nonce,
            to: hex0x(&self.to),
            value_wei: U128(self.value_wei),
            gas_limit: U128(self.gas_limit),
            max_fee_per_gas: U128(self.max_fee_per_gas),
            max_priority_fee_per_gas: U128(self.max_priority_fee_per_gas),
            tx_hash: hex0x(&self.tx_hash),
            raw_signed_tx_hex: hex0x(&self.raw_signed_tx),
            signed_at_ns: U64(self.signed_at_ns),
        }
    }
}
