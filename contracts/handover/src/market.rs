//! Listing and atomic purchase.
//!
//! Listing freezes signing (`request_transfer` / `retry_reserved` reject listed tokens), which
//! is what makes the off-chain "clean" check meaningful: once listed, no new signature can
//! appear, so a buyer can compare the chain nonce to `next_nonce` and be sure.

use crate::types::*;
use crate::{events, Handover, HandoverExt};
use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, near, require, NearToken, Promise};

#[near]
impl Handover {
    /// List the token for `price` yoctoNEAR. Owner only, exactly 1 yocto.
    ///
    /// Rejected while a signature is in flight or a reserved transaction is pending: listing
    /// then would let a signature appear after the buyer's clean check.
    #[payable]
    pub fn list(&mut self, token_id: TokenId, price: U128) {
        assert_one_yocto();
        let seller = self.require_owner(&token_id);
        require!(price.0 > 0, "Price must be greater than 0");
        require!(!self.is_listed(&token_id), "Already listed");
        self.assert_no_transfer_call(&token_id);
        let w = self.wallet(&token_id);
        require!(!w.in_flight, "A signature request is in flight");
        require!(
            w.reserved.is_none(),
            "A reserved transaction is pending: call retry_reserved first"
        );
        self.listings.insert(
            token_id.clone(),
            Listing {
                seller_id: seller.clone(),
                price: price.0,
                listed_at_ns: env::block_timestamp(),
            },
        );
        events::listed(&token_id, &seller, price.0);
    }

    /// Remove the listing and unfreeze signing. Owner only, exactly 1 yocto.
    #[payable]
    pub fn delist(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let seller = self.require_owner(&token_id);
        require!(self.listings.remove(&token_id).is_some(), "Not listed");
        events::delisted(&token_id, &seller);
    }

    /// Buy a listed token. Attach EXACTLY the price (no refund path) and pass the wallet's
    /// `next_nonce` as you verified it. If the wallet changed since your clean check (for
    /// example the seller delisted, signed and relisted) `next_nonce` moved and the call fails.
    ///
    /// Everything happens in this one call (risk 4): the listing is removed, the NFT moves to
    /// the buyer (approvals are cleared by the standard transfer), and the seller is paid
    /// exactly `price`. If any step panics the whole call reverts.
    #[payable]
    pub fn buy(&mut self, token_id: TokenId, expected_next_nonce: u64) {
        let buyer = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        let listing = self.listings.get(&token_id).cloned().unwrap_or_else(|| {
            env::panic_str("Token is not listed");
        });
        let price = NearToken::from_yoctonear(listing.price);
        require!(deposit == price, "Attach exactly the listed price");
        require!(
            buyer != listing.seller_id,
            "Seller cannot buy their own listing"
        );
        self.assert_no_transfer_call(&token_id);
        // Defence in depth: these cannot hold while listed (list() and the transfer guards keep
        // them out), but a sale of a wallet with a pending signature must never go through.
        let w = self.wallet(&token_id);
        require!(
            w.next_nonce == expected_next_nonce,
            "Wallet changed since you checked it"
        );
        require!(
            !w.in_flight && w.reserved.is_none(),
            "Wallet has a pending signature"
        );
        require!(
            self.owner_of(&token_id).as_ref() == Some(&listing.seller_id),
            "Listing seller is no longer the owner"
        );

        self.listings.remove(&token_id);
        self.tokens.internal_transfer(
            &listing.seller_id,
            &buyer,
            &token_id,
            None,
            Some("handover sale".to_string()),
        );
        Promise::new(listing.seller_id.clone())
            .transfer(price)
            .detach();
        events::sold(&token_id, &listing.seller_id, &buyer, listing.price);
    }
}
