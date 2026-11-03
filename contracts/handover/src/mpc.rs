//! Wire types and constants for the NEAR MPC signer contract (`v1.signer-prod.testnet`).
//!
//! Shapes verified against near/mpc sources (see RESEARCH notes): request uses `payload_v2`
//! + `domain_id` (domain 0 = secp256k1); the response is `{"scheme":"Secp256k1", big_r, s,
//! recovery_id}` with lowercase hex and no `0x`.

use near_sdk::{ext_contract, near, Gas, NearToken};

/// MPC domain 0 is the secp256k1 (Ethereum) domain.
pub const MPC_DOMAIN_ID: u64 = 0;

/// Exactly 1 yoctoNEAR is forwarded to `sign` (its minimum). The MPC contract refunds any
/// excess to its predecessor, which would be this contract and not the user.
pub const MPC_DEPOSIT: NearToken = NearToken::from_yoctonear(1);

/// Static gas for the `sign` call. MPC requires >= 15 Tgas prepaid; 50 Tgas leaves ample room
/// and (with unused-gas weight 1) it also receives whatever gas the caller attached beyond
/// what the callback needs, because the yield-resume callbacks inside MPC need gas too.
pub const SIGN_GAS: Gas = Gas::from_tgas(50);

/// Static gas for `on_signed`. The callback does JSON parsing, one ecrecover, two keccaks, an
/// RLP encode and three storage writes: single-digit Tgas in practice. 30 Tgas leaves a ~3x
/// margin. This matters: if the callback ran out of gas, `in_flight` would stay set and the
/// token would be stuck. Weight 0 so it never takes extra from the unused pool.
pub const CALLBACK_GAS: Gas = Gas::from_tgas(30);

/// Fail fast when the caller attached too little gas for sign + callback + our own work.
/// (UI attaches 300 Tgas.) Failing here reverts everything, so no state is left half-done.
pub const MIN_PREPAID_GAS: Gas = Gas::from_tgas(100);

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SignRequestArgs {
    pub path: String,
    pub payload_v2: PayloadV2,
    pub domain_id: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum PayloadV2 {
    /// 32-byte hash as 64 lowercase hex chars, no `0x` prefix. Serialises as `{"Ecdsa":"..."}`.
    Ecdsa(String),
}

#[near(serializers = [json])]
#[serde(tag = "scheme")]
#[derive(Clone, Debug)]
pub enum SignatureResponse {
    Secp256k1(K256Signature),
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct K256Signature {
    pub big_r: K256AffinePoint,
    pub s: K256Scalar,
    pub recovery_id: u8,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct K256AffinePoint {
    /// 33-byte compressed point as hex: `02|03` prefix + 32-byte x. x is the signature `r`.
    pub affine_point: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct K256Scalar {
    /// 32-byte scalar as hex.
    pub scalar: String,
}

#[allow(dead_code)]
#[ext_contract(ext_mpc)]
pub trait MpcSigner {
    fn sign(&mut self, request: SignRequestArgs);
}
