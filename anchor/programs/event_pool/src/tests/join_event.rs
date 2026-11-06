use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};

use super::common::*;
use crate::errors::EventPoolError;
use crate::state::EventStatus;

#[test]
fn join_happy_path() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let (vault, _) = vault_pda(&event);
    let fee = env.get_event(&event).entry_fee;
    let key = Pubkey::new_unique();

    let vault_before = env.balance(&vault);
    let member_before = env.balance(&member.pubkey());
    let ticket = join_event_with_key(&mut env, &member, &event, &key);

    assert_eq!(env.balance(&vault), vault_before + fee);
    // Member pays the fee plus ticket rent plus the tx fee (5000 per signature).
    let ticket_rent = env.balance(&ticket);
    assert_eq!(
        env.balance(&member.pubkey()),
        member_before - fee - ticket_rent - 5000
    );
    let t = env.get_ticket(&ticket);
    assert_eq!(t.event, event);
    assert_eq!(t.member, member.pubkey());
    assert_eq!(t.ticket_key, key);
    assert!(!t.checked_in && !t.claimed);
    assert_eq!(t.checked_in_at, 0);
    assert_eq!(t.bump, ticket_pda(&event, &member.pubkey()).1);
    assert_eq!(env.get_event(&event).tickets_sold, 1);

    let member2 = env.funded(5);
    join_default(&mut env, &member2, &event);
    assert_eq!(env.get_event(&event).tickets_sold, 2);
    assert_eq!(env.balance(&vault), vault_before + 2 * fee);
}

#[test]
fn double_join_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    join_default(&mut env, &member, &event);
    let res = env.send(
        &[join_event_ix(
            &member.pubkey(),
            &event,
            &Pubkey::new_unique(),
        )],
        &member,
        &[],
    );
    assert!(res.is_err());
    assert_eq!(env.get_event(&event).tickets_sold, 1);
}

#[test]
fn capacity_full() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_event_with(
        &mut env,
        &host,
        &CreateEventParams {
            capacity: 2,
            ..Default::default()
        },
    );
    for _ in 0..2 {
        let m = env.funded(5);
        join_default(&mut env, &m, &event);
    }
    let late = env.funded(5);
    let res = env.send(
        &[join_event_ix(&late.pubkey(), &event, &Pubkey::new_unique())],
        &late,
        &[],
    );
    assert_program_err(&res, EventPoolError::EventFull);
    assert_eq!(env.get_event(&event).tickets_sold, 2);
    assert!(!env.account_exists(&ticket_pda(&event, &late.pubkey()).0));
}

#[test]
fn join_allowed_after_start_before_end() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    env.warp_to(T0 + 4 * 3600);
    join_default(&mut env, &member, &event);
}

#[test]
fn rejected_at_or_after_end() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let end = env.get_event(&event).end_ts;
    for ts in [end, end + 100] {
        env.warp_to(ts);
        let res = env.send(
            &[join_event_ix(
                &member.pubkey(),
                &event,
                &Pubkey::new_unique(),
            )],
            &member,
            &[],
        );
        assert_program_err(&res, EventPoolError::EventEnded);
    }
    // One second before end still works.
    env.warp_to(end - 1);
    join_default(&mut env, &member, &event);
}

#[test]
fn rejected_when_not_open() {
    for status in [EventStatus::Ended, EventStatus::Cancelled] {
        let mut env = TestEnv::new();
        let host = env.funded(10);
        let member = env.funded(5);
        let event = create_default_event(&mut env, &host);
        mutate_event(&mut env, &event, |e| e.status = status);
        let res = env.send(
            &[join_event_ix(
                &member.pubkey(),
                &event,
                &Pubkey::new_unique(),
            )],
            &member,
            &[],
        );
        assert_program_err(&res, EventPoolError::EventNotOpen);
    }
}

#[test]
fn insufficient_funds() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_default_event(&mut env, &host);
    let (vault, _) = vault_pda(&event);
    // Enough for rent + tx fee but not the 0.1 SOL fee.
    let poor = Keypair::new();
    env.airdrop(&poor.pubkey(), 50_000_000);
    let vault_before = env.balance(&vault);
    let res = env.send(
        &[join_event_ix(&poor.pubkey(), &event, &Pubkey::new_unique())],
        &poor,
        &[],
    );
    assert!(res.is_err());
    assert_eq!(env.balance(&vault), vault_before);
    assert_eq!(env.get_event(&event).tickets_sold, 0);
    assert!(!env.account_exists(&ticket_pda(&event, &poor.pubkey()).0));
}

#[test]
fn member_must_sign() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let payer = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let ix = join_event_ix(&member.pubkey(), &event, &Pubkey::new_unique());
    assert!(env.send_missing_signer(&[ix], &payer).is_err());
    assert_eq!(env.get_event(&event).tickets_sold, 0);
}

// --- rotate_ticket_key ---

#[test]
fn rotate_happy_path() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let ticket = join_default(&mut env, &member, &event);

    let new_key = Pubkey::new_unique();
    assert_ok(&env.send(
        &[rotate_ticket_key_ix(&member.pubkey(), &event, &new_key)],
        &member,
        &[],
    ));
    assert_eq!(env.get_ticket(&ticket).ticket_key, new_key);
    // Rotating again works.
    let k2 = Pubkey::new_unique();
    assert_ok(&env.send(
        &[rotate_ticket_key_ix(&member.pubkey(), &event, &k2)],
        &member,
        &[],
    ));
    assert_eq!(env.get_ticket(&ticket).ticket_key, k2);
}

#[test]
fn rotate_wrong_signer() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let other = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let ticket = join_default(&mut env, &member, &event);
    let before = env.get_ticket(&ticket).ticket_key;

    // Other signs but points at member's ticket: seeds mismatch.
    let mut ix = rotate_ticket_key_ix(&other.pubkey(), &event, &Pubkey::new_unique());
    ix.accounts[2].pubkey = ticket;
    assert!(env.send(&[ix], &other, &[]).is_err());

    // Member named but not signing.
    let ix = rotate_ticket_key_ix(&member.pubkey(), &event, &Pubkey::new_unique());
    assert!(env.send_missing_signer(&[ix], &other).is_err());

    // Non-member without a ticket.
    let ix = rotate_ticket_key_ix(&other.pubkey(), &event, &Pubkey::new_unique());
    assert!(env.send(&[ix], &other, &[]).is_err());
    assert_eq!(env.get_ticket(&ticket).ticket_key, before);
}

#[test]
fn rotate_rejected_after_check_in() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    let ticket = join_default(&mut env, &member, &event);
    // check_in lands in T12; set the state directly here.
    mutate_ticket(&mut env, &ticket, |t| t.checked_in = true);
    let before = env.get_ticket(&ticket).ticket_key;
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
    assert_eq!(env.get_ticket(&ticket).ticket_key, before);
}

#[test]
fn rotate_rejected_when_not_open() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let member = env.funded(5);
    let event = create_default_event(&mut env, &host);
    join_default(&mut env, &member, &event);
    mutate_event(&mut env, &event, |e| e.status = EventStatus::Cancelled);
    let res = env.send(
        &[rotate_ticket_key_ix(
            &member.pubkey(),
            &event,
            &Pubkey::new_unique(),
        )],
        &member,
        &[],
    );
    assert_program_err(&res, EventPoolError::EventNotOpen);
}
