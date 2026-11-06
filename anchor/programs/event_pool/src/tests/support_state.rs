//! Test-only helper that fabricates a check-in by writing account data directly, so payout tests
//! do not depend on `check_in` (T12). Layout matches the program. Replace with the real
//! instruction once T12 is on main.
#![allow(dead_code)]

use anchor_lang::AccountSerialize;
use solana_sdk::pubkey::Pubkey;

use super::common::*;

/// Fabricate a check-in for `member` (ticket flag + `event.checked_in`).
pub fn fake_check_in(env: &mut TestEnv, event_key: &Pubkey, member: &Pubkey) {
    let (ticket_key, _) = ticket_pda(event_key, member);
    let mut ticket = env.get_ticket(&ticket_key);
    assert!(!ticket.checked_in);
    ticket.checked_in = true;
    ticket.checked_in_at = env.now();
    let mut acc = env.svm.get_account(&ticket_key).unwrap();
    let mut data = Vec::new();
    ticket.try_serialize(&mut data).unwrap();
    acc.data = data;
    env.svm.set_account(ticket_key, acc).unwrap();

    mutate_event(env, event_key, |e| e.checked_in += 1);
}
