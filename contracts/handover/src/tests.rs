//! Unit tests. Every guard from the spec has at least one test here.
//!
//! The key below is a THROWAWAY TEST KEY (secp256k1 scalar 1, publicly known, address
//! 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf). It stands in for the MPC network's derived key.
//! It never appears outside `#[cfg(test)]`.

use super::*;
use crate::tx::{self, ParsedSig, TransferParams};
use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::test_utils::{accounts, get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, Gas, PromiseError};

const MPC: &str = "v1.signer-prod.testnet";
const SELF_ID: &str = "handover.testnet";
const TEST_KEY_ADDRESS: &str = "7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const DEAD: &str = "0x000000000000000000000000000000000000dead";
const ONE_NEAR: NearToken = NearToken::from_near(1);
const Y1: NearToken = NearToken::from_yoctonear(1);
const GWEI: u128 = 1_000_000_000;

fn alice() -> AccountId {
    accounts(0)
}
fn bob() -> AccountId {
    accounts(1)
}
fn carol() -> AccountId {
    accounts(2)
}

fn ctx(pred: &AccountId, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(SELF_ID.parse().unwrap())
        .predecessor_account_id(pred.clone())
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(1_700_000_000_000_000_000);
    b
}

fn set(pred: &AccountId, deposit: NearToken) {
    testing_env!(ctx(pred, deposit).build());
}

fn new_contract() -> Handover {
    set(&SELF_ID.parse().unwrap(), NearToken::from_yoctonear(0));
    Handover::new(MPC.parse().unwrap(), SEPOLIA_CHAIN_ID)
}

fn mint(c: &mut Handover, who: &AccountId) -> String {
    set(who, ONE_NEAR);
    c.nft_mint().token_id
}

fn request(c: &mut Handover, who: &AccountId, token: &str) {
    request_with(c, who, token, DEAD, 100, 21_000, 30 * GWEI, GWEI, SIGN_FEE);
}

#[allow(clippy::too_many_arguments)]
fn request_with(
    c: &mut Handover,
    who: &AccountId,
    token: &str,
    to: &str,
    value: u128,
    gas: u128,
    max_fee: u128,
    prio: u128,
    deposit: NearToken,
) {
    set(who, deposit);
    c.request_transfer(
        token.to_string(),
        to.to_string(),
        U128(value),
        U128(gas),
        U128(max_fee),
        U128(prio),
    )
    .detach();
}

fn as_self() {
    testing_env!(ctx(&SELF_ID.parse().unwrap(), NearToken::from_yoctonear(0)).build());
}

fn wallet(c: &Handover, token: &str) -> WalletState {
    c.wallets.get(token).unwrap().clone()
}

fn reserved_hash(c: &Handover, token: &str) -> [u8; 32] {
    wallet(c, token).reserved.unwrap().payload_hash
}

// ---------------------------------------------------------------- throwaway-key signing

fn test_key() -> SigningKey {
    let mut scalar = [0u8; 32];
    scalar[31] = 1;
    SigningKey::from_bytes(&scalar.into()).unwrap()
}

/// Sign `hash` like the MPC network would and return the response JSON shape.
fn mpc_response(hash: &[u8; 32]) -> (SignatureResponse, [u8; 32], [u8; 32]) {
    let (sig, recid) = test_key().sign_prehash_recoverable(hash).unwrap();
    assert!(sig.normalize_s().is_none(), "k256 must return low-s");
    assert!(!recid.is_x_reduced());
    let bytes = sig.to_bytes();
    let (r, s) = (
        <[u8; 32]>::try_from(&bytes[..32]).unwrap(),
        <[u8; 32]>::try_from(&bytes[32..]).unwrap(),
    );
    let mut point = vec![2 + recid.is_y_odd() as u8];
    point.extend_from_slice(&r);
    let json = json!({
        "scheme": "Secp256k1",
        "big_r": {"affine_point": hex::encode(point)},
        "s": {"scalar": hex::encode(s)},
        "recovery_id": recid.is_y_odd() as u8,
    });
    (serde_json::from_value(json).unwrap(), r, s)
}

/// Run the callback with a valid MPC-shaped response for the currently reserved payload.
fn complete_ok(c: &mut Handover, token: &str) -> SignedTxView {
    let w = wallet(c, token);
    let nonce = w.reserved.as_ref().unwrap().nonce;
    let (resp, _, _) = mpc_response(&reserved_hash(c, token));
    as_self();
    c.on_signed(token.to_string(), nonce, Ok(resp))
        .expect("signed")
}

fn complete_err(c: &mut Handover, token: &str) -> Option<SignedTxView> {
    let nonce = wallet(c, token).reserved.as_ref().unwrap().nonce;
    as_self();
    c.on_signed(token.to_string(), nonce, Err(PromiseError::Failed))
}

fn raw_bytes(v: &SignedTxView) -> Vec<u8> {
    hex::decode(v.raw_signed_tx_hex.strip_prefix("0x").unwrap()).unwrap()
}

/// Decode a signed type-2 tx and return (fields, recovered signer address hex).
fn decode_signed(raw: &[u8]) -> (Vec<Vec<u8>>, String) {
    assert_eq!(raw[0], 2, "EIP-1559 type byte");
    let list = rlp::Rlp::new(&raw[1..]);
    assert!(list.is_list());
    let n = list.item_count().unwrap();
    assert_eq!(n, 12);
    let items: Vec<Vec<u8>> = (0..n)
        .map(|i| {
            let it = list.at(i).unwrap();
            if it.is_list() {
                it.as_raw().to_vec()
            } else {
                it.data().unwrap().to_vec()
            }
        })
        .collect();
    // Re-encode the first 9 items to get the signing hash.
    let mut s = rlp::RlpStream::new_list(9);
    for i in 0..9 {
        s.append_raw(list.at(i).unwrap().as_raw(), 1);
    }
    let mut signing = vec![2u8];
    signing.extend_from_slice(&s.out());
    let hash = env::keccak256_array(&signing);
    let (r, sv) = (&items[10], &items[11]);
    let mut rs = [0u8; 64];
    rs[32 - r.len()..32].copy_from_slice(r);
    rs[64 - sv.len()..].copy_from_slice(sv);
    let sig = Signature::from_slice(&rs).unwrap();
    let recid = RecoveryId::from_byte(items[9].first().copied().unwrap_or(0)).unwrap();
    let vk = VerifyingKey::recover_from_prehash(&hash, &sig, recid).unwrap();
    let pubkey = vk.to_encoded_point(false);
    let addr = env::keccak256(&pubkey.as_bytes()[1..]);
    (items, hex::encode(&addr[12..]))
}

