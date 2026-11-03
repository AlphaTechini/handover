//! Read-only views.

use crate::types::*;
use crate::{
    Handover, HandoverExt, DEFAULT_PAGE, MAX_PAGE, MINT_FEE, PATH_PREFIX, RELEASE_AFTER_BLOCKS,
    SIGN_FEE,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::near;

pub(crate) fn clamp_limit(limit: Option<u64>) -> u64 {
    limit.unwrap_or(DEFAULT_PAGE).min(MAX_PAGE)
}

#[near]
impl Handover {
    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            mpc_contract_id: self.mpc_contract_id.clone(),
            chain_id: self.chain_id,
            path_prefix: PATH_PREFIX.to_string(),
            sign_fee: U128(SIGN_FEE.as_yoctonear()),
            mint_fee: U128(MINT_FEE.as_yoctonear()),
            release_after_blocks: RELEASE_AFTER_BLOCKS,
        }
    }

    pub fn get_wallet(&self, token_id: TokenId) -> Option<WalletView> {
        let w = self.wallets.get(&token_id)?;
        let owner_id = self.owner_of(&token_id)?;
        Some(WalletView {
            path: format!("{PATH_PREFIX}{token_id}"),
            owner_id,
            next_nonce: w.next_nonce,
            in_flight: w.in_flight,
            transfer_call_pending: w.transfer_call_pending,
            eth_address: w.eth_address.map(|a| format!("0x{}", hex::encode(a))),
            listing: self.get_listing(token_id.clone()),
            reserved: w.reserved.as_ref().map(|r| r.view()),
            // Nonces are dense, so the number of logged signatures equals next_nonce.
            sig_count: w.next_nonce,
            minted_at_ns: U64(w.minted_at_ns),
            token_id,
        })
    }

    /// Signature log ordered by nonce ascending. `limit` defaults to 50, capped at 100.
    pub fn get_sig_log(
        &self,
        token_id: TokenId,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<SignedTxView> {
        let Some(w) = self.wallets.get(&token_id) else {
            return vec![];
        };
        let from = from_index.unwrap_or(0);
        let end = from.saturating_add(clamp_limit(limit)).min(w.next_nonce);
        (from..end)
            .filter_map(|n| self.sig_log.get(&(token_id.clone(), n)).map(|s| s.view()))
            .collect()
    }

    pub fn get_listing(&self, token_id: TokenId) -> Option<ListingView> {
        self.listings
            .get(&token_id)
            .map(|l| listing_view(&token_id, l))
    }

    pub fn list_listings(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<ListingView> {
        self.listings
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(clamp_limit(limit) as usize)
            .map(|(id, l)| listing_view(id, l))
            .collect()
    }
}

pub(crate) fn listing_view(token_id: &str, l: &Listing) -> ListingView {
    ListingView {
        token_id: token_id.to_string(),
        seller_id: l.seller_id.clone(),
        price: U128(l.price),
        listed_at_ns: U64(l.listed_at_ns),
    }
}
