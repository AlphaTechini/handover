//! Probe: build an EIP-1559 tx with omni-transaction, sign via MPC, assemble in callback.
use crate::{Contract, ContractExt};
use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, GasWeight, NearToken, Promise, PromiseError};
use omni_transaction::evm::types::Signature as EvmSignature;
use omni_transaction::evm::EVMTransaction;
use omni_transaction::{TransactionBuilder, TxBuilder, EVM};

pub const SEPOLIA_CHAIN_ID: u64 = 11155111;
pub const MPC_DEPOSIT: NearToken = NearToken::from_yoctonear(1);
pub const CALLBACK_GAS: Gas = Gas::from_tgas(30);
pub const SIGN_MIN_GAS: Gas = Gas::from_tgas(50);

// ---- MPC wire types (request) ----
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: Payload,
    pub domain_id: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum Payload {
    /// 32-byte hash as 64 hex chars, NO 0x prefix.
    Ecdsa(String),
}

// ---- MPC wire types (response) ----
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
    /// 33-byte compressed point, hex (02|03 prefix + x). x == r.
    pub affine_point: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct K256Scalar {
    /// 32-byte scalar, hex.
    pub scalar: String,
}

/// What `on_signed` returns. Check 2 reads this from the tx outcome (SuccessValue).
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SignResult {
    pub nonce: u64,
    /// keccak256 of the unsigned EIP-1559 payload that was sent to MPC, 0x-prefixed.
    pub payload_hash: String,
    /// The MPC response exactly as the contract received it.
    pub response: SignatureResponse,
    /// The signed raw transaction, 0x-prefixed. Only valid if assembly succeeded.
    pub raw_tx_hex: String,
    pub tx_hash: String,
}

/// Payload of the fixed vector used by check 4: chain 11155111, nonce 0,
/// to 0x000000000000000000000000000000000000dEaD, value 0.0001 ETH, gas 21000,
/// maxFee 30 gwei, priority 1 gwei. Produced by viem serializeTransaction.
pub const FIXED_VECTOR_PAYLOAD_HEX: &str = "02f183aa36a780843b9aca008506fc23ac0082520894000000000000000000000000000000000000dead865af3107a400080c0";
pub const FIXED_VECTOR_PAYLOAD_HASH: &str = "ef043b276591d41c502c17ac847be83b7200b34dbe4c5b21d3b815cb08974699";

#[ext_contract(ext_mpc)]
#[allow(dead_code)]
pub trait MpcSigner {
    fn sign(&mut self, request: SignRequest);
}

pub fn build_tx(nonce: u64, to: [u8; 20], value: u128, gas_limit: u128, max_fee: u128, max_prio: u128) -> EVMTransaction {
    TransactionBuilder::new::<EVM>()
        .chain_id(SEPOLIA_CHAIN_ID)
        .nonce(nonce)
        .to(to)
        .value(value)
        .input(vec![])
        .gas_limit(gas_limit)
        .max_fee_per_gas(max_fee)
        .max_priority_fee_per_gas(max_prio)
        .access_list(vec![])
        .build()
}

fn strip_leading_zeros(b: &[u8]) -> Vec<u8> {
    let i = b.iter().position(|x| *x != 0).unwrap_or(b.len());
    b[i..].to_vec()
}

pub fn parse_hex<const N: usize>(s: &str) -> Option<[u8; N]> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let v = hex::decode(s).ok()?;
    v.try_into().ok()
}

/// Assemble the signed EIP-1559 bytes. r and s must be minimal big-endian (no leading zeros).
pub fn assemble(tx: &EVMTransaction, sig: &K256Signature) -> Option<Vec<u8>> {
    let big_r: [u8; 33] = parse_hex(&sig.big_r.affine_point)?;
    let s: [u8; 32] = parse_hex(&sig.s.scalar)?;
    if !(big_r[0] == 2 || big_r[0] == 3) || sig.recovery_id > 1 {
        return None;
    }
    let signature = EvmSignature {
        v: sig.recovery_id as u64, // EIP-1559 yParity
        r: strip_leading_zeros(&big_r[1..]),
        s: strip_leading_zeros(&s),
    };
    Some(tx.build_with_signature(&signature))
}