// ------------------------------------------------------------------------------- init/mint

#[test]
fn init_sets_config_and_metadata() {
    let c = new_contract();
    let cfg = c.get_config();
    assert_eq!(cfg.mpc_contract_id.as_str(), MPC);
    assert_eq!(cfg.chain_id, 11_155_111);
    assert_eq!(cfg.path_prefix, "handover-");
    assert_eq!(cfg.sign_fee.0, 10u128.pow(22));
    assert_eq!(cfg.mint_fee.0, 5 * 10u128.pow(22));
    let m = c.nft_metadata();
    assert_eq!(
        (m.name.as_str(), m.symbol.as_str(), m.spec.as_str()),
        ("Handover", "HANDOVER", "nft-1.0.0")
    );
}

#[test]
fn mint_assigns_sequential_ids_and_wallet_state() {
    let mut c = new_contract();
    assert_eq!(mint(&mut c, &alice()), "0");
    assert_eq!(mint(&mut c, &bob()), "1");
    assert_eq!(mint(&mut c, &alice()), "2");
    let w = c.get_wallet("1".into()).unwrap();
    assert_eq!(w.owner_id, bob());
    assert_eq!(w.path, "handover-1");
    assert_eq!((w.next_nonce, w.sig_count, w.in_flight), (0, 0, false));
    assert!(w.listing.is_none() && w.reserved.is_none());
    assert_eq!(c.nft_total_supply().0, 3);
    assert_eq!(c.nft_supply_for_owner(alice()).0, 2);
    assert!(c.get_wallet("9".into()).is_none());
}

#[test]
#[should_panic(expected = "Attach at least 0.05 NEAR")]
fn mint_requires_mint_fee() {
    let mut c = new_contract();
    set(&alice(), NearToken::from_millinear(49));
    c.nft_mint();
}

#[test]
fn mint_refunds_excess_beyond_measured_storage() {
    let mut c = new_contract();
    set(&alice(), ONE_NEAR);
    c.nft_mint();
    let receipts = get_created_receipts();
    let refund = receipts
        .iter()
        .find_map(|r| match (&r.receiver_id, &r.actions[0]) {
            (id, MockAction::Transfer { deposit, .. }) if *id == alice() => Some(*deposit),
            _ => None,
        })
        .expect("refund receipt");
    let kept = ONE_NEAR.as_yoctonear() - refund.as_yoctonear();
    assert!(kept > 0, "some storage must be charged");
    assert!(
        kept < MINT_FEE.as_yoctonear(),
        "storage cost is below the 0.05 NEAR cap: {kept}"
    );
    assert!(get_logs()
        .iter()
        .any(|l| l.contains(r#""event":"nft_mint""#)));
}

// ------------------------------------------------------------ request_transfer: MPC call

#[test]
fn request_transfer_calls_mpc_with_exact_args_and_one_yocto() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    // Attach more than SIGN_FEE to also exercise the refund.
    request_with(
        &mut c,
        &alice(),
        "0",
        DEAD,
        100,
        21_000,
        30 * GWEI,
        GWEI,
        NearToken::from_millinear(250),
    );
    let receipts = get_created_receipts();

    let sign = receipts
        .iter()
        .find(|r| r.receiver_id.as_str() == MPC)
        .expect("sign receipt");
    let MockAction::FunctionCallWeight {
        method_name,
        args,
        attached_deposit,
        prepaid_gas,
        gas_weight,
        ..
    } = &sign.actions[0]
    else {
        panic!("not a function call")
    };
    assert_eq!(method_name, b"sign");
    assert_eq!(*attached_deposit, Y1, "exactly 1 yocto to MPC");
    assert_eq!(*prepaid_gas, SIGN_GAS);
    assert_eq!(gas_weight.0, 1);
    let expected_tx = tx::build_plain_transfer(
        SEPOLIA_CHAIN_ID,
        0,
        &tx::validate_transfer(DEAD, 100, 21_000, 30 * GWEI, GWEI).unwrap(),
    );
    let hash = hex::encode(env::keccak256_array(expected_tx.build_for_signing()));
    let v: Value = serde_json::from_slice(args).unwrap();
    assert_eq!(
        v,
        json!({"request": {"path": "handover-0", "payload_v2": {"Ecdsa": hash}, "domain_id": 0}})
    );
    assert_eq!(hash.len(), 64);
    // Raw JSON has no 0x prefix on the hash.
    assert!(!String::from_utf8_lossy(args).contains("0x"));

    // callback receipt: on_signed on self with static gas, weight 0
    let cb = receipts
        .iter()
        .find(|r| r.receiver_id.as_str() == SELF_ID)
        .expect("callback");
    let MockAction::FunctionCallWeight {
        method_name,
        args,
        prepaid_gas,
        gas_weight,
        ..
    } = &cb.actions[0]
    else {
        panic!()
    };
    assert_eq!(method_name, b"on_signed");
    assert_eq!(*prepaid_gas, CALLBACK_GAS);
    assert_eq!(gas_weight.0, 0);
    assert_eq!(
        serde_json::from_slice::<Value>(args).unwrap(),
        json!({"token_id": "0", "nonce": 0})
    );

    // refund of everything above SIGN_FEE goes to the caller
    let refund = receipts
        .iter()
        .find_map(|r| match (&r.receiver_id, &r.actions[0]) {
            (id, MockAction::Transfer { deposit, .. }) if *id == alice() => Some(*deposit),
            _ => None,
        })
        .expect("refund");
    assert_eq!(
        refund.as_yoctonear(),
        NearToken::from_millinear(240).as_yoctonear()
    );

    // state
    let w = wallet(&c, "0");
    assert!(w.in_flight);
    assert_eq!(
        w.next_nonce, 0,
        "nonce is not consumed until a signature is logged"
    );
    let r = w.reserved.unwrap();
    assert_eq!((r.nonce, r.attempts, r.value_wei), (0, 1, 100));
    let log = get_logs()
        .into_iter()
        .find(|l| l.contains("sign_requested"))
        .expect("event");
    assert!(log.starts_with(
        r#"EVENT_JSON:{"standard":"handover","version":"1.0.0","event":"sign_requested","data":[{"#
    ));
}

#[test]
fn request_transfer_exact_sign_fee_has_no_refund_receipt() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    let receipts = get_created_receipts();
    assert!(receipts
        .iter()
        .all(|r| !matches!(r.actions[0], MockAction::Transfer { .. })));
}

#[test]
#[should_panic(expected = "Only the token owner")]
fn request_transfer_rejects_non_owner() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &bob(), "0");
}

