//! Handover: an NFT that owns its own Ethereum wallet, and a sale flow that lets you buy the
//! wallet without trusting the seller.
//!
//! Each token has an Ethereum address derived by NEAR Chain Signatures from
//! `(this contract's account, "handover-<token_id>")`. Only this contract can obtain signatures
//! for it, and only for the token's current owner, only for plain ETH transfers it builds
//! itself, with strictly sequential nonces that it records in a public log.
//!
//! The four resale risks and where they are closed:
//!  1. Pre-signed transactions: every signature is logged publicly with a sequential nonce;
//!     listing freezes signing, so a buyer can verify (off-chain) that the wallet's on-chain
//!     nonce caught up with `next_nonce`. A failed signing attempt keeps its exact transaction
//!     reserved (see `ReservedTx`) so a signature that leaked out is never "unaccounted for".
//!  2. Standing approvals: the contract can only build empty-calldata ETH transfers, so no
//!     approval (ERC-20 `approve`, `setApprovalForAll`, ...) can ever be signed.
//!  3. Upgradeable contract: there are no owner/admin methods and no upgrade path at all.
//!     After the final deploy the account's full-access keys are deleted.
//!  4. Non-atomic payment: `buy` pays the seller and moves the NFT in one transaction.
//!
//! Unit tests live in `tests.rs`.

// A callback that panics after MPC produced a signature would corrupt nonce bookkeeping, and
// `unwrap`/`expect` hide panics. Forbid them in production code (tests are exempt).
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};
use std::collections::HashMap;

mod events;
mod market;
mod mpc;
mod tx;
mod types;
mod views;
mod wallet;

#[cfg(test)]
mod tests;

pub use mpc::*;
pub use tx::SEPOLIA_CHAIN_ID;
pub use types::*;

/// Path prefix for MPC key derivation: the path of token `7` is `handover-7`.
pub const PATH_PREFIX: &str = "handover-";
/// Minimum attached to `request_transfer` / `retry_reserved`. 1 yocto goes to MPC; the rest
/// stays in the contract to pay storage for the signature log and the reservation.
pub const SIGN_FEE: NearToken = NearToken::from_millinear(10); // 0.01 NEAR
/// Minimum attached to `nft_mint`. Storage actually used is charged, the rest is refunded.
pub const MINT_FEE: NearToken = NearToken::from_millinear(50); // 0.05 NEAR
/// Default and maximum page sizes for list views.
pub const DEFAULT_PAGE: u64 = 50;
pub const MAX_PAGE: u64 = 100;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    NonFungibleToken,
    Metadata,
    TokenMetadata,
    Enumeration,
    Approval,
    Wallets,
    SigLog,
    Listings,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Handover {
    pub(crate) tokens: NonFungibleToken,
    pub(crate) metadata: LazyOption<NFTContractMetadata>,
    pub(crate) mpc_contract_id: AccountId,
    pub(crate) chain_id: u64,
    pub(crate) wallets: LookupMap<TokenId, WalletState>,
    /// Signature log keyed by `(token_id, nonce)`; nonces are dense 0..next_nonce so this is an
    /// append-only, index-addressable list (same information as a per-token vector, without
    /// nesting collections).
    pub(crate) sig_log: LookupMap<(TokenId, u64), SignedTx>,
    pub(crate) listings: IterableMap<TokenId, Listing>,
    pub(crate) next_token_id: u64,
}

#[near]
impl Handover {
    /// Initialise. There is deliberately no owner/admin concept afterwards: nothing can change
    /// `mpc_contract_id` or `chain_id`, and there is no upgrade method.
    #[init]
    pub fn new(mpc_contract_id: AccountId, chain_id: u64) -> Self {
        require!(!env::state_exists(), "Already initialized");
        let metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Handover".to_string(),
            symbol: "HANDOVER".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        metadata.assert_valid();
        Self {
            // The NFT standard's `owner_id` is only used by its deprecated admin-mint; we never
            // call that path. Set it to the contract itself so nobody else is privileged.
            tokens: NonFungibleToken::new(
                StorageKey::NonFungibleToken,
                env::current_account_id(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approval),
            ),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            mpc_contract_id,
            chain_id,
            wallets: LookupMap::new(StorageKey::Wallets),
            sig_log: LookupMap::new(StorageKey::SigLog),
            listings: IterableMap::new(StorageKey::Listings),
            next_token_id: 0,
        }
    }

