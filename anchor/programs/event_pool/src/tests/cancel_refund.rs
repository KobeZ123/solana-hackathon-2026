//! T14: cancel_event, refund.
//!
//! Members join via the real `join_event`.
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};

use super::common::*;
use super::support_state::*;
use crate::errors::EventPoolError;
use crate::state::EventStatus;

const FEE: u64 = 100_000_000;

struct Scenario {
    host: Keypair,
    payer: Keypair, // pays tx fees so balance deltas are exact
    members: Vec<Keypair>,
    event: Pubkey,
}

fn scenario(joined: usize) -> (TestEnv, Scenario) {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let payer = env.funded(10);
    let event = create_default_event(&mut env, &host);
    let mut members = vec![];
    for _ in 0..joined {
        let m = env.funded(1);
        join_default(&mut env, &m, &event);
        members.push(m);
    }
    (
        env,
        Scenario {
            host,
            payer,
            members,
            event,
        },
    )
}

fn cancel(env: &mut TestEnv, s: &Scenario) -> TxResult {
    env.send(
        &[cancel_event_ix(&s.host.pubkey(), &s.event)],
        &s.payer,
        &[&s.host],
    )
}

fn refund(env: &mut TestEnv, s: &Scenario, i: usize) -> TxResult {
    let m = &s.members[i];
    env.send(&[refund_ix(&m.pubkey(), &s.event)], &s.payer, &[m])
}

#[test]
fn cancel_before_start_succeeds() {
    let (mut env, s) = scenario(2);
    assert_ok(&cancel(&mut env, &s));
    let e = env.get_event(&s.event);
    assert_eq!(e.status, EventStatus::Cancelled);
    assert_eq!(e.tickets_sold, 2);
}

#[test]
fn cancel_at_or_after_start_rejected() {
    let (mut env, s) = scenario(1);
    let start = env.get_event(&s.event).start_ts;
    env.warp_to(start);
    assert_program_err(&cancel(&mut env, &s), EventPoolError::EventStarted);
    env.warp_to(start + 3600);
    assert_program_err(&cancel(&mut env, &s), EventPoolError::EventStarted);
    assert_eq!(env.get_event(&s.event).status, EventStatus::Open);
}

#[test]
fn cancel_one_second_before_start_succeeds() {
    let (mut env, s) = scenario(0);
    let start = env.get_event(&s.event).start_ts;
    env.warp_to(start - 1);
    assert_ok(&cancel(&mut env, &s));
}

#[test]
fn cancel_twice_rejected() {
    let (mut env, s) = scenario(1);
    assert_ok(&cancel(&mut env, &s));
    assert_program_err(&cancel(&mut env, &s), EventPoolError::EventNotOpen);
}

#[test]
fn cancel_after_end_rejected() {
    let (mut env, s) = scenario(1);
    env.warp_to(env.get_event(&s.event).end_ts);
    assert_ok(&env.send(
        &[end_event_ix(&s.host.pubkey(), &s.event)],
        &s.payer,
        &[&s.host],
    ));
    // Ended and past start: the status check fires first.
    assert_program_err(&cancel(&mut env, &s), EventPoolError::EventNotOpen);
}

#[test]
fn non_host_cannot_cancel() {
    let (mut env, s) = scenario(1);
    let other = env.funded(5);
    let res = env.send(&[cancel_event_ix(&other.pubkey(), &s.event)], &other, &[]);
    assert_program_err(&res, EventPoolError::NotHost);
    assert_eq!(env.get_event(&s.event).status, EventStatus::Open);
}

#[test]
fn cancel_requires_host_signature() {
    let (mut env, s) = scenario(1);
    let res = env.send_missing_signer(&[cancel_event_ix(&s.host.pubkey(), &s.event)], &s.payer);
    assert!(res.is_err());
}

