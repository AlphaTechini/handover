//! Signing flow: request_transfer / retry_reserved / on_signed.
//!
//! State machine per token (decision D1):
//!
//! ```text
//!  idle --request_transfer--> in_flight + reserved(nonce N)
//!  in_flight --on_signed OK--> idle, sig_log[N] written, next_nonce = N+1, reserved = None
//!  in_flight --on_signed ERR-> reserved(nonce N) stays, in_flight = false
//!  reserved & !in_flight --retry_reserved--> in_flight (same exact transaction)
//! ```
//!
//! A failed MPC call never consumes a nonce and never frees the reservation, because the MPC
//! network may have published a signature on chain even though our callback saw a failure.

use crate::mpc::*;
use crate::tx::{self, TransferParams};
use crate::types::*;
use crate::{events, Handover, HandoverExt, PATH_PREFIX, SIGN_FEE};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, Promise, PromiseError};

impl ReservedTx {
    fn params(&self) -> TransferParams {
        TransferParams {
            to: self.to,
            value_wei: self.value_wei,
            gas_limit: self.gas_limit,
            max_fee_per_gas: self.max_fee_per_gas,
            max_priority_fee_per_gas: self.max_priority_fee_per_gas,
        }
    }
}

#[near]
impl Handover {
    /// Ask MPC to sign a plain ETH transfer from this token's address. Owner only.
    ///
    /// Deposit: at least `SIGN_FEE` (0.01 NEAR). Exactly 1 yocto is forwarded to MPC; the rest of
    /// `SIGN_FEE` stays here to pay for the log/reservation storage; anything above `SIGN_FEE` is
    /// refunded to the caller. Attach 300 Tgas. Returns the logged `SignedTxView` (via callback)
    /// or null if signing failed (then call `retry_reserved`).
    ///
    /// There is intentionally NO parameter for calldata, access list, or chain id.
    #[payable]
    pub fn request_transfer(
        &mut self,
        token_id: TokenId,
        to: String,
        value_wei: U128,
        gas_limit: U128,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
    ) -> Promise {
        let owner = self.require_owner(&token_id);
        let params = tx::validate_transfer(
            &to,
            value_wei.0,
            gas_limit.0,
            max_fee_per_gas.0,
            max_priority_fee_per_gas.0,
        )
        .unwrap_or_else(|e| env::panic_str(e));

        self.assert_can_sign(&token_id);
        require!(
            self.wallet(&token_id).reserved.is_none(),
            "A reserved transaction is pending: call retry_reserved"
        );
        self.charge_sign_fee(&owner);

        let chain_id = self.chain_id;
        let wallet = self.wallet_mut(&token_id);
        let nonce = wallet.next_nonce;
        let built = tx::build_plain_transfer(chain_id, nonce, &params);
        require!(
            tx::is_plain_transfer(&built),
            "Only plain transfers can be signed"
        );
        let payload_hash = tx::signing_hash(&built);
        wallet.in_flight = true;
        wallet.reserved = Some(ReservedTx {
            nonce,
            to: params.to,
            value_wei: params.value_wei,
            gas_limit: params.gas_limit,
            max_fee_per_gas: params.max_fee_per_gas,
            max_priority_fee_per_gas: params.max_priority_fee_per_gas,
            payload_hash,
            requested_at_ns: env::block_timestamp(),
            attempts: 1,
        });
        events::sign_requested(
            &token_id,
            &owner,
            nonce,
            &params.to,
            params.value_wei,
            &payload_hash,
            1,
        );
        self.sign_promise(&token_id, nonce, &payload_hash)
    }

    /// Re-request a signature for the exact transaction reserved by an earlier attempt whose
    /// MPC call failed or timed out. Owner only; same deposit rules as `request_transfer`.
    /// Any signature for the reserved payload authorises the identical transaction, so it does
    /// not matter which of several signatures gets broadcast: only one can ever be mined.
    #[payable]
    pub fn retry_reserved(&mut self, token_id: TokenId) -> Promise {
        let owner = self.require_owner(&token_id);
        self.assert_can_sign(&token_id);
        require!(
            self.wallet(&token_id).reserved.is_some(),
            "Nothing is reserved"
        );
        self.charge_sign_fee(&owner);

        let chain_id = self.chain_id;
        let wallet = self.wallet_mut(&token_id);
        let Some(reserved) = wallet.reserved.as_mut() else {
            env::panic_str("Nothing is reserved");
        };
        let built = tx::build_plain_transfer(chain_id, reserved.nonce, &reserved.params());
        require!(
            tx::signing_hash(&built) == reserved.payload_hash,
            "Reserved payload does not match its hash"
        );
        reserved.attempts = reserved.attempts.saturating_add(1);
        let (nonce, hash, attempt) = (reserved.nonce, reserved.payload_hash, reserved.attempts);
        let (to, value) = (reserved.to, reserved.value_wei);
        wallet.in_flight = true;
        events::sign_requested(&token_id, &owner, nonce, &to, value, &hash, attempt);
        self.sign_promise(&token_id, nonce, &hash)
    }