#[test]
#[should_panic(expected = "Token not found")]
fn request_transfer_rejects_unknown_token() {
    let mut c = new_contract();
    request(&mut c, &alice(), "5");
}

#[test]
#[should_panic(expected = "Attach at least 0.01 NEAR")]
fn request_transfer_requires_sign_fee() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request_with(
        &mut c,
        &alice(),
        "0",
        DEAD,
        100,
        21_000,
        GWEI,
        GWEI,
        NearToken::from_millinear(9),
    );
}

#[test]
#[should_panic(expected = "Attach at least 100 Tgas")]
fn request_transfer_requires_enough_gas() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    let mut b = ctx(&alice(), SIGN_FEE);
    b.prepaid_gas(Gas::from_tgas(60));
    testing_env!(b.build());
    c.request_transfer(
        "0".into(),
        DEAD.into(),
        U128(1),
        U128(21_000),
        U128(GWEI),
        U128(GWEI),
    )
    .detach();
}

#[test]
fn transfer_parameter_validation() {
    let ok = |to: &str, v, g, mf, mp| tx::validate_transfer(to, v, g, mf, mp);
    assert!(ok(DEAD, 1, 21_000, 2, 1).is_ok());
    assert!(ok(DEAD, 1, 100_000, 2, 2).is_ok());
    // mixed/upper case hex accepted
    let mixed = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
    assert_eq!(
        hex::encode(ok(mixed, 1, 21_000, 2, 1).unwrap().to),
        mixed[2..].to_lowercase()
    );
    // addresses
    for bad in [
        "",
        "0x",
        "dead",
        "000000000000000000000000000000000000dead", // no prefix
        "0X000000000000000000000000000000000000dead", // wrong prefix case
        "0x00000000000000000000000000000000000dead", // 39 chars
        "0x0000000000000000000000000000000000000dead", // 41 chars
        "0x00000000000000000000000000000000000000zz", // non-hex
        "0x 00000000000000000000000000000000000dead",
        "vitalik.eth",
    ] {
        assert!(ok(bad, 1, 21_000, 2, 1).is_err(), "should reject {bad:?}");
    }
    assert!(ok(DEAD, 0, 21_000, 2, 1).is_err(), "zero value");
    assert!(ok(DEAD, 1, 20_999, 2, 1).is_err(), "gas below 21000");
    assert!(ok(DEAD, 1, 100_001, 2, 1).is_err(), "gas above 100000");
    assert!(ok(DEAD, 1, 21_000, 0, 0).is_err(), "zero fees");
    assert!(ok(DEAD, 1, 21_000, 2, 0).is_err(), "zero priority fee");
    assert!(ok(DEAD, 1, 21_000, 1, 2).is_err(), "priority > max fee");
}

#[test]
#[should_panic(expected = "value_wei must be greater than 0")]
fn contract_rejects_zero_value() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request_with(&mut c, &alice(), "0", DEAD, 0, 21_000, GWEI, GWEI, SIGN_FEE);
}

#[test]
#[should_panic(expected = "40 hex")]
fn contract_rejects_bad_address() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request_with(
        &mut c,
        &alice(),
        "0",
        "0x1234",
        1,
        21_000,
        GWEI,
        GWEI,
        SIGN_FEE,
    );
}

#[test]
#[should_panic(expected = "in flight")]
fn no_second_request_while_in_flight() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    request(&mut c, &alice(), "0");
}

#[test]
#[should_panic(expected = "in flight")]
fn no_retry_while_in_flight() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    set(&alice(), SIGN_FEE);
    c.retry_reserved("0".into()).detach();
}

// ------------------------------------------------------------------- on_signed: success

