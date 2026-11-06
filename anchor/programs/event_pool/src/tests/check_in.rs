use solana_sdk::{pubkey::Pubkey, signer::Signer};

use super::common::*;
use crate::errors::EventPoolError;
use crate::state::EventStatus;

const START: i64 = T0 + 2 * 3600;
const END: i64 = T0 + 6 * 3600;
const GRACE: i64 = 3600;

#[test]
fn host_is_default_gate_and_can_check_in() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let ticket = join_default(&mut env, &member, &event);
    env.warp_to(START);

    let res = env.send(
        &[check_in_ix(&host.pubkey(), &event, &member.pubkey())],
        &host,
        &[],
    );
    assert_ok(&res);
    let t = env.get_ticket(&ticket);
    assert!(t.checked_in);
    assert_eq!(t.checked_in_at, START);
    assert!(!t.claimed);
    assert_eq!(env.get_event(&event).checked_in, 1);
}

#[test]
fn counter_increments_per_member() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_default_event(&mut env, &host);
    let members: Vec<_> = (0..3).map(|_| env.funded(5)).collect();
    for m in &members {
        join_default(&mut env, m, &event);
    }
    env.warp_to(START);
    for (i, m) in members.iter().enumerate() {
        assert_ok(&env.send(
            &[check_in_ix(&host.pubkey(), &event, &m.pubkey())],
            &host,
            &[],
        ));
        assert_eq!(env.get_event(&event).checked_in, i as u32 + 1);
    }
    assert_eq!(env.get_event(&event).tickets_sold, 3);
}

#[test]
fn after_set_gate_only_new_gate_can_check_in() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let gate = env.funded(1);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let ticket = join_default(&mut env, &member, &event);
    assert_ok(&env.send(
        &[set_gate_ix(&host.pubkey(), &event, &gate.pubkey())],
        &host,
        &[],
    ));
    env.warp_to(START);

    let res = env.send(
        &[check_in_ix(&host.pubkey(), &event, &member.pubkey())],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::NotGateAuthority);
    assert!(!env.get_ticket(&ticket).checked_in);

    assert_ok(&env.send(
        &[check_in_ix(&gate.pubkey(), &event, &member.pubkey())],
        &gate,
        &[],
    ));
    assert!(env.get_ticket(&ticket).checked_in);
    assert_eq!(env.get_event(&event).checked_in, 1);
}

#[test]
fn non_gate_signer_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    join_default(&mut env, &member, &event);
    env.warp_to(START);
    // The member cannot check themselves in.
    let res = env.send(
        &[check_in_ix(&member.pubkey(), &event, &member.pubkey())],
        &member,
        &[],
    );
    assert_program_err(&res, EventPoolError::NotGateAuthority);
    assert_eq!(env.get_event(&event).checked_in, 0);
}

#[test]
fn gate_must_sign() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let payer = env.funded(5);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    join_default(&mut env, &member, &event);
    env.warp_to(START);
    let ix = check_in_ix(&host.pubkey(), &event, &member.pubkey());
    assert!(env.send_missing_signer(&[ix], &payer).is_err());
    assert_eq!(env.get_event(&event).checked_in, 0);
}

#[test]
fn grace_window_boundaries() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let ticket = join_default(&mut env, &member, &event);
    let ix = check_in_ix(&host.pubkey(), &event, &member.pubkey());

    // Well before and one second before the window opens.
    env.warp_to(T0);
    assert_program_err(
        &env.send(std::slice::from_ref(&ix), &host, &[]),
        EventPoolError::CheckInNotOpen,
    );
    env.warp_to(START - GRACE - 1);
    assert_program_err(
        &env.send(std::slice::from_ref(&ix), &host, &[]),
        EventPoolError::CheckInNotOpen,
    );
    assert!(!env.get_ticket(&ticket).checked_in);

    // Exactly when it opens.
    env.warp_to(START - GRACE);
    assert_ok(&env.send(&[ix], &host, &[]));
    assert_eq!(env.get_ticket(&ticket).checked_in_at, START - GRACE);
}

