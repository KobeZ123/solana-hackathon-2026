use anchor_lang::prelude::*;

/// Append only; never reorder (client error codes depend on the order).
#[error_code]
pub enum EventPoolError {
    #[msg("end_ts must be greater than start_ts")]
    InvalidTimeRange,
    #[msg("payout_bps must be at most 10000")]
    InvalidPayoutBps,
    #[msg("capacity must be greater than zero")]
    InvalidCapacity,
    #[msg("entry fee is below the minimum")]
    FeeTooLow,
    #[msg("event is not open")]
    EventNotOpen,
    #[msg("event is full")]
    EventFull,
    #[msg("event has ended")]
    EventEnded,
    #[msg("event has not ended yet")]
    EventNotEnded,
    #[msg("event is not cancelled")]
    EventNotCancelled,
    #[msg("event has already started")]
    EventStarted,
    #[msg("signer is not the event host")]
    NotHost,
    #[msg("signer is not the gate authority")]
    NotGateAuthority,
    #[msg("ticket already checked in")]
    AlreadyCheckedIn,
    #[msg("ticket is not checked in")]
    NotCheckedIn,
    #[msg("check-in is not open")]
    CheckInNotOpen,
    #[msg("already claimed")]
    AlreadyClaimed,
    #[msg("host budget already withdrawn")]
    AlreadyWithdrawn,
    #[msg("math overflow")]
    MathOverflow,
}