#[test]
fn on_signed_logs_tx_that_recovers_to_signer_and_advances_nonce() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    let view = complete_ok(&mut c, "0");

    let w = wallet(&c, "0");
    assert_eq!((w.next_nonce, w.in_flight), (1, false));
    assert!(w.reserved.is_none());
    assert_eq!(view.nonce, 0);
    assert_eq!(view.to, DEAD);
    assert_eq!(view.value_wei.0, 100);
    assert_eq!(view.gas_limit.0, 21_000);
    assert_eq!(view.max_fee_per_gas.0, 30 * GWEI);
    assert_eq!(view.max_priority_fee_per_gas.0, GWEI);

    let raw = raw_bytes(&view);
    assert_eq!(
        view.tx_hash,
        format!("0x{}", hex::encode(env::keccak256(&raw)))
    );
    let (items, signer) = decode_signed(&raw);
    assert_eq!(
        signer, TEST_KEY_ADDRESS,
        "raw tx must recover to the signing key's address"
    );
    assert_eq!(
        items[0],
        SEPOLIA_CHAIN_ID
            .to_be_bytes()
            .iter()
            .skip_while(|b| **b == 0)
            .copied()
            .collect::<Vec<u8>>()
    );
    assert!(items[1].is_empty(), "nonce 0 encodes as empty");
    assert_eq!(hex::encode(&items[5]), &DEAD[2..]);
    assert_eq!(items[6], vec![100]);
    assert!(items[7].is_empty(), "input (calldata) must be empty");
    assert_eq!(items[8], vec![0xc0], "access list must be empty");

    // log + view agree
    let log = c.get_sig_log("0".into(), None, None);
    assert_eq!(log, vec![view.clone()]);
    assert_eq!(c.get_wallet("0".into()).unwrap().sig_count, 1);
    let ev = get_logs()
        .into_iter()
        .find(|l| l.contains(r#""event":"signed""#))
        .expect("signed event");
    assert!(ev.contains(&view.tx_hash));
}

#[test]
fn nonces_are_strictly_sequential_and_log_is_ordered() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    for expected in 0..3u64 {
        request(&mut c, &alice(), "0");
        assert_eq!(wallet(&c, "0").reserved.unwrap().nonce, expected);
        let v = complete_ok(&mut c, "0");
        assert_eq!(v.nonce, expected);
        let (items, signer) = decode_signed(&raw_bytes(&v));
        assert_eq!(signer, TEST_KEY_ADDRESS);
        let nonce_item = &items[1];
        let decoded = nonce_item.iter().fold(0u64, |a, b| (a << 8) | *b as u64);
        assert_eq!(decoded, expected);
    }
    let log = c.get_sig_log("0".into(), None, None);
    assert_eq!(
        log.iter().map(|s| s.nonce).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    assert_eq!(c.get_wallet("0".into()).unwrap().next_nonce, 3);
}

/// Find a value whose signature has a leading zero byte in r (or s) so the 31-byte canonical
/// RLP path is exercised with a REAL signature (about 1 in 256 signatures).
fn grind_value(want_r: bool) -> u128 {
    for value in 1u128..20_000 {
        let p = tx::validate_transfer(DEAD, value, 21_000, 30 * GWEI, GWEI).unwrap();
        let t = tx::build_plain_transfer(SEPOLIA_CHAIN_ID, 0, &p);
        let (_, r, s) = mpc_response(&tx::signing_hash(&t));
        if (want_r && r[0] == 0) || (!want_r && s[0] == 0) {
            return value;
        }
    }
    panic!("no leading-zero signature found");
}

fn leading_zero_case(want_r: bool) {
    let value = grind_value(want_r);
    let mut c = new_contract();
    mint(&mut c, &alice());
    request_with(
        &mut c,
        &alice(),
        "0",
        DEAD,
        value,
        21_000,
        30 * GWEI,
        GWEI,
        SIGN_FEE,
    );
    let (resp, r, s) = mpc_response(&reserved_hash(&c, "0"));
    assert!(if want_r { r[0] == 0 } else { s[0] == 0 });
    as_self();
    let view = c.on_signed("0".into(), 0, Ok(resp)).expect("signed");
    let (items, signer) = decode_signed(&raw_bytes(&view));
    assert_eq!(signer, TEST_KEY_ADDRESS);
    let (r_item, s_item) = (&items[10], &items[11]);
    assert!(
        r_item[0] != 0 && s_item[0] != 0,
        "canonical RLP integers have no leading zero byte"
    );
    if want_r {
        assert!(r_item.len() < 32, "r was stripped");
        assert_eq!(&r[r.len() - r_item.len()..], &r_item[..]);
    } else {
        assert!(s_item.len() < 32, "s was stripped");
    }
}

#[test]
fn canonical_rlp_when_r_has_leading_zero_byte() {
    leading_zero_case(true);
}

#[test]
fn canonical_rlp_when_s_has_leading_zero_byte() {
    leading_zero_case(false);
}

/// Independent cross-check against viem 2.x (`serializeTransaction`), generated off-chain.
#[test]
fn matches_independent_viem_vector() {
    let p = TransferParams {
        to: tx::parse_address(DEAD).unwrap(),
        value_wei: 100,
        gas_limit: 21_000,
        max_fee_per_gas: 30 * GWEI,
        max_priority_fee_per_gas: GWEI,
    };
    let t = tx::build_plain_transfer(SEPOLIA_CHAIN_ID, 0, &p);
    assert_eq!(
        hex::encode(t.build_for_signing()),
        "02eb83aa36a780843b9aca008506fc23ac0082520894000000000000000000000000000000000000dead6480c0"
    );
    assert_eq!(
        hex::encode(tx::signing_hash(&t)),
        "6f461ed39123624da7f0ac883f71819f2711ed8975bec819dfa2b0ac84cb61c9"
    );
    // Fixture signature (not a real signature): s has a leading 0x00 byte.
    let json = json!({
        "scheme": "Secp256k1",
        "big_r": {"affine_point": "03c0d51d5f0d0b6d1a0e5b6a4c9b4a2f9f3e2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c"},
        "s": {"scalar": "00aa000000000000000000000000000000000000000000000000000000000001"},
        "recovery_id": 1,
    });
    let resp: SignatureResponse = serde_json::from_value(json).unwrap();
    let sig: ParsedSig = tx::parse_response(&resp).unwrap();
    let raw = tx::assemble(&t, &sig);
    assert_eq!(
        format!("0x{}", hex::encode(&raw)),
        "0x02f86d83aa36a780843b9aca008506fc23ac0082520894000000000000000000000000000000000000dead6480c001a0c0d51d5f0d0b6d1a0e5b6a4c9b4a2f9f3e2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c9faa000000000000000000000000000000000000000000000000000000000001"
    );
    assert_eq!(
        format!("0x{}", hex::encode(env::keccak256(&raw))),
        "0x4400f13b53f63b22ca5ef76544989f5505960bae73630ec7088662dbf521947c"
    );
}

#[test]
fn only_plain_transfers_can_be_built() {
    let p = tx::validate_transfer(DEAD, 1, 21_000, 2, 1).unwrap();
    let t = tx::build_plain_transfer(SEPOLIA_CHAIN_ID, 7, &p);
    assert!(tx::is_plain_transfer(&t));
    assert!(t.input.is_empty() && t.access_list.is_empty());
    let mut with_data = t.clone();
    with_data.input = vec![0xa9, 0x05, 0x9c, 0xbb]; // ERC-20 transfer selector
    assert!(
        !tx::is_plain_transfer(&with_data),
        "calldata must be detected"
    );
    // The reserved/signed record has no field that could carry calldata either.
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    let v = complete_ok(&mut c, "0");
    let (items, _) = decode_signed(&raw_bytes(&v));
    assert!(items[7].is_empty());
}

#[test]
fn callback_gas_is_well_within_budget() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    let (resp, _, _) = mpc_response(&reserved_hash(&c, "0"));
    as_self();
    let before = env::used_gas();
    c.on_signed("0".into(), 0, Ok(resp)).unwrap();
    let used = env::used_gas().as_gas() - before.as_gas();
    // Host-function costs only (wasm instruction gas is not metered in unit tests), so this is a
    // lower bound; the real number is a few Tgas. The static allocation must dwarf it.
    assert!(used < CALLBACK_GAS.as_gas() / 3, "used {used}");
}

