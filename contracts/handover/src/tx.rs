//! Ethereum transaction construction and signature assembly.
//!
//! Security property: the contract builds only two kinds of EIP-1559 transaction, both with an
//! empty access list: a plain ETH transfer (empty `input`), and a value-free token transfer whose
//! calldata the contract encodes itself (ERC-20 `transfer`, ERC-721 / ERC-1155
//! `safeTransferFrom` from the wallet). No public method accepts calldata or a payload, so an
//! `approve`, `setApprovalForAll`, `permit` or any other contract call can never be signed.

use crate::mpc::{K256Signature, SignatureResponse};
use near_sdk::env;
use omni_transaction::evm::types::Signature as EvmSignature;
use omni_transaction::evm::EVMTransaction;
use omni_transaction::{TransactionBuilder, TxBuilder, EVM};

/// Ethereum Sepolia.
pub const SEPOLIA_CHAIN_ID: u64 = 11_155_111;
/// Gas of a plain ETH transfer to an existing account. Anything lower can never be mined, which
/// would leave the nonce stuck behind a logged signature forever.
pub const MIN_TRANSFER_GAS_LIMIT: u128 = 21_000;
/// Upper bound for recipients that cost more than that. Since Glamsterdam (EIP-2780/EIP-8037,
/// live on Sepolia since 2026-10-06) value sent to an empty account pays 183,600 state gas for
/// creating it (~207k in total), and EIP-7702 smart accounts run code on receive (~24k).
/// A revert still consumes the nonce, so recipient code cannot hide a signature from the clean
/// check; the cap only bounds the fee a signed transfer can carry.
pub const MAX_TRANSFER_GAS_LIMIT: u128 = 300_000;
/// Lowest accepted `max_fee_per_gas` (1 gwei), so a signed tx cannot be made unmineable for
/// years by setting a dust fee (it would stay a valid pre-signed tx in the log).
pub const MIN_MAX_FEE_PER_GAS: u128 = 1_000_000_000;

/// Token transfers run token code (and, for ERC-721/1155, the receiver hook), so they get a
/// higher cap than plain ETH transfers. Still bounded, for the same fee reason.
pub const MAX_TOKEN_GAS_LIMIT: u128 = 500_000;

/// Selectors of the only token calls the contract ever builds. None of them can grant a right
/// to anyone: no `approve`, `setApprovalForAll`, `permit` or arbitrary call is reachable.
pub const ERC20_TRANSFER: [u8; 4] = [0xa9, 0x05, 0x9c, 0xbb]; // transfer(address,uint256)
pub const ERC721_SAFE_TRANSFER_FROM: [u8; 4] = [0x42, 0x84, 0x2e, 0x0e]; // safeTransferFrom(address,address,uint256)
pub const ERC1155_SAFE_TRANSFER_FROM: [u8; 4] = [0xf2, 0x42, 0x43, 0x2a]; // safeTransferFrom(address,address,uint256,uint256,bytes)

#[derive(Clone, Debug, PartialEq)]
pub struct TransferParams {
    pub to: [u8; 20],
    pub value_wei: u128,
    pub gas_limit: u128,
    pub max_fee_per_gas: u128,
    pub max_priority_fee_per_gas: u128,
    /// Empty for ETH transfers; otherwise calldata the contract encoded itself (see above).
    pub data: Vec<u8>,
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
    if !(MIN_TRANSFER_GAS_LIMIT..=MAX_TRANSFER_GAS_LIMIT).contains(&gas_limit) {
        return Err("gas_limit must be between 21000 and 300000");
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
        data: vec![],
    })
}

/// Parses a non-negative decimal integer that fits in 256 bits into big-endian bytes.
pub fn parse_u256(s: &str) -> Option<[u8; 32]> {
    if s.is_empty() || s.len() > 78 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut out = [0u8; 32];
    for d in s.bytes() {
        // out = out * 10 + d
        let mut carry = u32::from(d - b'0');
        for byte in out.iter_mut().rev() {
            let v = u32::from(*byte) * 10 + carry;
            *byte = (v & 0xff) as u8;
            carry = v >> 8;
        }
        if carry != 0 {
            return None;
        }
    }
    Some(out)
}

fn word_address(a: &[u8; 20]) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(a);
    w
}

fn word_u64(n: u64) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..].copy_from_slice(&n.to_be_bytes());
    w
}

/// Which token standard a `request_token_transfer` moves.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TokenStandard {
    Erc20,
    Erc721,
    Erc1155,
}

impl TokenStandard {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "erc20" => Some(Self::Erc20),
            "erc721" => Some(Self::Erc721),
            "erc1155" => Some(Self::Erc1155),
            _ => None,
        }
    }
}