#[test]
fn end_ts_boundaries() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let early = env.funded(5);
    let late = env.funded(5);
    let event = create_default_event(&mut env, &host);
    join_default(&mut env, &early, &event);
    let late_ticket = join_default(&mut env, &late, &event);

    // now == end_ts is still allowed.
    env.warp_to(END);
    assert_ok(&env.send(
        &[check_in_ix(&host.pubkey(), &event, &early.pubkey())],
        &host,
        &[],
    ));
    // One second after is not.
    env.warp_to(END + 1);
    let res = env.send(
        &[check_in_ix(&host.pubkey(), &event, &late.pubkey())],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::CheckInNotOpen);
    assert!(!env.get_ticket(&late_ticket).checked_in);
    assert_eq!(env.get_event(&event).checked_in, 1);
}

#[test]
fn double_check_in_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let ticket = join_default(&mut env, &member, &event);
    env.warp_to(START);
    let ix = check_in_ix(&host.pubkey(), &event, &member.pubkey());
    assert_ok(&env.send(std::slice::from_ref(&ix), &host, &[]));
    env.warp_by(60);
    let res = env.send(&[ix], &host, &[]);
    assert_program_err(&res, EventPoolError::AlreadyCheckedIn);
    assert_eq!(env.get_event(&event).checked_in, 1);
    assert_eq!(env.get_ticket(&ticket).checked_in_at, START);
}

#[test]
fn rejected_when_not_open() {
    for status in [EventStatus::Ended, EventStatus::Cancelled] {
        let mut env = TestEnv::new();
        let host = env.funded(10);
        let member = env.funded(5);
        let event = create_default_event(&mut env, &host);
        join_default(&mut env, &member, &event);
        env.warp_to(START);
        mutate_event(&mut env, &event, |e| e.status = status);
        let res = env.send(
            &[check_in_ix(&host.pubkey(), &event, &member.pubkey())],
            &host,
            &[],
        );
        assert_program_err(&res, EventPoolError::EventNotOpen);
    }
}

#[test]
fn member_without_ticket_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_default_event(&mut env, &host);
    env.warp_to(START);
    let res = env.send(
        &[check_in_ix(&host.pubkey(), &event, &Pubkey::new_unique())],
        &host,
        &[],
    );
    assert!(res.is_err());
    assert_eq!(env.get_event(&event).checked_in, 0);
}

#[test]
fn ticket_of_another_member_cannot_be_substituted() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let a = env.funded(5);
    let b = env.funded(5);
    let event = create_default_event(&mut env, &host);
    join_default(&mut env, &a, &event);
    let ticket_b = join_default(&mut env, &b, &event);
    env.warp_to(START);
    // Name member `a` but pass `b`'s ticket: seeds mismatch.
    let mut ix = check_in_ix(&host.pubkey(), &event, &a.pubkey());
    ix.accounts[3].pubkey = ticket_b;
    assert!(env.send(&[ix], &host, &[]).is_err());
    assert!(!env.get_ticket(&ticket_b).checked_in);
}

#[test]
fn rotate_rejected_after_real_check_in() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let ticket = join_default(&mut env, &member, &event);
    let key_before = env.get_ticket(&ticket).ticket_key;
    env.warp_to(START);
    assert_ok(&env.send(
        &[check_in_ix(&host.pubkey(), &event, &member.pubkey())],
        &host,
        &[],
    ));
    let res = env.send(
        &[rotate_ticket_key_ix(
            &member.pubkey(),
            &event,
            &Pubkey::new_unique(),
        )],
        &member,
        &[],
    );
    assert_program_err(&res, EventPoolError::AlreadyCheckedIn);
    assert_eq!(env.get_ticket(&ticket).ticket_key, key_before);
}
