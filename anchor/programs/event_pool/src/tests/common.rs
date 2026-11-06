//! Shared LiteSVM test harness.
//!
//! Later tickets extend this file with *additive* helpers (new instruction builders next to the
//! existing ones) and put their tests in their own file registered in `tests/mod.rs`.
//!
//! The program binary is loaded at runtime from `anchor/target/deploy/event_pool.so`, so run
//! `anchor build --ignore-keys` (from `anchor/`) before `cargo test`.
#![allow(dead_code)]

use anchor_lang::{system_program, AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_sdk::{
    clock::Clock,
    instruction::{Instruction, InstructionError},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::{Transaction, TransactionError},
};

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, Ticket};
use crate::ID as PROGRAM_ID;

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
/// Initial Clock `unix_timestamp` of a fresh [`TestEnv`].
pub const T0: i64 = 1_700_000_000;

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

// ---------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------

pub struct TestEnv {
    pub svm: LiteSVM,
}

impl TestEnv {
    /// Fresh SVM with the program loaded and the clock at [`T0`].
    pub fn new() -> Self {
        let so = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/deploy/event_pool.so");
        let bytes = std::fs::read(&so).unwrap_or_else(|e| {
            panic!(
                "cannot read {}: {e}. Run `anchor build --ignore-keys` in anchor/ first",
                so.display()
            )
        });
        let mut svm = LiteSVM::new();
        svm.add_program(PROGRAM_ID, &bytes).unwrap();
        let mut env = Self { svm };
        env.warp_to(T0);
        env
    }

    /// Fresh keypair funded with `sol` SOL.
    pub fn funded(&mut self, sol: u64) -> Keypair {
        let kp = Keypair::new();
        self.airdrop(&kp.pubkey(), sol * LAMPORTS_PER_SOL);
        kp
    }

    pub fn airdrop(&mut self, to: &Pubkey, lamports: u64) {
        self.svm.airdrop(to, lamports).unwrap();
    }

    pub fn balance(&self, key: &Pubkey) -> u64 {
        self.svm.get_balance(key).unwrap_or(0)
    }

    pub fn rent_min(&self) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(0)
    }

    // --- clock ---------------------------------------------------------------------------

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    /// Set the Clock `unix_timestamp` to `ts`.
    pub fn warp_to(&mut self, ts: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = ts;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    /// Advance the Clock by `secs`.
    pub fn warp_by(&mut self, secs: i64) {
        let ts = self.now() + secs;
        self.warp_to(ts);
    }

    // --- transactions --------------------------------------------------------------------

    /// Sign with `payer` (+ `extra` signers) and send. Expires the blockhash first so that
    /// two identical transactions are never rejected as `AlreadyProcessed`.
    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> TxResult {
        self.svm.expire_blockhash();
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra);
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&payer.pubkey()),
            &signers,
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx)
    }

    /// Like [`send`] but signs with `payer` only, even if the instructions require other
    /// signers. Used to prove that a missing required signature is rejected on chain.
    pub fn send_missing_signer(&mut self, ixs: &[Instruction], payer: &Keypair) -> TxResult {
        self.svm.expire_blockhash();
        let msg = solana_sdk::message::Message::new(ixs, Some(&payer.pubkey()));
        let mut tx = Transaction::new_unsigned(msg);
        tx.partial_sign(&[payer], self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }

    // --- account readers -----------------------------------------------------------------

    pub fn get_event(&self, event: &Pubkey) -> Event {
        let acc = self.svm.get_account(event).expect("event account missing");
        Event::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn get_ticket(&self, ticket: &Pubkey) -> Ticket {
        let acc = self
            .svm
            .get_account(ticket)
            .expect("ticket account missing");
        Ticket::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn account_exists(&self, key: &Pubkey) -> bool {
        self.svm.get_account(key).is_some_and(|a| a.lamports > 0)
    }
}

// ---------------------------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------------------------

/// Extract the custom program error code of a failed transaction, if any.
pub fn custom_code(res: &TxResult) -> Option<u32> {
    match res {
        Err(FailedTransactionMetadata {
            err: TransactionError::InstructionError(_, InstructionError::Custom(code)),
            ..
        }) => Some(*code),
        _ => None,
    }
}

/// Assert that the transaction failed with the given program error.
pub fn assert_program_err(res: &TxResult, expected: EventPoolError) {
    let want: u32 = expected.into();
    match res {
        Ok(_) => panic!("expected {expected:?} ({want}) but the transaction succeeded"),
        Err(e) => assert_eq!(
            custom_code(res),
            Some(want),
            "expected {expected:?} ({want}), got {:?}\nlogs: {:#?}",
            e.err,
            e.meta.logs
        ),
    }
}

pub fn assert_ok(res: &TxResult) {
    if let Err(e) = res {
        panic!("transaction failed: {:?}\nlogs: {:#?}", e.err, e.meta.logs);
    }
}

// ---------------------------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------------------------

pub fn event_pda(host: &Pubkey, event_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[EVENT_SEED, host.as_ref(), &event_id.to_le_bytes()],
        &PROGRAM_ID,
    )
}

pub fn vault_pda(event: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED, event.as_ref()], &PROGRAM_ID)
}

