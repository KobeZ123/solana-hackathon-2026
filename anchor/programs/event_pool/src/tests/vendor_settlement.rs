//! T41: confirm_delivery, settle_vendor, release_sponsorship and pool solvency.
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};

use super::common::*;
use super::sponsor_helpers::*;
use crate::errors::EventPoolError;
use crate::state::{EventStatus, SponsorshipStatus};

struct World {
    env: TestEnv,
    host: Keypair,
    gate: Keypair,
    payer: Keypair, // pays fees so balance deltas are exact
    event: Pubkey,
    vault: Pubkey,
    members: Vec<Keypair>,
}

/// `joined` members at `fee`, `checked` of them checked in, separate gate key.
fn world(fee: u64, joined: usize, checked: usize, bps: u16) -> World {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let gate = env.funded(1);
    let payer = env.funded(10);
    let params = CreateEventParams {
        entry_fee: fee,
        payout_bps: bps,
        ..Default::default()
    };
    let event = create_event_with(&mut env, &host, &params);
    assert_ok(&env.send(
        &[set_gate_ix(&host.pubkey(), &event, &gate.pubkey())],
        &host,
        &[],
    ));
    let mut members = vec![];
    for _ in 0..joined {
        let m = env.funded(3);
        join_default(&mut env, &m, &event);
        members.push(m);
    }
    env.warp_to(params.start_ts);
    for m in members.iter().take(checked) {
        let ix = check_in_ix(&gate.pubkey(), &event, &m.pubkey());
        assert_ok(&env.send(&[ix], &payer, &[&gate]));
    }
    let vault = vault_pda(&event).0;
    World {
        env,
        host,
        gate,
        payer,
        event,
        vault,
        members,
    }
}

impl World {
    /// Register + propose + approve a vendor for `amount`; returns the vendor wallet.
    fn approved_vendor(&mut self, amount: u64) -> Keypair {
        let v = self.env.funded(1);
        register_vendor_default(&mut self.env, &v);
        propose(&mut self.env, &v, &self.event, amount);
        approve(&mut self.env, &self.host, &self.event, &v.pubkey());
        v
    }

    fn confirm(&mut self, v: &Pubkey) -> TxResult {
        let ix = confirm_delivery_ix(&self.gate.pubkey(), &self.event, v);
        self.env.send(&[ix], &self.payer, &[&self.gate])
    }

    fn settle(&mut self, v: &Pubkey) -> TxResult {
        let ix = settle_vendor_ix(&self.payer.pubkey(), &self.event, v);
        self.env.send(&[ix], &self.payer, &[])
    }

    fn release(&mut self, v: &Pubkey) -> TxResult {
        let ix = release_sponsorship_ix(&self.host.pubkey(), &self.event, v);
        self.env.send(&[ix], &self.payer, &[&self.host])
    }

    fn end(&mut self) {
        let end_ts = self.env.get_event(&self.event).end_ts;
        self.env.warp_to(end_ts);
        let ix = end_event_ix(&self.host.pubkey(), &self.event);
        assert_ok(&self.env.send(&[ix], &self.payer, &[&self.host]));
    }

    fn withdraw(&mut self) -> TxResult {
        let ix = withdraw_host_ix(&self.host.pubkey(), &self.event);
        self.env.send(&[ix], &self.payer, &[&self.host])
    }

    fn claim_all(&mut self, n: usize) -> u64 {
        let mut total = 0;
        for i in 0..n {
            let m = &self.members[i];
            let before = self.env.balance(&m.pubkey());
            let ix = claim_ix(&m.pubkey(), &self.event);
            assert_ok(&self.env.send(&[ix], &self.payer, &[m]));
            total += self.env.balance(&m.pubkey()) - before;
        }
        total
    }

    fn status(&self, v: &Pubkey) -> SponsorshipStatus {
        self.env.get_sponsorship(&self.event, v).status
    }
}

