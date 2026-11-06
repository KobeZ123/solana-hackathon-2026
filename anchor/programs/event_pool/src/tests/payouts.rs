//! T13: end_event, claim, withdraw_host.
//!
//! Members join via the real `join_event`; check-ins are fabricated via `support_state` until
//! `check_in` (T12) merges (see PR notes).
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};

use super::common::*;
use super::support_state::*;
use crate::errors::EventPoolError;
use crate::state::EventStatus;

struct Scenario {
    host: Keypair,
    payer: Keypair, // pays tx fees so balance deltas are exact
    members: Vec<Keypair>,
    event: Pubkey,
}

fn scenario(fee: u64, joined: usize, checked_in: usize, payout_bps: u16) -> (TestEnv, Scenario) {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let payer = env.funded(10);
    let params = CreateEventParams {
        entry_fee: fee,
        payout_bps,
        ..Default::default()
    };
    let event = create_event_with(&mut env, &host, &params);
    let mut members = vec![];
    for i in 0..joined {
        let m = env.funded(3);
        join_default(&mut env, &m, &event);
        if i < checked_in {
            fake_check_in(&mut env, &event, &m.pubkey());
        }
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

fn end(env: &mut TestEnv, s: &Scenario) {
    env.warp_to(env.get_event(&s.event).end_ts);
    assert_ok(&env.send(
        &[end_event_ix(&s.host.pubkey(), &s.event)],
        &s.payer,
        &[&s.host],
    ));
}

fn claim(env: &mut TestEnv, s: &Scenario, i: usize) -> TxResult {
    let m = &s.members[i];
    env.send(&[claim_ix(&m.pubkey(), &s.event)], &s.payer, &[m])
}

fn withdraw(env: &mut TestEnv, s: &Scenario) -> TxResult {
    env.send(
        &[withdraw_host_ix(&s.host.pubkey(), &s.event)],
        &s.payer,
        &[&s.host],
    )
}

#[test]
fn full_lifecycle_exact_amounts() {
    let fee = 100_000_000;
    let (mut env, s) = scenario(fee, 3, 2, 3000);
    let (vault, _) = vault_pda(&s.event);
    let rent = env.rent_min();
    assert_eq!(env.balance(&vault), rent + 3 * fee);

    end(&mut env, &s);
    let e = env.get_event(&s.event);
    assert_eq!(e.status, EventStatus::Ended);
    assert_eq!(e.attendee_pool, 90_000_000);
    assert_eq!(e.host_budget, 210_000_000);

    let before = env.balance(&s.members[0].pubkey());
    assert_ok(&claim(&mut env, &s, 0));
    assert_eq!(env.balance(&s.members[0].pubkey()), before + 45_000_000);
    assert!(
        env.get_ticket(&ticket_pda(&s.event, &s.members[0].pubkey()).0)
            .claimed
    );
    assert_ok(&claim(&mut env, &s, 1));

    let hb = env.balance(&s.host.pubkey());
    assert_ok(&withdraw(&mut env, &s));
    assert_eq!(env.balance(&s.host.pubkey()), hb + 210_000_000);
    assert!(env.get_event(&s.event).host_withdrawn);
    assert_eq!(env.balance(&vault), rent);
}

#[test]
fn dust_goes_to_host_and_vault_keeps_exactly_rent_min() {
    // pool = 300_000_030, attendee_pool = 90_000_009, share = 45_000_004, dust = 1.
    let fee = 100_000_010;
    let (mut env, s) = scenario(fee, 3, 2, 3000);
    let (vault, _) = vault_pda(&s.event);
    let rent = env.rent_min();
    let pool = 3 * fee;
    end(&mut env, &s);
    let e = env.get_event(&s.event);
    assert_eq!(e.attendee_pool, 90_000_009);
    assert_eq!(e.host_budget, pool - 90_000_009);

    let mut paid = 0u64;
    for i in 0..2 {
        let b = env.balance(&s.members[i].pubkey());
        assert_ok(&claim(&mut env, &s, i));
        let got = env.balance(&s.members[i].pubkey()) - b;
        assert_eq!(got, 45_000_004);
        paid += got;
    }
    let hb = env.balance(&s.host.pubkey());
    assert_ok(&withdraw(&mut env, &s));
    let host_got = env.balance(&s.host.pubkey()) - hb;
    assert_eq!(host_got, e.host_budget + 1);
    paid += host_got;
    assert!(paid <= pool);
    assert_eq!(paid, pool);
    assert_eq!(env.balance(&vault), rent);
}

#[test]
fn invariant_holds_for_assorted_configs() {
    for (fee, joined, checked, bps) in [
        (1_000_000u64, 1usize, 1usize, 10_000u16),
        (1_234_567, 7, 3, 3333),
        (999_999_937, 5, 5, 1),
        (5_000_001, 4, 0, 5000),
        (2_000_003, 6, 4, 0),
        (7_777_777, 9, 7, 10_000),
    ] {
        let (mut env, s) = scenario(fee, joined, checked, bps);
        let (vault, _) = vault_pda(&s.event);
        let rent = env.rent_min();
        let pool = joined as u64 * fee;
        end(&mut env, &s);
        let e = env.get_event(&s.event);
        assert_eq!(e.attendee_pool + e.host_budget, pool);
        let mut paid = 0;
        for i in 0..checked {
            let b = env.balance(&s.members[i].pubkey());
            assert_ok(&claim(&mut env, &s, i));
            paid += env.balance(&s.members[i].pubkey()) - b;
        }
        let hb = env.balance(&s.host.pubkey());
        assert_ok(&withdraw(&mut env, &s));
        paid += env.balance(&s.host.pubkey()) - hb;
        assert!(paid <= pool);
        assert_eq!(paid, pool, "cfg {fee} {joined} {checked} {bps}");
        assert_eq!(env.balance(&vault), rent);
    }
}

#[test]
fn zero_check_ins_rolls_pool_to_host() {
    let fee = 100_000_000;
    let (mut env, s) = scenario(fee, 3, 0, 3000);
    let (vault, _) = vault_pda(&s.event);
    let rent = env.rent_min();
    end(&mut env, &s);
    let e = env.get_event(&s.event);
    assert_eq!(e.attendee_pool, 0);
    assert_eq!(e.host_budget, 3 * fee);
    let hb = env.balance(&s.host.pubkey());
    assert_ok(&withdraw(&mut env, &s));
    assert_eq!(env.balance(&s.host.pubkey()), hb + 3 * fee);
    assert_eq!(env.balance(&vault), rent);
}

#[test]
fn no_tickets_end_and_withdraw_pay_zero() {
    let (mut env, s) = scenario(100_000_000, 0, 0, 3000);
    end(&mut env, &s);
    assert_ok(&withdraw(&mut env, &s));
    let (vault, _) = vault_pda(&s.event);
    assert_eq!(env.balance(&vault), env.rent_min());
}

#[test]
fn early_end_event_rejected() {
    let (mut env, s) = scenario(100_000_000, 2, 1, 3000);
    env.warp_to(env.get_event(&s.event).end_ts - 1);
    let res = env.send(
        &[end_event_ix(&s.host.pubkey(), &s.event)],
        &s.payer,
        &[&s.host],
    );
    assert_program_err(&res, EventPoolError::EventNotEnded);
    assert_eq!(env.get_event(&s.event).status, EventStatus::Open);
}

#[test]
fn end_event_twice_rejected() {
    let (mut env, s) = scenario(100_000_000, 2, 1, 3000);
    end(&mut env, &s);
    let res = env.send(
        &[end_event_ix(&s.host.pubkey(), &s.event)],
        &s.payer,
        &[&s.host],
    );
    assert_program_err(&res, EventPoolError::EventNotOpen);
}

#[test]
fn non_host_cannot_end_or_withdraw() {
    let (mut env, s) = scenario(100_000_000, 2, 1, 3000);
    let other = env.funded(5);
    env.warp_to(env.get_event(&s.event).end_ts);
    let res = env.send(&[end_event_ix(&other.pubkey(), &s.event)], &other, &[]);
    assert_program_err(&res, EventPoolError::NotHost);

    end(&mut env, &s);
    let res = env.send(&[withdraw_host_ix(&other.pubkey(), &s.event)], &other, &[]);
    assert_program_err(&res, EventPoolError::NotHost);
    assert!(!env.get_event(&s.event).host_withdrawn);
}

#[test]
fn missing_host_signature_rejected() {
    let (mut env, s) = scenario(100_000_000, 2, 1, 3000);
    env.warp_to(env.get_event(&s.event).end_ts);
    let res = env.send_missing_signer(&[end_event_ix(&s.host.pubkey(), &s.event)], &s.payer);
    assert!(res.is_err());
}

#[test]
fn claim_before_end_rejected() {
    let (mut env, s) = scenario(100_000_000, 2, 1, 3000);
    let res = claim(&mut env, &s, 0);
    assert_program_err(&res, EventPoolError::EventNotEnded);
}

#[test]
fn withdraw_before_end_rejected() {
    let (mut env, s) = scenario(100_000_000, 2, 1, 3000);
    assert_program_err(&withdraw(&mut env, &s), EventPoolError::EventNotEnded);
}

#[test]
fn double_claim_rejected() {
    let (mut env, s) = scenario(100_000_000, 3, 2, 3000);
    end(&mut env, &s);
    assert_ok(&claim(&mut env, &s, 0));
    let b = env.balance(&s.members[0].pubkey());
    assert_program_err(&claim(&mut env, &s, 0), EventPoolError::AlreadyClaimed);
    assert_eq!(env.balance(&s.members[0].pubkey()), b);
}

#[test]
fn claim_without_check_in_rejected() {
    let (mut env, s) = scenario(100_000_000, 3, 2, 3000);
    end(&mut env, &s);
    assert_program_err(&claim(&mut env, &s, 2), EventPoolError::NotCheckedIn);
}

#[test]
fn claim_by_non_member_has_no_ticket() {
    let (mut env, s) = scenario(100_000_000, 3, 2, 3000);
    end(&mut env, &s);
    let stranger = env.funded(1);
    let res = env.send(&[claim_ix(&stranger.pubkey(), &s.event)], &stranger, &[]);
    assert!(res.is_err());
}

#[test]
fn double_withdraw_rejected() {
    let (mut env, s) = scenario(100_000_000, 3, 2, 3000);
    end(&mut env, &s);
    assert_ok(&withdraw(&mut env, &s));
    assert_program_err(&withdraw(&mut env, &s), EventPoolError::AlreadyWithdrawn);
}

#[test]
fn withdraw_subtracts_approved_sponsor_total() {
    // approved_sponsor_total is reserved for stretch A; the host payout excludes it.
    let fee = 100_000_000;
    let (mut env, s) = scenario(fee, 3, 2, 3000);
    end(&mut env, &s);
    let mut e = env.get_event(&s.event);
    e.approved_sponsor_total = 10_000_000;
    {
        use anchor_lang::AccountSerialize;
        let mut acc = env.svm.get_account(&s.event).unwrap();
        let mut data = Vec::new();
        e.try_serialize(&mut data).unwrap();
        acc.data = data;
        env.svm.set_account(s.event, acc).unwrap();
    }
    let hb = env.balance(&s.host.pubkey());
    assert_ok(&withdraw(&mut env, &s));
    assert_eq!(env.balance(&s.host.pubkey()), hb + 200_000_000);
}