pub fn ticket_pda(event: &Pubkey, member: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[TICKET_SEED, event.as_ref(), member.as_ref()], &PROGRAM_ID)
}

// ---------------------------------------------------------------------------------------------
// Instruction builders (one per instruction; add yours below)
// ---------------------------------------------------------------------------------------------

/// Arguments of `create_event` with sensible defaults relative to the clock at [`T0`].
#[derive(Clone, Debug)]
pub struct CreateEventParams {
    pub event_id: u64,
    pub entry_fee: u64,
    pub capacity: u32,
    pub start_ts: i64,
    pub end_ts: i64,
    pub payout_bps: u16,
    pub metadata_hash: [u8; 32],
}

impl Default for CreateEventParams {
    fn default() -> Self {
        Self {
            event_id: 1,
            entry_fee: 100_000_000, // 0.1 SOL
            capacity: 10,
            start_ts: T0 + 2 * 3600,
            end_ts: T0 + 6 * 3600,
            payout_bps: 3000,
            metadata_hash: [7u8; 32],
        }
    }
}

pub fn create_event_ix(host: &Pubkey, p: &CreateEventParams) -> Instruction {
    let (event, _) = event_pda(host, p.event_id);
    let (vault, _) = vault_pda(&event);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::CreateEvent {
            host: *host,
            event,
            vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: crate::instruction::CreateEvent {
            event_id: p.event_id,
            entry_fee: p.entry_fee,
            capacity: p.capacity,
            start_ts: p.start_ts,
            end_ts: p.end_ts,
            payout_bps: p.payout_bps,
            metadata_hash: p.metadata_hash,
        }
        .data(),
    }
}

pub fn set_gate_ix(host: &Pubkey, event: &Pubkey, gate: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::SetGate {
            host: *host,
            event: *event,
        }
        .to_account_metas(None),
        data: crate::instruction::SetGate { gate: *gate }.data(),
    }
}

// ---------------------------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------------------------

/// Create an event with default params hosted by `host`; returns the Event PDA.
pub fn create_default_event(env: &mut TestEnv, host: &Keypair) -> Pubkey {
    create_event_with(env, host, &CreateEventParams::default())
}

/// Create an event with `params` hosted by `host` (asserts success); returns the Event PDA.
pub fn create_event_with(env: &mut TestEnv, host: &Keypair, params: &CreateEventParams) -> Pubkey {
    let res = env.send(&[create_event_ix(&host.pubkey(), params)], host, &[]);
    assert_ok(&res);
    event_pda(&host.pubkey(), params.event_id).0
}

// --- T13/T14 instruction builders ---------------------------------------------------------

pub fn end_event_ix(host: &Pubkey, event: &Pubkey) -> Instruction {
    let (vault, _) = vault_pda(event);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::EndEvent {
            host: *host,
            event: *event,
            vault,
        }
        .to_account_metas(None),
        data: crate::instruction::EndEvent {}.data(),
    }
}

pub fn claim_ix(member: &Pubkey, event: &Pubkey) -> Instruction {
    let (vault, _) = vault_pda(event);
    let (ticket, _) = ticket_pda(event, member);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::Claim {
            member: *member,
            event: *event,
            ticket,
            vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: crate::instruction::Claim {}.data(),
    }
}

pub fn withdraw_host_ix(host: &Pubkey, event: &Pubkey) -> Instruction {
    let (vault, _) = vault_pda(event);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::WithdrawHost {
            host: *host,
            event: *event,
            vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: crate::instruction::WithdrawHost {}.data(),
    }
}