#[test]
fn full_vendor_path_exact_amounts_and_vault_ends_at_rent() {
    // pool 400M, 30% => attendee 120M (2 checked in => 60M each), host budget 280M.
    let mut w = world(100_000_000, 4, 2, 3000);
    let a = w.approved_vendor(100_000_000);
    let b = w.approved_vendor(50_000_000);
    let c = w.approved_vendor(30_000_000);
    assert_eq!(
        w.env.get_event(&w.event).approved_sponsor_total,
        180_000_000
    );

    // A delivered and settled during Ended; C delivered too; B never delivered.
    assert_ok(&w.confirm(&a.pubkey()));
    assert_eq!(w.status(&a.pubkey()), SponsorshipStatus::Delivered);
    w.end();
    assert_ok(&w.confirm(&c.pubkey()));

    let attendees = w.claim_all(2);
    assert_eq!(attendees, 120_000_000);

    let (va, vc) = (w.env.balance(&a.pubkey()), w.env.balance(&c.pubkey()));
    assert_ok(&w.settle(&a.pubkey()));
    assert_ok(&w.settle(&c.pubkey()));
    assert_eq!(w.env.balance(&a.pubkey()), va + 100_000_000);
    assert_eq!(w.env.balance(&c.pubkey()), vc + 30_000_000);
    assert_eq!(w.status(&a.pubkey()), SponsorshipStatus::Paid);

    // Host withdraws budget minus all reservations (incl. B's undelivered one).
    let hb = w.env.balance(&w.host.pubkey());
    assert_ok(&w.withdraw());
    assert_eq!(
        w.env.balance(&w.host.pubkey()),
        hb + 280_000_000 - 180_000_000
    );

    // B's reservation is still in the vault; release returns it to the host at once.
    assert_eq!(w.env.balance(&w.vault), w.env.rent_min() + 50_000_000);
    let hb = w.env.balance(&w.host.pubkey());
    assert_ok(&w.release(&b.pubkey()));
    assert_eq!(w.env.balance(&w.host.pubkey()), hb + 50_000_000);
    assert_eq!(
        w.env.get_event(&w.event).approved_sponsor_total,
        130_000_000
    );
    assert_eq!(w.env.balance(&w.vault), w.env.rent_min());
    assert_eq!(w.env.get_event(&w.event).status, EventStatus::Ended);
}

#[test]
fn release_before_withdraw_is_picked_up_by_withdraw_host() {
    let mut w = world(100_000_000, 4, 2, 3000);
    let b = w.approved_vendor(50_000_000);
    w.end();
    let hb = w.env.balance(&w.host.pubkey());
    assert_ok(&w.release(&b.pubkey())); // not yet withdrawn: no transfer
    assert_eq!(w.env.balance(&w.host.pubkey()), hb);
    assert_eq!(w.env.get_event(&w.event).approved_sponsor_total, 0);
    w.claim_all(2);
    assert_ok(&w.withdraw());
    assert_eq!(w.env.balance(&w.host.pubkey()), hb + 280_000_000);
    assert_eq!(w.env.balance(&w.vault), w.env.rent_min());
}

#[test]
fn vendor_settlement_after_host_withdraw_still_works() {
    let mut w = world(100_000_000, 4, 2, 3000);
    let a = w.approved_vendor(100_000_000);
    assert_ok(&w.confirm(&a.pubkey()));
    w.end();
    assert_ok(&w.withdraw());
    w.claim_all(2);
    assert_eq!(w.env.balance(&w.vault), w.env.rent_min() + 100_000_000);
    let va = w.env.balance(&a.pubkey());
    assert_ok(&w.settle(&a.pubkey()));
    assert_eq!(w.env.balance(&a.pubkey()), va + 100_000_000);
    assert_eq!(w.env.balance(&w.vault), w.env.rent_min());
}

#[test]
fn vendor_payout_never_reduces_attendee_pool() {
    // Vendors take the max the cap allows: the whole host budget.
    let mut w = world(100_000_000, 4, 3, 3000); // pool 400M, host cap 280M
    let a = w.approved_vendor(280_000_000);
    assert_ok(&w.confirm(&a.pubkey()));
    w.end();
    let e = w.env.get_event(&w.event);
    assert_eq!(e.attendee_pool, 120_000_000);
    assert!(e.host_budget >= e.approved_sponsor_total);
    // Settle first, then claims: attendees still receive their full share.
    assert_ok(&w.settle(&a.pubkey()));
    assert_eq!(w.claim_all(3), 120_000_000);
    assert_ok(&w.withdraw());
    assert_eq!(w.env.balance(&w.vault), w.env.rent_min());
}

