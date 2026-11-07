use anchor_lang::prelude::*;

/// PDA: `[b"vendor", authority]`
#[account]
#[derive(InitSpace)]
pub struct VendorProfile {
    pub authority: Pubkey,
    /// Ephemeral QR signing key (like a ticket key); verified client-side by the scanner.
    pub vendor_key: Pubkey,
    pub bump: u8,
}
