use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Sponsorship, SponsorshipStatus, VendorProfile};

#[derive(Accounts)]
pub struct ProposeSponsorship<'info> {
    #[account(mut)]
    pub vendor: Signer<'info>,
    #[account(
        seeds = [VENDOR_SEED, vendor.key().as_ref()],
        bump = vendor_profile.bump,
    )]
    pub vendor_profile: Account<'info, VendorProfile>,
    #[account(
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
    )]
    pub event: Account<'info, Event>,
    #[account(
        init,
        payer = vendor,
        space = 8 + Sponsorship::INIT_SPACE,
        seeds = [SPONSOR_SEED, event.key().as_ref(), vendor.key().as_ref()],
        bump,
    )]
    pub sponsorship: Account<'info, Sponsorship>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ProposeSponsorship>, amount: u64, offer_hash: [u8; 32]) -> Result<()> {
    require!(
        ctx.accounts.event.status == EventStatus::Open,
        EventPoolError::EventNotOpen
    );
    let s = &mut ctx.accounts.sponsorship;
    s.event = ctx.accounts.event.key();
    s.vendor = ctx.accounts.vendor.key();
    s.amount = amount;
    s.status = SponsorshipStatus::Proposed;
    s.offer_hash = offer_hash;
    s.bump = ctx.bumps.sponsorship;
    Ok(())
}