#[test]
fn solvency_invariant_for_assorted_configs() {
    for (fee, joined, checked, bps, ratio_pct) in [
        (1_000_003u64, 5usize, 3usize, 3333u16, 100u64),
        (123_456_789, 4, 0, 1, 100),
        (7_777_777, 7, 7, 9999, 100),
        (100_000_000, 3, 2, 5000, 40),
        (999_999_937, 6, 4, 2500, 50),
        (5_000_001, 6, 6, 0, 100),
    ] {
        let mut w = world(fee, joined, checked, bps);
        let pool = fee * joined as u64;
        let cap = (pool as u128 * (10_000 - bps as u128) / 10_000) as u64;
        let amount = cap * ratio_pct / 100;
        let vendors = if amount > 0 {
            // two vendors splitting the reservation, the second left undelivered
            let first = amount / 2;
            let v1 = w.approved_vendor(first);
            let v2 = w.approved_vendor(amount - first);
            assert_ok(&w.confirm(&v1.pubkey()));
            Some((v1, v2, first))
        } else {
            None
        };
        w.end();
        let e = w.env.get_event(&w.event);
        assert!(e.host_budget >= e.approved_sponsor_total);

        let mut out = 0u64;
        if checked > 0 {
            out += w.claim_all(checked);
        }
        let hb = w.env.balance(&w.host.pubkey());
        assert_ok(&w.withdraw());
        out += w.env.balance(&w.host.pubkey()) - hb;
        if let Some((v1, v2, first)) = &vendors {
            let b1 = w.env.balance(&v1.pubkey());
            assert_ok(&w.settle(&v1.pubkey()));
            assert_eq!(w.env.balance(&v1.pubkey()) - b1, *first);
            out += *first;
            let hb = w.env.balance(&w.host.pubkey());
            assert_ok(&w.release(&v2.pubkey()));
            out += w.env.balance(&w.host.pubkey()) - hb;
        }
        assert!(out <= pool, "paid out {out} > pool {pool}");
        assert_eq!(out, pool, "fee {fee} bps {bps}");
        assert_eq!(w.env.balance(&w.vault), w.env.rent_min());
        // attendees got attendee_pool / n each
        if checked > 0 {
            assert_eq!(
                e.attendee_pool / checked as u64,
                (pool as u128 * bps as u128 / 10_000) as u64 / checked as u64
            );
        }
    }
}

// --- confirm_delivery -------------------------------------------------------------------------

#[test]
fn confirm_requires_gate_authority() {
    let mut w = world(100_000_000, 2, 0, 3000);
    let v = w.approved_vendor(1_000);
    // host is not the gate any more (gate was moved to a separate key)
    let ix = confirm_delivery_ix(&w.host.pubkey(), &w.event, &v.pubkey());
    let res = w.env.send(&[ix], &w.host, &[]);
    assert_program_err(&res, EventPoolError::NotGateAuthority);
    // the vendor cannot self-confirm either
    let ix = confirm_delivery_ix(&v.pubkey(), &w.event, &v.pubkey());
    assert_program_err(
        &w.env.send(&[ix], &v, &[]),
        EventPoolError::NotGateAuthority,
    );
    assert_eq!(w.status(&v.pubkey()), SponsorshipStatus::Approved);
}

#[test]
fn confirm_requires_signature() {
    let mut w = world(100_000_000, 2, 0, 3000);
    let v = w.approved_vendor(1_000);
    let ix = confirm_delivery_ix(&w.gate.pubkey(), &w.event, &v.pubkey());
    assert!(w.env.send_missing_signer(&[ix], &w.payer).is_err());
}