/// Validates a token transfer and encodes its calldata. `from` must be the wallet's own address
/// (the caller passes the pinned address); the transaction carries no ETH.
#[allow(clippy::too_many_arguments)]
pub fn validate_token_transfer(
    standard: TokenStandard,
    token: &str,
    from: [u8; 20],
    to: &str,
    id: &str,
    amount: &str,
    gas_limit: u128,
    max_fee_per_gas: u128,
    max_priority_fee_per_gas: u128,
) -> Result<TransferParams, &'static str> {
    let token = parse_address(token).ok_or("`token` must be 0x followed by 40 hex characters")?;
    let to = parse_address(to).ok_or("`to` must be 0x followed by 40 hex characters")?;
    if token == [0u8; 20] || to == [0u8; 20] {
        return Err("`token` and `to` must not be the zero address");
    }
    if !(MIN_TRANSFER_GAS_LIMIT..=MAX_TOKEN_GAS_LIMIT).contains(&gas_limit) {
        return Err("gas_limit must be between 21000 and 500000 for token transfers");
    }
    // Fee rules are the same as for ETH transfers.
    validate_transfer(
        "0x0000000000000000000000000000000000000001",
        1,
        MIN_TRANSFER_GAS_LIMIT,
        max_fee_per_gas,
        max_priority_fee_per_gas,
    )?;
    let amount_word = || parse_u256(amount).filter(|w| w.iter().any(|b| *b != 0));
    let id_word = || parse_u256(id);
    let mut data = Vec::with_capacity(196);
    match standard {
        TokenStandard::Erc20 => {
            let amount = amount_word().ok_or("amount must be a whole number above 0")?;
            data.extend_from_slice(&ERC20_TRANSFER);
            data.extend_from_slice(&word_address(&to));
            data.extend_from_slice(&amount);
        }
        TokenStandard::Erc721 => {
            let id = id_word().ok_or("id must be a whole number")?;
            data.extend_from_slice(&ERC721_SAFE_TRANSFER_FROM);
            data.extend_from_slice(&word_address(&from));
            data.extend_from_slice(&word_address(&to));
            data.extend_from_slice(&id);
        }
        TokenStandard::Erc1155 => {
            let id = id_word().ok_or("id must be a whole number")?;
            let amount = amount_word().ok_or("amount must be a whole number above 0")?;
            data.extend_from_slice(&ERC1155_SAFE_TRANSFER_FROM);
            data.extend_from_slice(&word_address(&from));
            data.extend_from_slice(&word_address(&to));
            data.extend_from_slice(&id);
            data.extend_from_slice(&amount);
            data.extend_from_slice(&word_u64(0xa0)); // offset of the empty `bytes data`
            data.extend_from_slice(&word_u64(0)); // its length
        }
    }
    Ok(TransferParams {
        to: token,
        value_wei: 0,
        gas_limit,
        max_fee_per_gas,
        max_priority_fee_per_gas,
        data,
    })
}

/// Build the EIP-1559 transaction. The access list is always empty; `input` is empty for ETH
/// transfers and otherwise one of the contract-encoded token calls.
pub fn build_transfer(chain_id: u64, nonce: u64, p: &TransferParams) -> EVMTransaction {
    let tx = TransactionBuilder::new::<EVM>()
        .chain_id(chain_id)
        .nonce(nonce)
        .to(p.to)
        .value(p.value_wei)
        .input(p.data.clone())
        .gas_limit(p.gas_limit)
        .max_fee_per_gas(p.max_fee_per_gas)
        .max_priority_fee_per_gas(p.max_priority_fee_per_gas)
        .access_list(vec![])
        .build();
    debug_assert!(is_allowed_transfer(&tx));
    tx
}

/// Build a plain ETH transfer (empty input).
#[cfg(test)]
pub fn build_plain_transfer(chain_id: u64, nonce: u64, p: &TransferParams) -> EVMTransaction {
    debug_assert!(p.data.is_empty());
    build_transfer(chain_id, nonce, p)
}

/// True only for a transaction that moves ETH and carries no calldata.
pub fn is_plain_transfer(tx: &EVMTransaction) -> bool {
    tx.input.is_empty() && tx.access_list.is_empty() && tx.to.is_some()
}

/// True for a plain ETH transfer or a value-free token transfer whose calldata is exactly one of
/// the three allowed encodings (right selector, right length).
pub fn is_allowed_transfer(tx: &EVMTransaction) -> bool {
    if is_plain_transfer(tx) {
        return true;
    }
    if !tx.access_list.is_empty() || tx.to.is_none() || tx.value != 0 || tx.input.len() < 4 {
        return false;
    }
    let (sel, len) = (&tx.input[..4], tx.input.len());
    (sel == ERC20_TRANSFER && len == 4 + 64)
        || (sel == ERC721_SAFE_TRANSFER_FROM && len == 4 + 96)
        || (sel == ERC1155_SAFE_TRANSFER_FROM && len == 4 + 192)
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