#[near]
impl Contract {
    #[payable]
    pub fn request_transfer(&mut self, token_id: String, to: String, value_wei: U128) -> Promise {
        require!(env::attached_deposit() >= MPC_DEPOSIT, "attach >= 1 yocto");
        require!(!self.in_flight, "in flight");
        let to: [u8; 20] = parse_hex(&to).unwrap_or_else(|| env::panic_str("bad to"));
        let tx = build_tx(self.next_nonce, to, value_wei.0, 21_000, 30_000_000_000, 1_000_000_000);
        let payload = env::keccak256_array(&tx.build_for_signing());
        self.in_flight = true;
        let request = SignRequest {
            path: format!("handover-{token_id}"),
            payload_v2: Payload::Ecdsa(hex::encode(payload)),
            domain_id: 0,
        };
        ext_mpc::ext(self.mpc_contract_id.clone())
            .with_attached_deposit(MPC_DEPOSIT)
            .with_static_gas(SIGN_MIN_GAS)
            .with_unused_gas_weight(1)
            .sign(request)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .with_unused_gas_weight(0)
                    .on_signed(self.next_nonce, hex::encode(to), value_wei),
            )
    }

    #[private]
    pub fn on_signed(
        &mut self,
        nonce: u64,
        to: String,
        value_wei: U128,
        #[callback_result] result: Result<SignatureResponse, PromiseError>,
    ) -> Option<SignResult> {
        self.in_flight = false;
        let response = match result {
            Ok(r) => r,
            Err(_) => return None,
        };
        let SignatureResponse::Secp256k1(sig) = response.clone();
        let to: [u8; 20] = parse_hex(&to)?;
        let tx = build_tx(nonce, to, value_wei.0, 21_000, 30_000_000_000, 1_000_000_000);
        let payload_hash = hex::encode(env::keccak256_array(&tx.build_for_signing()));
        // Probe only: on assembly failure the nonce is not consumed. The real contract must reserve the tx (SPEC D1).
        let raw = assemble(&tx, &sig)?;
        let raw_hex = format!("0x{}", hex::encode(&raw));
        let tx_hash = format!("0x{}", hex::encode(env::keccak256_array(&raw)));
        self.next_nonce += 1;
        self.last_signed = Some(raw_hex.clone());
        env::log_str(&tx_hash);
        Some(SignResult { nonce, payload_hash: format!("0x{payload_hash}"), response, raw_tx_hex: raw_hex, tx_hash })
    }

    pub fn unsigned_payload(&self, nonce: u64, to: String, value_wei: U128) -> String {
        let to: [u8; 20] = parse_hex(&to).unwrap();
        let tx = build_tx(nonce, to, value_wei.0, 21_000, 30_000_000_000, 1_000_000_000);
        format!("0x{}", hex::encode(tx.build_for_signing()))
    }

    pub fn mpc_account(&self) -> AccountId { self.mpc_contract_id.clone() }
    pub fn gas_weight_probe(&self) -> u64 { GasWeight(1).0 }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_created_receipts, VMContextBuilder};
    use near_sdk::mock::MockAction;
    use near_sdk::{testing_env, PromiseResult};

    fn ctx(pred: AccountId, deposit: NearToken) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id("handover.testnet".parse().unwrap())
            .predecessor_account_id(pred)
            .attached_deposit(deposit)
            .prepaid_gas(Gas::from_tgas(300));
        b
    }

    #[test]
    fn creates_sign_promise_with_exact_args() {
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(1)).build());
        let mut c = Contract::new_default_meta(accounts(0));
        let to = "0x000000000000000000000000000000000000dead".to_string();
        c.request_transfer("0".into(), to.clone(), U128(100)).detach();

        let receipts = get_created_receipts();
        assert_eq!(receipts.len(), 2, "{receipts:?}");
        assert_eq!(receipts[0].receiver_id.as_str(), "v1.signer-prod.testnet");
        let MockAction::FunctionCallWeight { method_name, args, attached_deposit, prepaid_gas, gas_weight, .. } = &receipts[0].actions[0] else { panic!() };
        assert_eq!(method_name, b"sign");
        assert_eq!(*attached_deposit, NearToken::from_yoctonear(1));
        assert_eq!(*prepaid_gas, SIGN_MIN_GAS);
        assert_eq!(gas_weight.0, 1);
        let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(args).unwrap();
        let hash = env::keccak256_array(&build_tx(0, parse_hex(&to).unwrap(), 100, 21_000, 30_000_000_000, 1_000_000_000).build_for_signing());
        assert_eq!(v, near_sdk::serde_json::json!({"request": {"path": "handover-0", "payload_v2": {"Ecdsa": hex::encode(hash)}, "domain_id": 0}}));
        // callback receipt
        assert_eq!(receipts[1].receiver_id.as_str(), "handover.testnet");
        let MockAction::FunctionCallWeight { method_name, .. } = &receipts[1].actions[0] else { panic!() };
        assert_eq!(method_name, b"on_signed");
        println!("SIGN ARGS = {}", String::from_utf8_lossy(args));
    }

    #[test]
    fn callback_success_and_failure() {
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(1)).build());
        let mut c = Contract::new_default_meta(accounts(0));
        c.in_flight = true;
        // failure: nonce not consumed
        let ctx_cb = ctx("handover.testnet".parse().unwrap(), NearToken::from_yoctonear(0)).build();
        testing_env!(ctx_cb.clone(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
        assert!(c.on_signed(0, "000000000000000000000000000000000000dead".into(), U128(100), Err(PromiseError::Failed)).is_none());
        assert_eq!(c.next_nonce, 0);
        // success, via raw JSON as the MPC would return it
        let resp = r#"{"scheme":"Secp256k1","big_r":{"affine_point":"02c0d51d5f0d0b6d1a0e5b6a4c9b4a2f9f3e2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c"},"s":{"scalar":"00aa000000000000000000000000000000000000000000000000000000000001"},"recovery_id":1}"#;
        let parsed: SignatureResponse = near_sdk::serde_json::from_str(resp).unwrap();
        testing_env!(ctx_cb, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(resp.as_bytes().to_vec())]);
        let raw = c.on_signed(0, "000000000000000000000000000000000000dead".into(), U128(100), Ok(parsed)).unwrap();
        assert_eq!(c.next_nonce, 1);
        println!("RAW = {}", raw.raw_tx_hex);
    }

    #[test]
    fn fixed_vector_payload_matches_viem() {
        // Same tx as check 4 (viem serializeTransaction). If this fails, omni-transaction and viem disagree.
        let to = parse_hex::<20>("0x000000000000000000000000000000000000dEaD").unwrap();
        let tx = build_tx(0, to, 100_000_000_000_000, 21_000, 30_000_000_000, 1_000_000_000);
        let payload = tx.build_for_signing();
        assert_eq!(hex::encode(&payload), FIXED_VECTOR_PAYLOAD_HEX);
        assert_eq!(hex::encode(env::keccak256_array(&payload)), FIXED_VECTOR_PAYLOAD_HASH);
    }
}
