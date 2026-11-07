use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SponsorshipStatus {
    Proposed,
    Approved,
    Delivered,
    Paid,
    Rejected,
}

/// PDA: `[b"sponsor", event, vendor]` where `vendor` is the vendor authority wallet.
#[account]
#[derive(InitSpace)]
pub struct Sponsorship {
    pub event: Pubkey,
    pub vendor: Pubkey,
    pub amount: u64,
    pub status: SponsorshipStatus,
    pub offer_hash: [u8; 32],
    pub bump: u8,
}