    /// MPC callback. NEVER panics once authorised: every parse/validation problem is treated as
    /// a failed attempt that leaves the reservation in place (decision D1).
    ///
    /// `#[private]` is enforced only in the compiled wasm wrapper, not in unit tests, so the
    /// explicit predecessor check below makes the same rule testable and survives refactors.
    #[private]
    pub fn on_signed(
        &mut self,
        token_id: TokenId,
        nonce: u64,
        #[callback_result] result: Result<SignatureResponse, PromiseError>,
    ) -> Option<SignedTxView> {
        if env::predecessor_account_id() != env::current_account_id() {
            env::panic_str("Method on_signed is private");
        }
        match self.finish_signing(&token_id, nonce, result) {
            Ok(view) => Some(view),
            Err(reason) => {
                self.mark_failed(&token_id, nonce, reason);
                None
            }
        }
    }
}

// ------------------------------------------------------------------------------ internals

impl Handover {
    pub(crate) fn wallet_mut(&mut self, token_id: &str) -> &mut WalletState {
        self.wallets
            .get_mut(token_id)
            .unwrap_or_else(|| env::panic_str("Wallet not found"))
    }

    /// Signing is refused while listed (listing freezes signing: risk 1) or while another MPC
    /// call is outstanding (one signature at a time keeps nonces sequential).
    fn assert_can_sign(&self, token_id: &str) {
        require!(!self.is_listed(token_id), "Token is listed: delist to sign");
        require!(
            !self.wallet(token_id).in_flight,
            "A signature request is in flight"
        );
        require!(
            env::prepaid_gas() >= MIN_PREPAID_GAS,
            "Attach at least 100 Tgas (300 recommended)"
        );
    }

    /// Require `SIGN_FEE`; refund anything above it to the caller right away.
    fn charge_sign_fee(&self, payer: &AccountId) {
        let deposit = env::attached_deposit();
        require!(
            deposit >= SIGN_FEE,
            "Attach at least 0.01 NEAR (storage + MPC fee)"
        );
        let excess = deposit.saturating_sub(SIGN_FEE);
        if excess > NearToken::from_yoctonear(0) {
            Promise::new(payer.clone()).transfer(excess).detach();
        }
    }

    fn sign_promise(&self, token_id: &str, nonce: u64, payload_hash: &[u8; 32]) -> Promise {
        let request = SignRequestArgs {
            path: format!("{PATH_PREFIX}{token_id}"),
            payload_v2: PayloadV2::Ecdsa(hex::encode(payload_hash)),
            domain_id: MPC_DOMAIN_ID,
        };
        ext_mpc::ext(self.mpc_contract_id.clone())
            .with_attached_deposit(MPC_DEPOSIT)
            .with_static_gas(SIGN_GAS)
            .with_unused_gas_weight(1)
            .sign(request)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .with_unused_gas_weight(0)
                    .on_signed(token_id.to_string(), nonce),
            )
    }

    /// Success path. Returns the reason string for any failure.
    fn finish_signing(
        &mut self,
        token_id: &str,
        nonce: u64,
        result: Result<SignatureResponse, PromiseError>,
    ) -> Result<SignedTxView, &'static str> {
        let chain_id = self.chain_id;
        let wallet = self.wallets.get(token_id).ok_or("unknown wallet")?;
        // Only the exact in-flight reservation can be completed (guards against stale callbacks).
        let reserved = wallet.reserved.clone().ok_or("nothing reserved")?;
        if !wallet.in_flight || reserved.nonce != nonce || wallet.next_nonce != nonce {
            return Err("stale callback");
        }
        let response = result.map_err(|_| "MPC call failed or timed out")?;
        let sig = tx::parse_response(&response)?;
        // Rebuild the transaction from the reservation; never from callback data.
        let built = tx::build_plain_transfer(chain_id, nonce, &reserved.params());
        let hash = tx::signing_hash(&built);
        if hash != reserved.payload_hash {
            return Err("reserved payload hash mismatch");
        }
        if !tx::signature_recovers(&hash, &sig) {
            return Err("signature does not verify");
        }
        let raw = tx::assemble(&built, &sig);
        let entry = SignedTx {
            nonce,
            to: reserved.to,
            value_wei: reserved.value_wei,
            gas_limit: reserved.gas_limit,
            max_fee_per_gas: reserved.max_fee_per_gas,
            max_priority_fee_per_gas: reserved.max_priority_fee_per_gas,
            tx_hash: env::keccak256_array(&raw),
            raw_signed_tx: raw,
            signed_at_ns: env::block_timestamp(),
        };
        let next = nonce.checked_add(1).ok_or("nonce overflow")?;
        let view = entry.view();
        // Commit: append to the log, then advance the nonce and release the reservation.
        self.sig_log
            .insert((token_id.to_string(), nonce), entry.clone());
        if let Some(w) = self.wallets.get_mut(token_id) {
            w.next_nonce = next;
            w.in_flight = false;
            w.reserved = None;
        }
        events::signed(token_id, nonce, &entry.to, entry.value_wei, &entry.tx_hash);
        Ok(view)
    }

    /// Failure path: clear `in_flight` only. The reservation and nonce are untouched.
    fn mark_failed(&mut self, token_id: &str, nonce: u64, reason: &str) {
        if let Some(w) = self.wallets.get_mut(token_id) {
            // Only release an attempt that this callback belongs to.
            let matches = w.reserved.as_ref().is_some_and(|r| r.nonce == nonce);
            if matches {
                w.in_flight = false;
            }
        }
        events::sign_failed(token_id, nonce, reason);
    }
}