// ---------------------------------------------------------------- on_signed: failure paths

#[test]
fn failed_mpc_call_keeps_reservation_and_does_not_consume_nonce() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    let hash_before = reserved_hash(&c, "0");
    assert!(complete_err(&mut c, "0").is_none());

    let w = wallet(&c, "0");
    assert_eq!(w.next_nonce, 0, "failure never increments next_nonce");
    assert!(!w.in_flight);
    let r = w.reserved.expect("reservation stays (D1)");
    assert_eq!((r.nonce, r.payload_hash), (0, hash_before));
    assert!(c.get_sig_log("0".into(), None, None).is_empty());
    assert!(get_logs()
        .iter()
        .any(|l| l.contains(r#""event":"sign_failed""#)));
    let wv = c.get_wallet("0".into()).unwrap();
    assert!(wv.reserved.is_some() && !wv.in_flight);
}

#[test]
#[should_panic(expected = "reserved transaction is pending")]
fn new_request_rejected_while_reserved_even_with_different_args() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    complete_err(&mut c, "0");
    request_with(&mut c, &alice(), "0", DEAD, 1, 21_000, 2, 1, SIGN_FEE);
}

#[test]
fn retry_reserved_resigns_identical_payload_then_nonce_advances() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    let hash = reserved_hash(&c, "0");
    complete_err(&mut c, "0");

    set(&alice(), NearToken::from_millinear(30));
    c.retry_reserved("0".into()).detach();
    let receipts = get_created_receipts();
    let sign = receipts
        .iter()
        .find(|r| r.receiver_id.as_str() == MPC)
        .unwrap();
    let MockAction::FunctionCallWeight {
        args,
        attached_deposit,
        ..
    } = &sign.actions[0]
    else {
        panic!()
    };
    assert_eq!(*attached_deposit, Y1);
    let v: Value = serde_json::from_slice(args).unwrap();
    assert_eq!(
        v["request"]["payload_v2"]["Ecdsa"],
        hex::encode(hash),
        "identical payload"
    );
    assert_eq!(v["request"]["path"], "handover-0");
    let w = wallet(&c, "0");
    assert!(w.in_flight);
    assert_eq!(w.reserved.as_ref().unwrap().attempts, 2);
    assert_eq!(w.next_nonce, 0);
    // excess over SIGN_FEE refunded
    assert!(receipts.iter().any(|r| matches!(r.actions[0], MockAction::Transfer { deposit, .. } if deposit.as_millinear() == 20)));

    let v = complete_ok(&mut c, "0");
    assert_eq!(v.nonce, 0);
    assert_eq!(wallet(&c, "0").next_nonce, 1);
    assert!(wallet(&c, "0").reserved.is_none());
    // and the next request uses nonce 1
    request(&mut c, &alice(), "0");
    assert_eq!(wallet(&c, "0").reserved.unwrap().nonce, 1);
}

#[test]
#[should_panic(expected = "Nothing is reserved")]
fn retry_reserved_requires_a_reservation() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), SIGN_FEE);
    c.retry_reserved("0".into()).detach();
}

#[test]
#[should_panic(expected = "Only the token owner")]
fn retry_reserved_owner_only() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    complete_err(&mut c, "0");
    set(&bob(), SIGN_FEE);
    c.retry_reserved("0".into()).detach();
}

#[test]
#[should_panic(expected = "Attach at least 0.01 NEAR")]
fn retry_reserved_requires_sign_fee() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    complete_err(&mut c, "0");
    set(&alice(), NearToken::from_millinear(1));
    c.retry_reserved("0".into()).detach();
}

#[test]
fn on_signed_never_panics_on_bad_responses_and_keeps_reservation() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    let hash = reserved_hash(&c, "0");
    let (good, r, s) = mpc_response(&hash);
    let SignatureResponse::Secp256k1(g) = good.clone();

    let mut cases: Vec<SignatureResponse> = vec![];
    let mut bad = g.clone();
    bad.recovery_id = 2;
    cases.push(SignatureResponse::Secp256k1(bad));
    let mut bad = g.clone();
    bad.recovery_id = 255;
    cases.push(SignatureResponse::Secp256k1(bad));
    let mut bad = g.clone();
    bad.s.scalar = "zz".into();
    cases.push(SignatureResponse::Secp256k1(bad));
    let mut bad = g.clone();
    bad.big_r.affine_point = "04".to_string() + &hex::encode(r); // wrong prefix, wrong length
    cases.push(SignatureResponse::Secp256k1(bad));
    let mut bad = g.clone();
    bad.big_r.affine_point = String::new();
    cases.push(SignatureResponse::Secp256k1(bad));
    let mut bad = g.clone();
    bad.s.scalar = hex::encode([0u8; 32]);
    cases.push(SignatureResponse::Secp256k1(bad));
    let mut bad = g.clone();
    bad.s.scalar = hex::encode(s)[..62].to_string(); // short
    cases.push(SignatureResponse::Secp256k1(bad));
    // r that is not a valid curve x-coordinate fails ecrecover. (ecrecover cannot pin the KEY: any
    // well-formed (r, s, v) recovers to some key; that the key is the token's derived key is
    // guaranteed by the MPC contract's own `respond` check. See README "Trust".)
    let mut bad = g.clone();
    bad.big_r.affine_point = format!("02{}", "ff".repeat(32));
    cases.push(SignatureResponse::Secp256k1(bad));
    // high-s malleated signature is rejected by ecrecover(malleability_flag = true)
    {
        let n = hex::decode("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141")
            .unwrap();
        let mut high = [0u8; 32];
        let mut borrow = 0i32;
        for i in (0..32).rev() {
            let d = n[i] as i32 - s[i] as i32 - borrow;
            borrow = (d < 0) as i32;
            high[i] = (d & 0xff) as u8;
        }
        let mut bad = g.clone();
        bad.s.scalar = hex::encode(high);
        bad.recovery_id ^= 1;
        cases.push(SignatureResponse::Secp256k1(bad));
    }

    for (i, case) in cases.into_iter().enumerate() {
        as_self();
        let out = c.on_signed("0".into(), 0, Ok(case));
        assert!(out.is_none(), "case {i} must be rejected");
        let w = wallet(&c, "0");
        assert!(!w.in_flight, "case {i}");
        assert_eq!(w.next_nonce, 0, "case {i}");
        assert!(w.reserved.is_some(), "case {i}");
        // put it back in flight for the next case
        c.wallets.get_mut("0").unwrap().in_flight = true;
    }
    assert!(c.get_sig_log("0".into(), None, None).is_empty());
    // and the good one still works afterwards
    as_self();
    assert!(c.on_signed("0".into(), 0, Ok(good)).is_some());
}

