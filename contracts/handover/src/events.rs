//! NEP-297 events. Standard "handover", version "1.0.0".
//!
//! Format: `EVENT_JSON:{"standard":"handover","version":"1.0.0","event":"<name>","data":[{...}]}`
//! (the standard NEP-171 `nft_mint` / `nft_transfer` events are emitted by
//! near-contract-standards.)

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{env, serde_json, AccountId};

fn emit<T: Serialize>(event: &str, data: &T) {
    // Serialising these plain structs cannot fail; fall back to `null` instead of panicking,
    // because `emit` is also called from the never-panic callback.
    let data = serde_json::to_string(data).unwrap_or_else(|_| "null".to_string());
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"handover","version":"1.0.0","event":"{event}","data":[{data}]}}"#
    ));
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct SignRequested<'a> {
    token_id: &'a str,
    owner_id: &'a AccountId,
    nonce: u64,
    to: String,
    value_wei: U128,
    payload_hash: String,
    attempt: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Signed<'a> {
    token_id: &'a str,
    nonce: u64,
    to: String,
    value_wei: U128,
    tx_hash: String,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct SignFailed<'a> {
    token_id: &'a str,
    nonce: u64,
    reason: &'a str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Released<'a> {
    token_id: &'a str,
    owner_id: &'a AccountId,
    nonce: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Listed<'a> {
    token_id: &'a str,
    seller_id: &'a AccountId,
    price: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Delisted<'a> {
    token_id: &'a str,
    seller_id: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Sold<'a> {
    token_id: &'a str,
    seller_id: &'a AccountId,
    buyer_id: &'a AccountId,
    price: U128,
}

fn h(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

#[allow(clippy::too_many_arguments)]
pub fn sign_requested(
    token_id: &str,
    owner_id: &AccountId,
    nonce: u64,
    to: &[u8; 20],
    value_wei: u128,
    payload_hash: &[u8; 32],
    attempt: u32,
) {
    emit(
        "sign_requested",
        &SignRequested {
            token_id,
            owner_id,
            nonce,
            to: h(to),
            value_wei: U128(value_wei),
            payload_hash: h(payload_hash),
            attempt,
        },
    );
}

pub fn signed(token_id: &str, nonce: u64, to: &[u8; 20], value_wei: u128, tx_hash: &[u8; 32]) {
    emit(
        "signed",
        &Signed {
            token_id,
            nonce,
            to: h(to),
            value_wei: U128(value_wei),
            tx_hash: h(tx_hash),
        },
    );
}

pub fn sign_failed(token_id: &str, nonce: u64, reason: &str) {
    emit(
        "sign_failed",
        &SignFailed {
            token_id,
            nonce,
            reason,
        },
    );
}

pub fn listed(token_id: &str, seller_id: &AccountId, price: u128) {
    emit(
        "listed",
        &Listed {
            token_id,
            seller_id,
            price: U128(price),
        },
    );
}

pub fn delisted(token_id: &str, seller_id: &AccountId) {
    emit(
        "delisted",
        &Delisted {
            token_id,
            seller_id,
        },
    );
}

pub fn sold(token_id: &str, seller_id: &AccountId, buyer_id: &AccountId, price: u128) {
    emit(
        "sold",
        &Sold {
            token_id,
            seller_id,
            buyer_id,
            price: U128(price),
        },
    );
}

pub fn released(token_id: &str, owner_id: &AccountId, nonce: u64) {
    emit(
        "released",
        &Released {
            token_id,
            owner_id,
            nonce,
        },
    );
}
