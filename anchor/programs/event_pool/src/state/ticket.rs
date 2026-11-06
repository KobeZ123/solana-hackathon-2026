use anchor_lang::prelude::*;

/// PDA: `[b"ticket", event, member]`
#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub event: Pubkey,
    pub member: Pubkey,
    pub ticket_key: Pubkey,
    pub checked_in: bool,
    pub checked_in_at: i64,
    pub claimed: bool,
    pub bump: u8,
}