#[test]
fn refund_returns_exact_fee_and_closes_ticket() {
    let (mut env, s) = scenario(3);
    let (vault, _) = vault_pda(&s.event);
    let rent = env.rent_min();
    let m = s.members[0].pubkey();
    let (ticket, _) = ticket_pda(&s.event, &m);
    let ticket_rent = env.balance(&ticket);
    assert!(ticket_rent > 0);
    assert_ok(&cancel(&mut env, &s));

    let before = env.balance(&m);
    assert_ok(&refund(&mut env, &s, 0));
    // entry fee from the vault plus the ticket's rent, both to the member.
    assert_eq!(env.balance(&m), before + FEE + ticket_rent);
    assert_eq!(env.balance(&vault), rent + 2 * FEE);
    assert!(!env.account_exists(&ticket));
    assert_eq!(env.get_event(&s.event).tickets_sold, 2);
}

#[test]
fn join_on_cancelled_event_rejected() {
    let (mut env, s) = scenario(1);
    assert_ok(&cancel(&mut env, &s));
    let late = env.funded(2);
    let res = env.send(
        &[join_event_ix(
            &late.pubkey(),
            &s.event,
            &Pubkey::new_unique(),
        )],
        &late,
        &[],
    );
    assert_program_err(&res, EventPoolError::EventNotOpen);
}

#[test]
fn double_refund_rejected() {
    let (mut env, s) = scenario(2);
    assert_ok(&cancel(&mut env, &s));
    assert_ok(&refund(&mut env, &s, 0));
    let m = s.members[0].pubkey();
    let b = env.balance(&m);
    assert!(refund(&mut env, &s, 0).is_err());
    assert_eq!(env.balance(&m), b);
    assert_eq!(env.get_event(&s.event).tickets_sold, 1);
}

#[test]
fn refund_when_not_cancelled_rejected() {
    let (mut env, s) = scenario(1);
    assert_program_err(&refund(&mut env, &s, 0), EventPoolError::EventNotCancelled);
    // also rejected once Ended
    env.warp_to(env.get_event(&s.event).end_ts);
    assert_ok(&env.send(
        &[end_event_ix(&s.host.pubkey(), &s.event)],
        &s.payer,
        &[&s.host],
    ));
    assert_program_err(&refund(&mut env, &s, 0), EventPoolError::EventNotCancelled);
}

#[test]
fn refund_without_ticket_rejected() {
    let (mut env, s) = scenario(1);
    assert_ok(&cancel(&mut env, &s));
    let stranger = env.funded(1);
    let res = env.send(&[refund_ix(&stranger.pubkey(), &s.event)], &stranger, &[]);
    assert!(res.is_err());
}

#[test]
fn refund_requires_member_signature() {
    let (mut env, s) = scenario(1);
    assert_ok(&cancel(&mut env, &s));
    let res = env.send_missing_signer(&[refund_ix(&s.members[0].pubkey(), &s.event)], &s.payer);
    assert!(res.is_err());
}

#[test]
fn vault_equals_rent_min_after_all_refunds() {
    let (mut env, s) = scenario(5);
    let (vault, _) = vault_pda(&s.event);
    assert_ok(&cancel(&mut env, &s));
    for i in 0..5 {
        let m = s.members[i].pubkey();
        let b = env.balance(&m);
        assert_ok(&refund(&mut env, &s, i));
        assert!(env.balance(&m) >= b + FEE);
    }
    assert_eq!(env.balance(&vault), env.rent_min());
    assert_eq!(env.get_event(&s.event).tickets_sold, 0);
}

#[test]
fn cancelled_event_cannot_end_or_pay_out() {
    let (mut env, s) = scenario(2);
    assert_ok(&cancel(&mut env, &s));
    env.warp_to(env.get_event(&s.event).end_ts);
    let res = env.send(
        &[end_event_ix(&s.host.pubkey(), &s.event)],
        &s.payer,
        &[&s.host],
    );
    assert_program_err(&res, EventPoolError::EventNotOpen);
    let res = env.send(
        &[withdraw_host_ix(&s.host.pubkey(), &s.event)],
        &s.payer,
        &[&s.host],
    );
    assert_program_err(&res, EventPoolError::EventNotEnded);
}