    /// Mint the next sequential token ("0", "1", ...) to the caller.
    ///
    /// Requires `MINT_FEE`; charges the measured storage cost and refunds the excess.
    #[payable]
    pub fn nft_mint(&mut self) -> Token {
        let deposit = env::attached_deposit();
        require!(deposit >= MINT_FEE, "Attach at least 0.05 NEAR to mint");
        let owner_id = env::predecessor_account_id();
        let token_id = self.next_token_id.to_string();
        self.next_token_id = self.next_token_id.checked_add(1).unwrap_or_else(|| {
            env::panic_str("token id overflow");
        });

        let before = env::storage_usage();
        let metadata = TokenMetadata {
            title: Some(format!("Handover #{token_id}")),
            description: Some(
                "An NFT that owns its own Ethereum wallet (NEAR Chain Signatures).".to_string(),
            ),
            media: None,
            media_hash: None,
            copies: None,
            issued_at: Some(env::block_timestamp_ms().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: None,
            reference: None,
            reference_hash: None,
        };
        // `_with_refund(.., None)`: we do the refund ourselves after measuring everything.
        let token = self.tokens.internal_mint_with_refund(
            token_id.clone(),
            owner_id.clone(),
            Some(metadata),
            None,
        );
        self.wallets.insert(
            token_id.clone(),
            WalletState {
                next_nonce: 0,
                in_flight: false,
                reserved: None,
                minted_at_ns: env::block_timestamp(),
            },
        );
        self.wallets.flush(); // store collections write lazily; flush so usage is measurable
        let used = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(used.into());
        require!(cost <= deposit, "Deposit does not cover storage");
        let refund = deposit.saturating_sub(cost);
        if refund > NearToken::from_yoctonear(1) {
            Promise::new(owner_id.clone()).transfer(refund).detach();
        }
        NftMint {
            owner_id: &owner_id,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();
        token
    }
}

// --------------------------------------------------------------------------------- guards

impl Handover {
    pub(crate) fn owner_of(&self, token_id: &str) -> Option<AccountId> {
        self.tokens.owner_by_id.get(&token_id.to_string())
    }

    /// Panics unless the token exists and the caller is its CURRENT owner. After `buy` or
    /// `nft_transfer` the old owner fails here (risk 1: seller keeps signing after the sale).
    pub(crate) fn require_owner(&self, token_id: &str) -> AccountId {
        let owner = self
            .owner_of(token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"));
        require!(
            env::predecessor_account_id() == owner,
            "Only the token owner can do this"
        );
        owner
    }

    pub(crate) fn wallet(&self, token_id: &str) -> &WalletState {
        self.wallets
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Wallet not found"))
    }

    pub(crate) fn is_listed(&self, token_id: &str) -> bool {
        self.listings.contains_key(token_id)
    }

    /// Ownership may only change when the wallet is quiescent: not listed (a listed token must be
    /// delisted first), no MPC call in flight, no reserved transaction awaiting a signature.
    /// Otherwise a seller could hand the token over while a signature is still being produced.
    pub(crate) fn assert_transferable(&self, token_id: &str) {
        if let Some(w) = self.wallets.get(token_id) {
            require!(
                !self.is_listed(token_id),
                "Token is listed: delist it first"
            );
            require!(!w.in_flight, "A signature request is in flight");
            require!(
                w.reserved.is_none(),
                "A reserved transaction is pending: call retry_reserved first"
            );
        }
    }
}

// --------------------------------------------------------------------------- NEP-171 etc.

#[near]
impl NonFungibleTokenCore for Handover {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: near_contract_standards::non_fungible_token::TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.assert_transferable(&token_id);
        self.tokens
            .nft_transfer(receiver_id, token_id, approval_id, memo);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: near_contract_standards::non_fungible_token::TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.assert_transferable(&token_id);
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(
        &self,
        token_id: near_contract_standards::non_fungible_token::TokenId,
    ) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Handover {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: near_contract_standards::non_fungible_token::TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

#[near]
impl NonFungibleTokenApproval for Handover {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: near_contract_standards::non_fungible_token::TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(
        &mut self,
        token_id: near_contract_standards::non_fungible_token::TokenId,
        account_id: AccountId,
    ) {
        self.tokens.nft_revoke(token_id, account_id);
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: near_contract_standards::non_fungible_token::TokenId) {
        self.tokens.nft_revoke_all(token_id);
    }

    fn nft_is_approved(
        &self,
        token_id: near_contract_standards::non_fungible_token::TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Handover {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Handover {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata
            .get()
            .unwrap_or_else(|| env::panic_str("metadata missing"))
    }
}
