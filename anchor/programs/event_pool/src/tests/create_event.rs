use solana_sdk::signer::Signer;

use super::common::*;
use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::EventStatus;

#[test]
fn happy_path_sets_all_fields_and_funds_vault() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let params = CreateEventParams::default();
    let host_before = env.balance(&host.pubkey());

    let event_key = create_event_with(&mut env, &host, &params);
    let (expected_pda, bump) = event_pda(&host.pubkey(), params.event_id);
    assert_eq!(event_key, expected_pda);

    let ev = env.get_event(&event_key);
    assert_eq!(ev.host, host.pubkey());
    assert_eq!(ev.event_id, params.event_id);
    assert_eq!(ev.gate_authority, host.pubkey());
    assert_eq!(ev.entry_fee, params.entry_fee);
    assert_eq!(ev.capacity, params.capacity);
    assert_eq!(ev.tickets_sold, 0);
    assert_eq!(ev.checked_in, 0);
    assert_eq!(ev.start_ts, params.start_ts);
    assert_eq!(ev.end_ts, params.end_ts);
    assert_eq!(ev.payout_bps, params.payout_bps);
    assert_eq!(ev.status, EventStatus::Open);
    assert_eq!(ev.attendee_pool, 0);
    assert_eq!(ev.host_budget, 0);
    assert!(!ev.host_withdrawn);
    assert_eq!(ev.metadata_hash, params.metadata_hash);
    assert_eq!(ev.approved_sponsor_total, 0);
    assert_eq!(ev.bump, bump);
    assert_eq!(ev.vault_bump, vault_pda(&event_key).1);

    // Vault is funded with exactly the rent minimum, system-owned, no data.
    let (vault, _) = vault_pda(&event_key);
    let vault_acc = env.svm.get_account(&vault).unwrap();
    assert_eq!(vault_acc.lamports, env.rent_min());
    assert_eq!(vault_acc.owner, anchor_lang::system_program::ID);
    assert!(vault_acc.data.is_empty());

    // Host paid event account rent + vault rent min (+ 5000 fee).
    let ev_acc = env.svm.get_account(&event_key).unwrap();
    assert_eq!(
        host_before - env.balance(&host.pubkey()),
        ev_acc.lamports + env.rent_min() + 5_000
    );
}

#[test]
fn boundary_values_are_accepted() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let params = CreateEventParams {
        entry_fee: MIN_ENTRY_FEE,
        capacity: 1,
        end_ts: T0 + 1 + 100,
        start_ts: T0 + 100,
        payout_bps: 10_000,
        ..Default::default()
    };
    let key = create_event_with(&mut env, &host, &params);
    assert_eq!(env.get_event(&key).payout_bps, 10_000);

    // payout_bps = 0 is also valid
    let params0 = CreateEventParams {
        event_id: 2,
        payout_bps: 0,
        ..Default::default()
    };
    create_event_with(&mut env, &host, &params0);
}

#[test]
fn distinct_event_ids_and_hosts_get_distinct_events() {
    let mut env = TestEnv::new();
    let h1 = env.funded(10);
    let h2 = env.funded(10);
    let a = create_event_with(&mut env, &h1, &CreateEventParams::default());
    let b = create_event_with(
        &mut env,
        &h1,
        &CreateEventParams {
            event_id: 2,
            ..Default::default()
        },
    );
    let c = create_event_with(&mut env, &h2, &CreateEventParams::default());
    assert_ne!(a, b);
    assert_ne!(a, c);
    assert_eq!(env.get_event(&c).host, h2.pubkey());
}

#[test]
fn duplicate_event_id_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    create_default_event(&mut env, &host);
    let res = env.send(
        &[create_event_ix(
            &host.pubkey(),
            &CreateEventParams::default(),
        )],
        &host,
        &[],
    );
    assert!(res.is_err(), "re-creating the same event must fail");
}

#[test]
fn end_equal_to_start_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let p = CreateEventParams {
        start_ts: T0 + 100,
        end_ts: T0 + 100,
        ..Default::default()
    };
    let res = env.send(&[create_event_ix(&host.pubkey(), &p)], &host, &[]);
    assert_program_err(&res, EventPoolError::InvalidTimeRange);
}

#[test]
fn end_before_start_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let p = CreateEventParams {
        start_ts: T0 + 100,
        end_ts: T0 + 50,
        ..Default::default()
    };
    let res = env.send(&[create_event_ix(&host.pubkey(), &p)], &host, &[]);
    assert_program_err(&res, EventPoolError::InvalidTimeRange);
}

#[test]
fn payout_bps_over_10000_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let p = CreateEventParams {
        payout_bps: 10_001,
        ..Default::default()
    };
    let res = env.send(&[create_event_ix(&host.pubkey(), &p)], &host, &[]);
    assert_program_err(&res, EventPoolError::InvalidPayoutBps);
}

#[test]
fn zero_capacity_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let p = CreateEventParams {
        capacity: 0,
        ..Default::default()
    };
    let res = env.send(&[create_event_ix(&host.pubkey(), &p)], &host, &[]);
    assert_program_err(&res, EventPoolError::InvalidCapacity);
}

#[test]
fn fee_below_minimum_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let p = CreateEventParams {
        entry_fee: MIN_ENTRY_FEE - 1,
        ..Default::default()
    };
    let res = env.send(&[create_event_ix(&host.pubkey(), &p)], &host, &[]);
    assert_program_err(&res, EventPoolError::FeeTooLow);
}

#[test]
fn failed_create_leaves_no_accounts() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let p = CreateEventParams {
        capacity: 0,
        ..Default::default()
    };
    let res = env.send(&[create_event_ix(&host.pubkey(), &p)], &host, &[]);
    assert!(res.is_err());
    let (event, _) = event_pda(&host.pubkey(), p.event_id);
    assert!(!env.account_exists(&event));
    assert!(!env.account_exists(&vault_pda(&event).0));
}

#[test]
fn host_must_sign() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let payer = env.funded(10);
    // Instruction names `host` as signer but only `payer` signs the transaction.
    let ix = create_event_ix(&host.pubkey(), &CreateEventParams::default());
    let res = env.send_missing_signer(&[ix], &payer);
    assert!(res.is_err());
}

#[test]
fn wrong_vault_pda_rejected() {
    let mut env = TestEnv::new();
    let host = env.funded(10);
    let mut ix = create_event_ix(&host.pubkey(), &CreateEventParams::default());
    ix.accounts[2].pubkey = solana_sdk::pubkey::Pubkey::new_unique();
    let res = env.send(&[ix], &host, &[]);
    assert!(res.is_err());
}
