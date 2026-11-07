//! T40: register_vendor, propose_sponsorship, approve_sponsorship, reject_sponsorship.
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};

use super::common::*;
use super::sponsor_helpers::*;
use crate::errors::EventPoolError;
use crate::state::SponsorshipStatus;

/// Event with `joined` members at 30% payout (host cap = 70% of pool).
fn setup(joined: usize) -> (TestEnv, Keypair, Pubkey, Keypair) {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_default_event(&mut env, &host);
    for _ in 0..joined {
        let m = env.funded(2);
        join_default(&mut env, &m, &event);
    }
    let vendor = env.funded(2);
    register_vendor_default(&mut env, &vendor);
    (env, host, event, vendor)
}

#[test]
fn register_vendor_creates_profile_and_rejects_duplicate() {
    let mut env = TestEnv::new();
    let vendor = env.funded(2);
    let key = Pubkey::new_unique();
    assert_ok(&env.send(&[register_vendor_ix(&vendor.pubkey(), &key)], &vendor, &[]));
    let p = env.get_vendor(&vendor.pubkey());
    assert_eq!(p.authority, vendor.pubkey());
    assert_eq!(p.vendor_key, key);
    assert_eq!(p.bump, vendor_pda(&vendor.pubkey()).1);
    let again = env.send(&[register_vendor_ix(&vendor.pubkey(), &key)], &vendor, &[]);
    assert!(again.is_err());
}

#[test]
fn propose_creates_sponsorship() {
    let (mut env, _host, event, vendor) = setup(0);
    let ix = propose_sponsorship_ix(&vendor.pubkey(), &event, 5_000_000, [3u8; 32]);
    assert_ok(&env.send(&[ix], &vendor, &[]));
    let s = env.get_sponsorship(&event, &vendor.pubkey());
    assert_eq!(s.event, event);
    assert_eq!(s.vendor, vendor.pubkey());
    assert_eq!(s.amount, 5_000_000);
    assert_eq!(s.status, SponsorshipStatus::Proposed);
    assert_eq!(s.offer_hash, [3u8; 32]);
    assert_eq!(env.get_event(&event).approved_sponsor_total, 0);
}

#[test]
fn propose_requires_registered_vendor() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_default_event(&mut env, &host);
    let stranger = env.funded(2);
    let ix = propose_sponsorship_ix(&stranger.pubkey(), &event, 1, [0u8; 32]);
    assert!(env.send(&[ix], &stranger, &[]).is_err());
}

#[test]
fn propose_requires_open_event() {
    let (mut env, host, event, vendor) = setup(0);
    // Cancelled
    assert_ok(&env.send(&[cancel_event_ix(&host.pubkey(), &event)], &host, &[]));
    let ix = propose_sponsorship_ix(&vendor.pubkey(), &event, 1, [0u8; 32]);
    assert_program_err(&env.send(&[ix], &vendor, &[]), EventPoolError::EventNotOpen);

    // Ended
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_default_event(&mut env, &host);
    let vendor = env.funded(2);
    register_vendor_default(&mut env, &vendor);
    env.warp_to(env.get_event(&event).end_ts);
    assert_ok(&env.send(&[end_event_ix(&host.pubkey(), &event)], &host, &[]));
    let ix = propose_sponsorship_ix(&vendor.pubkey(), &event, 1, [0u8; 32]);
    assert_program_err(&env.send(&[ix], &vendor, &[]), EventPoolError::EventNotOpen);
}

#[test]
fn propose_twice_for_same_event_fails() {
    let (mut env, _host, event, vendor) = setup(0);
    propose(&mut env, &vendor, &event, 1_000);
    let ix = propose_sponsorship_ix(&vendor.pubkey(), &event, 2_000, [1u8; 32]);
    assert!(env.send(&[ix], &vendor, &[]).is_err());
}

#[test]
fn approve_reserves_amount() {
    let (mut env, host, event, vendor) = setup(3); // pool 300M, cap 210M
    propose(&mut env, &vendor, &event, 50_000_000);
    approve(&mut env, &host, &event, &vendor.pubkey());
    assert_eq!(
        env.get_sponsorship(&event, &vendor.pubkey()).status,
        SponsorshipStatus::Approved
    );
    assert_eq!(env.get_event(&event).approved_sponsor_total, 50_000_000);
}

