//! Test-only helpers that fabricate joined / checked-in state by writing account data directly,
//! so payout/refund tests do not depend on `join_event` / `check_in`. Layout matches the program.
#![allow(dead_code)]

use anchor_lang::AccountSerialize;
use solana_sdk::{account::Account, pubkey::Pubkey};

use super::common::*;
use crate::state::{Event, Ticket};
use crate::ID as PROGRAM_ID;

fn write_event(env: &mut TestEnv, key: &Pubkey, event: &Event) {
    let mut acc = env.svm.get_account(key).expect("event account missing");
    let mut data = Vec::new();
    event.try_serialize(&mut data).unwrap();
    acc.data = data;
    env.svm.set_account(*key, acc).unwrap();
}

/// Fabricate a joined ticket for `member`: creates the Ticket account, funds the vault with one
/// entry fee and bumps `tickets_sold`. Returns the Ticket PDA.
pub fn fake_join(env: &mut TestEnv, event_key: &Pubkey, member: &Pubkey) -> Pubkey {
    let (ticket_key, bump) = ticket_pda(event_key, member);
    let ticket = Ticket {
        event: *event_key,
        member: *member,
        ticket_key: Pubkey::new_unique(),
        checked_in: false,
        checked_in_at: 0,
        claimed: false,
        bump,
    };
    let mut data = Vec::new();
    ticket.try_serialize(&mut data).unwrap();
    let lamports = env.svm.minimum_balance_for_rent_exemption(data.len());
    env.svm
        .set_account(
            ticket_key,
            Account {
                lamports,
                data,
                owner: PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let mut event = env.get_event(event_key);
    let (vault, _) = vault_pda(event_key);
    let mut vacc = env.svm.get_account(&vault).expect("vault missing");
    vacc.lamports += event.entry_fee;
    env.svm.set_account(vault, vacc).unwrap();
    event.tickets_sold += 1;
    write_event(env, event_key, &event);
    ticket_key
}

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

    let mut event = env.get_event(event_key);
    event.checked_in += 1;
    write_event(env, event_key, &event);
}
