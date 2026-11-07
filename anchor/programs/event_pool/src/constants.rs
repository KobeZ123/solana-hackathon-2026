use anchor_lang::prelude::*;

pub const EVENT_SEED: &[u8] = b"event";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TICKET_SEED: &[u8] = b"ticket";
pub const VENDOR_SEED: &[u8] = b"vendor";
pub const SPONSOR_SEED: &[u8] = b"sponsor";

/// Minimum entry fee in lamports.
pub const MIN_ENTRY_FEE: u64 = 1_000_000;
/// Check-in opens this many seconds before `start_ts`.
pub const CHECKIN_GRACE_SECS: i64 = 3600;
/// Basis-point denominator.
pub const BPS_DENOMINATOR: u64 = 10_000;
/// Maximum `payout_bps` (100%).
#[constant]
pub const MAX_PAYOUT_BPS: u16 = 10_000;
