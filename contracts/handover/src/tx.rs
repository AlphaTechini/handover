//! Ethereum transaction construction and signature assembly.
//!
//! Security property: there is exactly ONE kind of transaction this contract can build, a plain
//! EIP-1559 ETH transfer with empty `input` and empty access list. No public method accepts
//! calldata or a payload, so an ERC-20 `approve` (or any contract call) can never be signed.

use crate::mpc::{K256Signature, SignatureResponse};
use near_sdk::env;
use omni_transaction::evm::types::Signature as EvmSignature;
use omni_transaction::evm::EVMTransaction;
use omni_transaction::{TransactionBuilder, TxBuilder, EVM};

/// Ethereum Sepolia.
pub const SEPOLIA_CHAIN_ID: u64 = 11_155_111;
/// Gas of a plain ETH transfer. The only gas limit the contract signs: a higher limit would
/// let a seller pre-fund a contract recipient with receive() logic, and 21000 is exact for EOAs.
pub const TRANSFER_GAS_LIMIT: u128 = 21_000;
/// Lowest accepted `max_fee_per_gas` (1 gwei), so a signed tx cannot be made unmineable for
/// years by setting a dust fee (it would stay a valid pre-signed tx in the log).
pub const MIN_MAX_FEE_PER_GAS: u128 = 1_000_000_000;

#[derive(Clone, Debug, PartialEq)]
pub struct TransferParams {
    pub to: [u8; 20],
    pub value_wei: u128,
    pub gas_limit: u128,
    pub max_fee_per_gas: u128,
    pub max_priority_fee_per_gas: u128,
}

/// Strict address parse: `0x` + 40 hex chars, either case. Anything else is rejected
/// (no checksum enforcement, no bare hex, no ENS, no `0X`).
pub fn parse_address(s: &str) -> Option<[u8; 20]> {
    let body = s.strip_prefix("0x")?;
    if body.len() != 40 {
        return None;
    }
    let bytes = hex::decode(body).ok()?;
    bytes.try_into().ok()
}

/// Validate user-supplied transfer parameters. Returns a static reason on failure.
pub fn validate_transfer(
    to: &str,
    value_wei: u128,
    gas_limit: u128,
    max_fee_per_gas: u128,
    max_priority_fee_per_gas: u128,
) -> Result<TransferParams, &'static str> {
    let to = parse_address(to).ok_or("`to` must be 0x followed by 40 hex characters")?;
    if value_wei == 0 {
        return Err("value_wei must be greater than 0");
    }
    if to == [0u8; 20] {
        return Err("`to` must not be the zero address");
    }
    if gas_limit != TRANSFER_GAS_LIMIT {
        return Err("gas_limit must be exactly 21000");
    }
    if max_fee_per_gas < MIN_MAX_FEE_PER_GAS {
        return Err("max_fee_per_gas must be at least 1 gwei (10^9 wei)");
    }
    if max_priority_fee_per_gas == 0 {
        return Err("max_priority_fee_per_gas must be greater than 0");
    }
    if max_priority_fee_per_gas > max_fee_per_gas {
        return Err("max_priority_fee_per_gas must not exceed max_fee_per_gas");
    }
    Ok(TransferParams {
        to,
        value_wei,
        gas_limit,
        max_fee_per_gas,
        max_priority_fee_per_gas,
    })
}

/// Build the EIP-1559 plain-transfer transaction. Input and access list are always empty.
pub fn build_plain_transfer(chain_id: u64, nonce: u64, p: &TransferParams) -> EVMTransaction {
    let tx = TransactionBuilder::new::<EVM>()
        .chain_id(chain_id)
        .nonce(nonce)
        .to(p.to)
        .value(p.value_wei)
        .input(vec![])
        .gas_limit(p.gas_limit)
        .max_fee_per_gas(p.max_fee_per_gas)
        .max_priority_fee_per_gas(p.max_priority_fee_per_gas)
        .access_list(vec![])
        .build();
    debug_assert!(is_plain_transfer(&tx));
    tx
}

/// True only for a transaction that moves ETH and carries no calldata.
pub fn is_plain_transfer(tx: &EVMTransaction) -> bool {
    tx.input.is_empty() && tx.access_list.is_empty() && tx.to.is_some()
}

/// keccak256 of the EIP-2718 signing bytes (`0x02 || rlp([...])`): the digest MPC signs.
pub fn signing_hash(tx: &EVMTransaction) -> [u8; 32] {
    env::keccak256_array(tx.build_for_signing())
}

pub fn strip_leading_zeros(b: &[u8]) -> Vec<u8> {
    let i = b.iter().position(|x| *x != 0).unwrap_or(b.len());
    b[i..].to_vec()
}

fn parse_hex<const N: usize>(s: &str) -> Option<[u8; N]> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    hex::decode(s).ok()?.try_into().ok()
}

/// A signature in plain bytes, validated and ready to assemble / verify.
pub struct ParsedSig {
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub recovery_id: u8,
}

pub fn parse_response(resp: &SignatureResponse) -> Result<ParsedSig, &'static str> {
    let SignatureResponse::Secp256k1(K256Signature {
        big_r,
        s,
        recovery_id,
    }) = resp;
    let point: [u8; 33] = parse_hex(&big_r.affine_point).ok_or("malformed big_r")?;
    let s: [u8; 32] = parse_hex(&s.scalar).ok_or("malformed s")?;
    if point[0] != 2 && point[0] != 3 {
        return Err("big_r is not a compressed point");
    }
    if *recovery_id > 1 {
        return Err("unsupported recovery_id");
    }
    let mut r = [0u8; 32];
    r.copy_from_slice(&point[1..]);
    if r.iter().all(|b| *b == 0) || s.iter().all(|b| *b == 0) {
        return Err("zero r or s");
    }
    Ok(ParsedSig {
        r,
        s,
        recovery_id: *recovery_id,
    })
}

/// Assemble the signed type-2 transaction bytes.
///
/// `r` and `s` are RLP-encoded by omni-transaction exactly as given, so they MUST be minimal
/// big-endian integers: a leading 0x00 byte (about 1 signature in 128) would produce
/// non-canonical RLP that nodes reject. Hence the strip. `v` is the EIP-1559 yParity (0/1).
pub fn assemble(tx: &EVMTransaction, sig: &ParsedSig) -> Vec<u8> {
    let signature = EvmSignature {
        v: sig.recovery_id as u64,
        r: strip_leading_zeros(&sig.r),
        s: strip_leading_zeros(&sig.s),
    };
    tx.build_with_signature(&signature)
}

/// Recover the signer's Ethereum address from a valid, low-s, recoverable signature over
/// `hash`, or None if the signature is invalid. Same check the MPC contract performs in
/// `respond`; repeating it means we never log garbage, and the address feeds the
/// trust-on-first-use pin (F8).
pub fn recover_address(hash: &[u8; 32], sig: &ParsedSig) -> Option<[u8; 20]> {
    let mut rs = [0u8; 64];
    rs[..32].copy_from_slice(&sig.r);
    rs[32..].copy_from_slice(&sig.s);
    let pubkey = env::ecrecover(hash, &rs, sig.recovery_id, true)?;
    let digest = env::keccak256_array(pubkey);
    let mut out = [0u8; 20];
    out.copy_from_slice(&digest[12..]);
    Some(out)
}
