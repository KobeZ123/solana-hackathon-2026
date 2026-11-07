use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, Sponsorship, SponsorshipStatus};

#[derive(Accounts)]
pub struct RejectSponsorship<'info> {
    pub host: Signer<'info>,
    #[account(
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
        constraint = event.host == host.key() @ EventPoolError::NotHost,
    )]
    pub event: Account<'info, Event>,
    #[account(
        mut,
        seeds = [SPONSOR_SEED, event.key().as_ref(), sponsorship.vendor.as_ref()],
        bump = sponsorship.bump,
    )]
    pub sponsorship: Account<'info, Sponsorship>,
}

pub fn handler(ctx: Context<RejectSponsorship>) -> Result<()> {
    let s = &mut ctx.accounts.sponsorship;
    require!(
        s.status == SponsorshipStatus::Proposed,
        EventPoolError::InvalidSponsorshipStatus
    );
    s.status = SponsorshipStatus::Rejected;
    Ok(())
}