#[test]
fn approve_budget_cap_exact_boundary() {
    // pool = 300M, payout 30% => cap 210M exactly.
    let (mut env, host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 210_000_001);
    let res = env.send(
        &[approve_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::SponsorshipBudgetExceeded);
    assert_eq!(env.get_event(&event).approved_sponsor_total, 0);

    let (mut env, host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 210_000_000);
    approve(&mut env, &host, &event, &vendor.pubkey());
    assert_eq!(env.get_event(&event).approved_sponsor_total, 210_000_000);
}

#[test]
fn approve_cap_is_cumulative_across_vendors() {
    let (mut env, host, event, v1) = setup(3);
    let v2 = env.funded(2);
    register_vendor_default(&mut env, &v2);
    propose(&mut env, &v1, &event, 150_000_000);
    propose(&mut env, &v2, &event, 70_000_000);
    approve(&mut env, &host, &event, &v1.pubkey());
    let res = env.send(
        &[approve_sponsorship_ix(&host.pubkey(), &event, &v2.pubkey())],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::SponsorshipBudgetExceeded);
    // Rejecting is still possible, and a later join grows the pool and the cap.
    let m = env.funded(2);
    join_default(&mut env, &m, &event); // pool 400M, cap 280M, total 150M + 70M = 220M ok
    approve(&mut env, &host, &event, &v2.pubkey());
    assert_eq!(env.get_event(&event).approved_sponsor_total, 220_000_000);
}

#[test]
fn approve_with_empty_pool_fails() {
    let (mut env, host, event, vendor) = setup(0);
    propose(&mut env, &vendor, &event, 1);
    let res = env.send(
        &[approve_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::SponsorshipBudgetExceeded);
}

#[test]
fn approve_with_full_payout_bps_fails() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let params = CreateEventParams {
        payout_bps: 10_000,
        ..Default::default()
    };
    let event = create_event_with(&mut env, &host, &params);
    let m = env.funded(2);
    join_default(&mut env, &m, &event);
    let vendor = env.funded(2);
    register_vendor_default(&mut env, &vendor);
    propose(&mut env, &vendor, &event, 1);
    let res = env.send(
        &[approve_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::SponsorshipBudgetExceeded);
}

#[test]
fn approve_requires_host() {
    let (mut env, _host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 1_000);
    let other = env.funded(2);
    let res = env.send(
        &[approve_sponsorship_ix(
            &other.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &other,
        &[],
    );
    assert_program_err(&res, EventPoolError::NotHost);
    // vendor cannot self-approve either
    let res = env.send(
        &[approve_sponsorship_ix(
            &vendor.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &vendor,
        &[],
    );
    assert_program_err(&res, EventPoolError::NotHost);
}

#[test]
fn approve_requires_signature() {
    let (mut env, host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 1_000);
    let payer = env.funded(1);
    let ix = approve_sponsorship_ix(&host.pubkey(), &event, &vendor.pubkey());
    assert!(env.send_missing_signer(&[ix], &payer).is_err());
}

#[test]
fn approve_only_from_proposed() {
    let (mut env, host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 1_000);
    approve(&mut env, &host, &event, &vendor.pubkey());
    let res = env.send(
        &[approve_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::InvalidSponsorshipStatus);
    assert_eq!(env.get_event(&event).approved_sponsor_total, 1_000);
}

#[test]
fn approve_requires_open_event() {
    let (mut env, host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 1_000);
    env.warp_to(env.get_event(&event).end_ts);
    assert_ok(&env.send(&[end_event_ix(&host.pubkey(), &event)], &host, &[]));
    let res = env.send(
        &[approve_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::EventNotOpen);

    // Cancelled
    let (mut env, host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 1_000);
    assert_ok(&env.send(&[cancel_event_ix(&host.pubkey(), &event)], &host, &[]));
    let res = env.send(
        &[approve_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::EventNotOpen);
}

#[test]
fn approve_with_sponsorship_of_other_event_is_rejected() {
    let (mut env, host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 1_000);
    let event2 = create_event_with(
        &mut env,
        &host,
        &CreateEventParams {
            event_id: 2,
            ..Default::default()
        },
    );
    // Sponsorship PDA of `event` passed with event2: seed check fails.
    let mut ix = approve_sponsorship_ix(&host.pubkey(), &event2, &vendor.pubkey());
    ix.accounts[3].pubkey = sponsor_pda(&event, &vendor.pubkey()).0;
    assert!(env.send(&[ix], &host, &[]).is_err());
}

#[test]
fn reject_marks_rejected_without_reserving() {
    let (mut env, host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 1_000);
    assert_ok(&env.send(
        &[reject_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    ));
    assert_eq!(
        env.get_sponsorship(&event, &vendor.pubkey()).status,
        SponsorshipStatus::Rejected
    );
    assert_eq!(env.get_event(&event).approved_sponsor_total, 0);
    // Rejected cannot be approved or rejected again.
    let res = env.send(
        &[approve_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::InvalidSponsorshipStatus);
    let res = env.send(
        &[reject_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::InvalidSponsorshipStatus);
}

#[test]
fn reject_requires_host_and_proposed() {
    let (mut env, host, event, vendor) = setup(3);
    propose(&mut env, &vendor, &event, 1_000);
    let res = env.send(
        &[reject_sponsorship_ix(
            &vendor.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &vendor,
        &[],
    );
    assert_program_err(&res, EventPoolError::NotHost);
    approve(&mut env, &host, &event, &vendor.pubkey());
    let res = env.send(
        &[reject_sponsorship_ix(
            &host.pubkey(),
            &event,
            &vendor.pubkey(),
        )],
        &host,
        &[],
    );
    assert_program_err(&res, EventPoolError::InvalidSponsorshipStatus);
}

#[test]
fn host_budget_always_covers_approved_total_at_end() {
    // Approve at the cap, then more joins grow the pool; at end_event host_budget >= total,
    // including for rounding-heavy configs. Nobody checks in, so budget includes the pool too.
    for (fee, bps) in [(1_000_003u64, 3333u16), (123_456_789, 1), (7_777_777, 9999)] {
        let mut env = TestEnv::new();
        let host = env.funded(10);
        let params = CreateEventParams {
            entry_fee: fee,
            payout_bps: bps,
            ..Default::default()
        };
        let event = create_event_with(&mut env, &host, &params);
        let m = env.funded(2);
        join_default(&mut env, &m, &event);
        let pool = fee;
        let cap = (pool as u128 * (10_000 - bps as u128) / 10_000) as u64;
        let vendor = env.funded(2);
        register_vendor_default(&mut env, &vendor);
        propose(&mut env, &vendor, &event, cap);
        approve(&mut env, &host, &event, &vendor.pubkey());
        let m2 = env.funded(2);
        join_default(&mut env, &m2, &event);
        env.warp_to(params.end_ts);
        assert_ok(&env.send(&[end_event_ix(&host.pubkey(), &event)], &host, &[]));
        let e = env.get_event(&event);
        assert!(e.host_budget >= e.approved_sponsor_total, "bps {bps}");
        assert_eq!(e.approved_sponsor_total, cap);
    }
}
