use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Sponsorship, SponsorshipStatus};

#[derive(Accounts)]
pub struct ConfirmDelivery<'info> {
    pub gate: Signer<'info>,
    #[account(
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
        constraint = event.gate_authority == gate.key() @ EventPoolError::NotGateAuthority,
    )]
    pub event: Account<'info, Event>,
    /// The vendor QR signature is verified client-side against `VendorProfile.vendor_key`.
    #[account(
        mut,
        seeds = [SPONSOR_SEED, event.key().as_ref(), sponsorship.vendor.as_ref()],
        bump = sponsorship.bump,
    )]
    pub sponsorship: Account<'info, Sponsorship>,
}

pub fn handler(ctx: Context<ConfirmDelivery>) -> Result<()> {
    // Delivery happens during (or shortly after) the event; a cancelled event pays nobody.
    require!(
        ctx.accounts.event.status != EventStatus::Cancelled,
        EventPoolError::EventNotOpen
    );
    let s = &mut ctx.accounts.sponsorship;
    require!(
        s.status == SponsorshipStatus::Approved,
        EventPoolError::InvalidSponsorshipStatus
    );
    s.status = SponsorshipStatus::Delivered;
    Ok(())
}
