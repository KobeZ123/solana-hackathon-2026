use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EventStatus {
    Open,
    Ended,
    Cancelled,
}

/// PDA: `[b"event", host, event_id.to_le_bytes()]`
#[account]
#[derive(InitSpace)]
pub struct Event {
    pub host: Pubkey,
    pub event_id: u64,
    pub gate_authority: Pubkey,
    pub entry_fee: u64,
    pub capacity: u32,
    pub tickets_sold: u32,
    pub checked_in: u32,
    pub start_ts: i64,
    pub end_ts: i64,
    pub payout_bps: u16,
    pub status: EventStatus,
    pub attendee_pool: u64,
    pub host_budget: u64,
    pub host_withdrawn: bool,
    pub metadata_hash: [u8; 32],
    pub approved_sponsor_total: u64,
    pub bump: u8,
    pub vault_bump: u8,
}