#[test]
fn confirm_only_from_approved() {
    let mut w = world(100_000_000, 2, 0, 3000);
    // Proposed
    let v = w.env.funded(1);
    register_vendor_default(&mut w.env, &v);
    propose(&mut w.env, &v, &w.event, 1_000);
    assert_program_err(
        &w.confirm(&v.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
    // Rejected
    let r = w.env.funded(1);
    register_vendor_default(&mut w.env, &r);
    propose(&mut w.env, &r, &w.event, 1_000);
    let ix = reject_sponsorship_ix(&w.host.pubkey(), &w.event, &r.pubkey());
    assert_ok(&w.env.send(&[ix], &w.host, &[]));
    assert_program_err(
        &w.confirm(&r.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
    // Delivered twice
    let a = w.approved_vendor(1_000);
    assert_ok(&w.confirm(&a.pubkey()));
    assert_program_err(
        &w.confirm(&a.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
    // Paid
    w.end();
    assert_ok(&w.settle(&a.pubkey()));
    assert_program_err(
        &w.confirm(&a.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
}

#[test]
fn confirm_allowed_open_and_ended_but_not_cancelled() {
    let mut w = world(100_000_000, 2, 0, 3000);
    let a = w.approved_vendor(1_000);
    let b = w.approved_vendor(1_000);
    assert_ok(&w.confirm(&a.pubkey())); // Open
    w.end();
    assert_ok(&w.confirm(&b.pubkey())); // Ended

    // Cancelled (needs a fresh event before start)
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let event = create_default_event(&mut env, &host);
    let m = env.funded(2);
    join_default(&mut env, &m, &event);
    let v = env.funded(1);
    register_vendor_default(&mut env, &v);
    propose(&mut env, &v, &event, 1_000);
    approve(&mut env, &host, &event, &v.pubkey());
    assert_ok(&env.send(&[cancel_event_ix(&host.pubkey(), &event)], &host, &[]));
    let ix = confirm_delivery_ix(&host.pubkey(), &event, &v.pubkey());
    assert_program_err(&env.send(&[ix], &host, &[]), EventPoolError::EventNotOpen);
}

// --- settle_vendor ----------------------------------------------------------------------------

#[test]
fn settle_requires_ended_event() {
    let mut w = world(100_000_000, 2, 0, 3000);
    let a = w.approved_vendor(1_000_000);
    assert_ok(&w.confirm(&a.pubkey()));
    // Still Open: refused, so the pool is never drained before end_event / cancel.
    assert_program_err(&w.settle(&a.pubkey()), EventPoolError::EventNotEnded);
    assert_eq!(w.status(&a.pubkey()), SponsorshipStatus::Delivered);
}

#[test]
fn settle_requires_delivered_and_is_single_use() {
    let mut w = world(100_000_000, 2, 0, 3000);
    let a = w.approved_vendor(1_000_000);
    w.end();
    assert_program_err(
        &w.settle(&a.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
    assert_ok(&w.confirm(&a.pubkey()));
    assert_ok(&w.settle(&a.pubkey()));
    assert_program_err(
        &w.settle(&a.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
}

#[test]
fn settle_pays_only_the_sponsorship_vendor() {
    let mut w = world(100_000_000, 2, 0, 3000);
    let a = w.approved_vendor(1_000_000);
    let thief = w.env.funded(1);
    assert_ok(&w.confirm(&a.pubkey()));
    w.end();
    let mut ix = settle_vendor_ix(&w.payer.pubkey(), &w.event, &a.pubkey());
    ix.accounts[3].pubkey = thief.pubkey();
    assert_program_err(&w.env.send(&[ix], &w.payer, &[]), EventPoolError::NotVendor);
}

#[test]
fn settle_can_be_signed_by_anyone_including_vendor() {
    let mut w = world(100_000_000, 2, 0, 3000);
    let a = w.approved_vendor(1_000_000);
    assert_ok(&w.confirm(&a.pubkey()));
    w.end();
    let ix = settle_vendor_ix(&a.pubkey(), &w.event, &a.pubkey());
    assert_ok(&w.env.send(&[ix], &a, &[]));
    assert_eq!(w.status(&a.pubkey()), SponsorshipStatus::Paid);
}

// --- release_sponsorship ----------------------------------------------------------------------

#[test]
fn release_only_after_end_only_host_only_approved() {
    let mut w = world(100_000_000, 2, 0, 3000);
    let a = w.approved_vendor(1_000_000);
    let b = w.approved_vendor(1_000_000);
    assert_program_err(&w.release(&a.pubkey()), EventPoolError::EventNotEnded);
    assert_ok(&w.confirm(&b.pubkey()));
    w.end();

    // non-host
    let ix = release_sponsorship_ix(&a.pubkey(), &w.event, &a.pubkey());
    assert_program_err(&w.env.send(&[ix], &a, &[]), EventPoolError::NotHost);
    // delivered one cannot be released (the vendor earned it)
    assert_program_err(
        &w.release(&b.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
    // approved can, once
    assert_ok(&w.release(&a.pubkey()));
    assert_eq!(w.env.get_event(&w.event).approved_sponsor_total, 1_000_000);
    assert_program_err(
        &w.release(&a.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
    // released one cannot be delivered or settled afterwards
    assert_program_err(
        &w.confirm(&a.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
    assert_program_err(
        &w.settle(&a.pubkey()),
        EventPoolError::InvalidSponsorshipStatus,
    );
}

#[test]
fn release_requires_signature() {
    let mut w = world(100_000_000, 2, 0, 3000);
    let a = w.approved_vendor(1_000_000);
    w.end();
    let ix = release_sponsorship_ix(&w.host.pubkey(), &w.event, &a.pubkey());
    assert!(w.env.send_missing_signer(&[ix], &w.payer).is_err());
}

// --- cancelled events -------------------------------------------------------------------------

#[test]
fn cancelled_event_with_approved_sponsorship_refunds_everyone_and_pays_no_vendor() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let payer = env.funded(10);
    let fee = 100_000_000;
    let event = create_default_event(&mut env, &host);
    let vault = vault_pda(&event).0;
    let mut members = vec![];
    for _ in 0..4 {
        let m = env.funded(2);
        join_default(&mut env, &m, &event);
        members.push(m);
    }
    let v = env.funded(1);
    register_vendor_default(&mut env, &v);
    propose(&mut env, &v, &event, 200_000_000);
    approve(&mut env, &host, &event, &v.pubkey());
    // Delivered before the cancel (gate = host by default), still Open.
    let ix = confirm_delivery_ix(&host.pubkey(), &event, &v.pubkey());
    assert_ok(&env.send(&[ix], &host, &[]));
    // Cannot be paid while Open ...
    let ix = settle_vendor_ix(&payer.pubkey(), &event, &v.pubkey());
    assert_program_err(&env.send(&[ix], &payer, &[]), EventPoolError::EventNotEnded);

    assert_ok(&env.send(&[cancel_event_ix(&host.pubkey(), &event)], &host, &[]));
    // ... nor once Cancelled.
    let ix = settle_vendor_ix(&payer.pubkey(), &event, &v.pubkey());
    assert_program_err(&env.send(&[ix], &payer, &[]), EventPoolError::EventNotEnded);
    // release is Ended-only too.
    let ix = release_sponsorship_ix(&host.pubkey(), &event, &v.pubkey());
    assert_program_err(&env.send(&[ix], &host, &[]), EventPoolError::EventNotEnded);

    for m in &members {
        let before = env.balance(&m.pubkey());
        assert_ok(&env.send(&[refund_ix(&m.pubkey(), &event)], &payer, &[m]));
        assert!(env.balance(&m.pubkey()) >= before + fee);
    }
    assert_eq!(env.balance(&vault), env.rent_min());
    assert_eq!(env.get_event(&event).status, EventStatus::Cancelled);
    assert_eq!(env.get_event(&event).tickets_sold, 0);
}

// --- lifecycle edge: pool grows after approval -------------------------------------------------

#[test]
fn cap_grows_with_joins_and_host_budget_still_covers_total() {
    let mut w = world(100_000_000, 1, 0, 3000); // pool 100M, cap 70M
    let a = w.approved_vendor(70_000_000);
    // Another 70M does not fit yet
    let b = w.env.funded(1);
    register_vendor_default(&mut w.env, &b);
    propose(&mut w.env, &b, &w.event, 70_000_000);
    let ix = approve_sponsorship_ix(&w.host.pubkey(), &w.event, &b.pubkey());
    assert_program_err(
        &w.env.send(&[ix], &w.host, &[]),
        EventPoolError::SponsorshipBudgetExceeded,
    );
    // Two more joins: pool 300M, cap 210M, so 140M total fits
    for _ in 0..2 {
        let m = w.env.funded(2);
        join_default(&mut w.env, &m, &w.event);
    }
    approve(&mut w.env, &w.host, &w.event, &b.pubkey());
    assert_ok(&w.confirm(&a.pubkey()));
    assert_ok(&w.confirm(&b.pubkey()));
    w.end();
    let e = w.env.get_event(&w.event);
    assert_eq!(e.approved_sponsor_total, 140_000_000);
    assert_eq!(e.host_budget, 300_000_000); // nobody checked in: host gets the attendee share
    assert_ok(&w.settle(&a.pubkey()));
    assert_ok(&w.settle(&b.pubkey()));
    assert_ok(&w.withdraw());
    assert_eq!(w.env.balance(&w.vault), w.env.rent_min());
}
