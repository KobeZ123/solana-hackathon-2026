use solana_sdk::{pubkey::Pubkey, signer::Signer};

use super::common::*;
use crate::errors::EventPoolError;
use crate::state::EventStatus;

#[test]
fn host_can_set_gate() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_default_event(&mut env, &host);
    assert_eq!(env.get_event(&event).gate_authority, host.pubkey());

    let gate = Pubkey::new_unique();
    let res = env.send(&[set_gate_ix(&host.pubkey(), &event, &gate)], &host, &[]);
    assert_ok(&res);
    assert_eq!(env.get_event(&event).gate_authority, gate);

    // Can be rotated again, and set back to the host.
    let gate2 = Pubkey::new_unique();
    assert_ok(&env.send(&[set_gate_ix(&host.pubkey(), &event, &gate2)], &host, &[]));
    assert_eq!(env.get_event(&event).gate_authority, gate2);
    assert_ok(&env.send(
        &[set_gate_ix(&host.pubkey(), &event, &host.pubkey())],
        &host,
        &[],
    ));
    assert_eq!(env.get_event(&event).gate_authority, host.pubkey());
}

#[test]
fn set_gate_does_not_touch_other_fields() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_default_event(&mut env, &host);
    let before = env.get_event(&event);
    let gate = Pubkey::new_unique();
    assert_ok(&env.send(&[set_gate_ix(&host.pubkey(), &event, &gate)], &host, &[]));
    let mut after = env.get_event(&event);
    after.gate_authority = before.gate_authority;
    assert_eq!(after.entry_fee, before.entry_fee);
    assert_eq!(after.capacity, before.capacity);
    assert_eq!(after.status, before.status);
    assert_eq!(after.metadata_hash, before.metadata_hash);
}

#[test]
fn non_host_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let attacker = env.funded(10);
    let event = create_default_event(&mut env, &host);

    let res = env.send(
        &[set_gate_ix(&attacker.pubkey(), &event, &attacker.pubkey())],
        &attacker,
        &[],
    );
    assert_program_err(&res, EventPoolError::NotHost);
    assert_eq!(env.get_event(&event).gate_authority, host.pubkey());
}

#[test]
fn current_gate_authority_is_not_enough() {
    // Only the host may change the gate, even the current gate cannot.
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let gate = env.funded(1);
    let event = create_default_event(&mut env, &host);
    assert_ok(&env.send(
        &[set_gate_ix(&host.pubkey(), &event, &gate.pubkey())],
        &host,
        &[],
    ));

    let res = env.send(
        &[set_gate_ix(&gate.pubkey(), &event, &Pubkey::new_unique())],
        &gate,
        &[],
    );
    assert_program_err(&res, EventPoolError::NotHost);
}

#[test]
fn host_must_sign() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let payer = env.funded(10);
    let event = create_default_event(&mut env, &host);
    // `host` is named as the signer in the instruction but does not sign.
    let ix = set_gate_ix(&host.pubkey(), &event, &payer.pubkey());
    let res = env.send_missing_signer(&[ix], &payer);
    assert!(res.is_err());
    assert_eq!(env.get_event(&event).gate_authority, host.pubkey());
}

#[test]
fn rejected_when_not_open() {
    // Event status other than Open cannot be reached through T10 instructions, so write the
    // account state directly.
    use anchor_lang::{AccountDeserialize, AccountSerialize};
    for status in [EventStatus::Ended, EventStatus::Cancelled] {
        let mut env = TestEnv::new();
        let host = env.funded(10);
        let event = create_default_event(&mut env, &host);

        let mut acc = env.svm.get_account(&event).unwrap();
        let mut ev = crate::state::Event::try_deserialize(&mut acc.data.as_slice()).unwrap();
        ev.status = status;
        let mut data = Vec::new();
        ev.try_serialize(&mut data).unwrap();
        acc.data[..data.len()].copy_from_slice(&data);
        env.svm.set_account(event, acc).unwrap();

        let res = env.send(
            &[set_gate_ix(&host.pubkey(), &event, &Pubkey::new_unique())],
            &host,
            &[],
        );
        assert_program_err(&res, EventPoolError::EventNotOpen);
        assert_eq!(env.get_event(&event).gate_authority, host.pubkey());
    }
}

#[test]
fn wrong_event_account_rejected() {
    // An account that is not the event PDA derived from its own fields is refused.
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let ix = set_gate_ix(&host.pubkey(), &Pubkey::new_unique(), &host.pubkey());
    let res = env.send(&[ix], &host, &[]);
    assert!(res.is_err());
}