#[test]
fn on_signed_ignores_stale_or_unknown_callbacks_without_panicking() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    // unknown token
    as_self();
    assert!(c
        .on_signed("42".into(), 0, Err(PromiseError::Failed))
        .is_none());
    // nothing reserved / not in flight
    let (resp, _, _) = mpc_response(&[1u8; 32]);
    assert!(c.on_signed("0".into(), 0, Ok(resp.clone())).is_none());
    assert_eq!(wallet(&c, "0").next_nonce, 0);
    // wrong nonce for an in-flight reservation
    request(&mut c, &alice(), "0");
    let (resp, _, _) = mpc_response(&reserved_hash(&c, "0"));
    as_self();
    assert!(c.on_signed("0".into(), 5, Ok(resp)).is_none());
    assert_eq!(wallet(&c, "0").next_nonce, 0);
    assert!(wallet(&c, "0").reserved.is_some());
}

#[test]
#[should_panic(expected = "private")]
fn on_signed_rejects_non_contract_predecessor() {
    // NOTE: `#[private]` is generated into the wasm export wrapper and is NOT enforced when a
    // method is called directly in a unit test. The method therefore also checks the predecessor
    // itself, which is what this test exercises. The wrapper-level check is covered by review
    // of the macro output and should be confirmed in a sandbox run.
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    let (resp, _, _) = mpc_response(&reserved_hash(&c, "0"));
    set(&alice(), NearToken::from_yoctonear(0));
    c.on_signed("0".into(), 0, Ok(resp));
}

// ----------------------------------------------------------------------- list / delist

fn listed_contract() -> Handover {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), Y1);
    c.list("0".into(), U128(5 * ONE_NEAR.as_yoctonear()));
    c
}

#[test]
fn list_creates_listing_and_views() {
    let c = listed_contract();
    let l = c.get_listing("0".into()).unwrap();
    assert_eq!(
        (l.seller_id, l.price.0),
        (alice(), 5 * ONE_NEAR.as_yoctonear())
    );
    assert_eq!(
        c.get_wallet("0".into()).unwrap().listing.unwrap().token_id,
        "0"
    );
    assert_eq!(c.list_listings(None, None).len(), 1);
    let ev = get_logs()
        .into_iter()
        .find(|l| l.contains(r#""event":"listed""#))
        .unwrap();
    let json: Value = serde_json::from_str(ev.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(json["standard"], "handover");
    assert_eq!(json["version"], "1.0.0");
    assert_eq!(json["data"][0]["token_id"], "0");
    assert_eq!(
        json["data"][0]["price"],
        (5 * ONE_NEAR.as_yoctonear()).to_string()
    );
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn list_requires_exactly_one_yocto_not_zero() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), NearToken::from_yoctonear(0));
    c.list("0".into(), U128(1));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn list_requires_exactly_one_yocto_not_more() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), NearToken::from_yoctonear(2));
    c.list("0".into(), U128(1));
}

#[test]
#[should_panic(expected = "Only the token owner")]
fn list_owner_only() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&bob(), Y1);
    c.list("0".into(), U128(1));
}

#[test]
#[should_panic(expected = "Price must be greater than 0")]
fn list_rejects_zero_price() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), Y1);
    c.list("0".into(), U128(0));
}

#[test]
#[should_panic(expected = "Already listed")]
fn list_twice_rejected() {
    let mut c = listed_contract();
    set(&alice(), Y1);
    c.list("0".into(), U128(9));
}

#[test]
#[should_panic(expected = "in flight")]
fn list_rejected_while_in_flight() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    set(&alice(), Y1);
    c.list("0".into(), U128(1));
}

#[test]
#[should_panic(expected = "reserved transaction is pending")]
fn list_rejected_while_reserved() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    complete_err(&mut c, "0");
    set(&alice(), Y1);
    c.list("0".into(), U128(1));
}

#[test]
#[should_panic(expected = "listed")]
fn request_transfer_rejected_while_listed() {
    let mut c = listed_contract();
    request(&mut c, &alice(), "0");
}

#[test]
#[should_panic(expected = "listed")]
fn retry_reserved_rejected_while_listed() {
    // Reach an (impossible via the public API) listed+reserved state to prove the guard itself.
    let mut c = listed_contract();
    c.wallets.get_mut("0").unwrap().reserved = Some(ReservedTx {
        nonce: 0,
        to: [0; 20],
        value_wei: 1,
        gas_limit: 21_000,
        max_fee_per_gas: 2,
        max_priority_fee_per_gas: 1,
        payload_hash: [0; 32],
        requested_at_ns: 0,
        attempts: 1,
    });
    set(&alice(), SIGN_FEE);
    c.retry_reserved("0".into()).detach();
}

#[test]
fn delist_unfreezes_signing() {
    let mut c = listed_contract();
    set(&alice(), Y1);
    c.delist("0".into());
    assert!(c.get_listing("0".into()).is_none());
    assert!(c.list_listings(None, None).is_empty());
    assert!(get_logs()
        .iter()
        .any(|l| l.contains(r#""event":"delisted""#)));
    request(&mut c, &alice(), "0"); // works again
    assert!(wallet(&c, "0").in_flight);
}

#[test]
#[should_panic(expected = "Only the token owner")]
fn delist_owner_only() {
    let mut c = listed_contract();
    set(&bob(), Y1);
    c.delist("0".into());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn delist_requires_one_yocto() {
    let mut c = listed_contract();
    set(&alice(), NearToken::from_yoctonear(0));
    c.delist("0".into());
}

#[test]
#[should_panic(expected = "Not listed")]
fn delist_requires_listing() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), Y1);
    c.delist("0".into());
}

#[test]
fn list_listings_paginates() {
    let mut c = new_contract();
    for _ in 0..5 {
        mint(&mut c, &alice());
    }
    for i in 0..5 {
        set(&alice(), Y1);
        c.list(i.to_string(), U128(10 + i as u128));
    }
    assert_eq!(c.list_listings(None, None).len(), 5);
    let page = c.list_listings(Some(1), Some(2));
    assert_eq!(
        page.iter().map(|l| l.token_id.as_str()).collect::<Vec<_>>(),
        vec!["1", "2"]
    );
    assert_eq!(c.list_listings(Some(4), Some(10)).len(), 1);
    assert!(c.list_listings(Some(5), None).is_empty());
    assert_eq!(views::clamp_limit(Some(1000)), 100);
    assert_eq!(views::clamp_limit(None), 50);
}

// -------------------------------------------------------------------------- transfers

#[test]
fn nft_transfer_moves_ownership_and_refuses_old_owner() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), Y1);
    c.nft_transfer(bob(), "0".into(), None, None);
    assert_eq!(c.get_wallet("0".into()).unwrap().owner_id, bob());
    // new owner can sign
    request(&mut c, &bob(), "0");
    complete_ok(&mut c, "0");
}

#[test]
#[should_panic(expected = "Only the token owner")]
fn old_owner_cannot_request_after_nft_transfer() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), Y1);
    c.nft_transfer(bob(), "0".into(), None, None);
    request(&mut c, &alice(), "0");
}

#[test]
#[should_panic(expected = "Only the token owner")]
fn old_owner_cannot_retry_or_list_after_nft_transfer() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), Y1);
    c.nft_transfer(bob(), "0".into(), None, None);
    set(&alice(), Y1);
    c.list("0".into(), U128(1));
}

#[test]
#[should_panic(expected = "listed")]
fn nft_transfer_rejected_while_listed() {
    let mut c = listed_contract();
    set(&alice(), Y1);
    c.nft_transfer(bob(), "0".into(), None, None);
}

#[test]
#[should_panic(expected = "listed")]
fn nft_transfer_call_rejected_while_listed() {
    let mut c = listed_contract();
    set(&alice(), Y1);
    let _ = c.nft_transfer_call(bob(), "0".into(), None, None, "".into());
}

#[test]
#[should_panic(expected = "in flight")]
fn nft_transfer_rejected_while_in_flight() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    set(&alice(), Y1);
    c.nft_transfer(bob(), "0".into(), None, None);
}

#[test]
#[should_panic(expected = "reserved transaction is pending")]
fn nft_transfer_rejected_while_reserved() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    complete_err(&mut c, "0");
    set(&alice(), Y1);
    c.nft_transfer(bob(), "0".into(), None, None);
}

#[test]
#[should_panic(expected = "reserved transaction is pending")]
fn nft_transfer_call_rejected_while_reserved() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    complete_err(&mut c, "0");
    set(&alice(), Y1);
    let _ = c.nft_transfer_call(bob(), "0".into(), None, None, "".into());
}

#[test]
#[should_panic(expected = "listed")]
fn approved_account_cannot_transfer_listed_token() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), ONE_NEAR);
    let _ = c.nft_approve("0".into(), carol(), None);
    set(&alice(), Y1);
    c.list("0".into(), U128(1));
    set(&carol(), Y1);
    c.nft_transfer(carol(), "0".into(), None, None);
}

// ------------------------------------------------------------------------------- buy

const PRICE: u128 = 5 * 1_000_000_000_000_000_000_000_000;

#[test]
fn buy_moves_nft_pays_seller_exactly_and_refunds_excess() {
    let mut c = listed_contract();
    set(
        &bob(),
        NearToken::from_yoctonear(PRICE + 7 * 10u128.pow(23)),
    );
    c.buy("0".into());
    let receipts = get_created_receipts();
    let paid = |who: &AccountId| {
        receipts
            .iter()
            .find_map(|r| match (&r.receiver_id, &r.actions[0]) {
                (id, MockAction::Transfer { deposit, .. }) if id == who => {
                    Some(deposit.as_yoctonear())
                }
                _ => None,
            })
    };
    assert_eq!(
        paid(&alice()),
        Some(PRICE),
        "seller is paid exactly the price"
    );
    assert_eq!(
        paid(&bob()),
        Some(7 * 10u128.pow(23)),
        "excess refunded to buyer"
    );
    assert_eq!(receipts.len(), 2);

    assert_eq!(c.nft_token("0".into()).unwrap().owner_id, bob());
    assert_eq!(c.get_wallet("0".into()).unwrap().owner_id, bob());
    assert!(c.get_listing("0".into()).is_none());
    assert!(c.list_listings(None, None).is_empty());
    assert_eq!(c.nft_supply_for_owner(alice()).0, 0);
    assert_eq!(c.nft_tokens_for_owner(bob(), None, None).len(), 1);
    let logs = get_logs();
    assert!(logs
        .iter()
        .any(|l| l.contains(r#""event":"sold""#) && l.contains(&PRICE.to_string())));
    assert!(logs.iter().any(|l| l.contains(r#""event":"nft_transfer""#)));

    // signing is unfrozen for the buyer ...
    request(&mut c, &bob(), "0");
    assert!(wallet(&c, "0").in_flight);
}

#[test]
fn buy_with_exact_price_has_no_refund_receipt() {
    let mut c = listed_contract();
    set(&bob(), NearToken::from_yoctonear(PRICE));
    c.buy("0".into());
    assert_eq!(get_created_receipts().len(), 1);
}

#[test]
#[should_panic(expected = "Only the token owner")]
fn old_owner_refused_after_buy() {
    let mut c = listed_contract();
    set(&bob(), NearToken::from_yoctonear(PRICE));
    c.buy("0".into());
    request(&mut c, &alice(), "0");
}

#[test]
#[should_panic(expected = "less than the price")]
fn buy_rejects_underpayment() {
    let mut c = listed_contract();
    set(&bob(), NearToken::from_yoctonear(PRICE - 1));
    c.buy("0".into());
}

#[test]
#[should_panic(expected = "not listed")]
fn buy_rejects_unlisted_token() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&bob(), ONE_NEAR);
    c.buy("0".into());
}

#[test]
#[should_panic(expected = "Seller cannot buy")]
fn seller_cannot_buy_own_listing() {
    let mut c = listed_contract();
    set(&alice(), NearToken::from_yoctonear(PRICE));
    c.buy("0".into());
}

#[test]
#[should_panic(expected = "pending signature")]
fn buy_rejected_while_in_flight_or_reserved() {
    // Unreachable through the public API (list() refuses these states and listing blocks
    // signing); forced here to prove the guard inside buy() independently.
    let mut c = listed_contract();
    c.wallets.get_mut("0").unwrap().in_flight = true;
    set(&bob(), NearToken::from_yoctonear(PRICE));
    c.buy("0".into());
}

#[test]
fn buy_clears_approvals() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    set(&alice(), ONE_NEAR);
    let _ = c.nft_approve("0".into(), carol(), None);
    assert!(c.nft_is_approved("0".into(), carol(), None));
    set(&alice(), Y1);
    c.list("0".into(), U128(PRICE));
    set(&bob(), NearToken::from_yoctonear(PRICE));
    c.buy("0".into());
    assert!(
        !c.nft_is_approved("0".into(), carol(), None),
        "old approvals do not survive a sale"
    );
}

#[test]
fn buyer_signs_after_sale_and_log_continues_from_seller_nonce() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    request(&mut c, &alice(), "0");
    complete_ok(&mut c, "0");
    set(&alice(), Y1);
    c.list("0".into(), U128(PRICE));
    set(&bob(), NearToken::from_yoctonear(PRICE));
    c.buy("0".into());
    request(&mut c, &bob(), "0");
    let v = complete_ok(&mut c, "0");
    assert_eq!(v.nonce, 1, "nonces continue across owners");
    assert_eq!(c.get_sig_log("0".into(), None, None).len(), 2);
}

// ------------------------------------------------------------------------ sig log views

#[test]
fn sig_log_pagination() {
    let mut c = new_contract();
    mint(&mut c, &alice());
    for _ in 0..5 {
        request(&mut c, &alice(), "0");
        complete_ok(&mut c, "0");
    }
    let nonces = |from, limit| -> Vec<u64> {
        c.get_sig_log("0".into(), from, limit)
            .iter()
            .map(|s| s.nonce)
            .collect()
    };
    assert_eq!(nonces(None, None), vec![0, 1, 2, 3, 4]);
    assert_eq!(nonces(Some(2), None), vec![2, 3, 4]);
    assert_eq!(nonces(Some(1), Some(2)), vec![1, 2]);
    assert_eq!(nonces(Some(4), Some(100)), vec![4]);
    assert!(nonces(Some(5), None).is_empty());
    assert!(nonces(Some(u64::MAX), Some(u64::MAX)).is_empty());
    assert!(c.get_sig_log("nope".into(), None, None).is_empty());
}

#[test]
fn sig_log_limit_is_capped_at_100() {
    // Fill the log directly (storage-level) to avoid 101 MPC round trips.
    let mut c = new_contract();
    mint(&mut c, &alice());
    for n in 0..120u64 {
        c.sig_log.insert(
            ("0".to_string(), n),
            SignedTx {
                nonce: n,
                to: [1; 20],
                value_wei: 1,
                gas_limit: 21_000,
                max_fee_per_gas: 2,
                max_priority_fee_per_gas: 1,
                tx_hash: [0; 32],
                raw_signed_tx: vec![2],
                signed_at_ns: 0,
            },
        );
    }
    c.wallets.get_mut("0").unwrap().next_nonce = 120;
    assert_eq!(
        c.get_sig_log("0".into(), None, None).len(),
        50,
        "default 50"
    );
    assert_eq!(
        c.get_sig_log("0".into(), None, Some(1000)).len(),
        100,
        "max 100"
    );
    assert_eq!(c.get_sig_log("0".into(), Some(100), Some(1000)).len(), 20);
}

// ------------------------------------------------------------------- no admin surface

/// The contract must be unownable. This guards against someone adding upgrade/key/deploy paths
/// (or owner setters) to production sources later.
#[test]
fn production_sources_have_no_upgrade_or_key_management() {
    let sources = [
        include_str!("lib.rs"),
        include_str!("wallet.rs"),
        include_str!("market.rs"),
        include_str!("views.rs"),
        include_str!("tx.rs"),
        include_str!("mpc.rs"),
        include_str!("events.rs"),
        include_str!("types.rs"),
    ];
    for banned in [
        "deploy_contract",
        "add_full_access_key",
        "add_access_key",
        "delete_account",
        "delete_key",
        "function_call_weight(\"migrate",
        "pub fn upgrade",
        "pub fn set_",
        "pub fn migrate",
        "assert_owner",
        "env::state_write",
    ] {
        for src in sources {
            // Compare against the production half only (everything before a test module).
            assert!(!src.contains(banned), "found banned pattern {banned:?}");
        }
    }
}
