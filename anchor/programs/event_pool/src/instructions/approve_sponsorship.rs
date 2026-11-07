use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Sponsorship, SponsorshipStatus};

#[derive(Accounts)]
pub struct ApproveSponsorship<'info> {
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
        constraint = event.host == host.key() @ EventPoolError::NotHost,
    )]
    pub event: Account<'info, Event>,
    #[account(
        seeds = [VAULT_SEED, event.key().as_ref()],
        bump = event.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [SPONSOR_SEED, event.key().as_ref(), sponsorship.vendor.as_ref()],
        bump = sponsorship.bump,
    )]
    pub sponsorship: Account<'info, Sponsorship>,
}

pub fn handler(ctx: Context<ApproveSponsorship>) -> Result<()> {
    let event = &mut ctx.accounts.event;
    let s = &mut ctx.accounts.sponsorship;
    // Approvals only while Open: after end_event the pool is frozen into host_budget, and a
    // cancelled event must never reserve money that belongs to refunds.
    require!(
        event.status == EventStatus::Open,
        EventPoolError::EventNotOpen
    );
    require!(
        s.status == SponsorshipStatus::Proposed,
        EventPoolError::InvalidSponsorshipStatus
    );

    let rent_min = Rent::get()?.minimum_balance(0);
    let pool = ctx
        .accounts
        .vault
        .lamports()
        .checked_sub(rent_min)
        .ok_or(EventPoolError::MathOverflow)?;
    // The pool can only grow while Open (joins), and host_budget at end_event is
    // pool - floor(pool * bps / 10000) >= floor(pool * (10000 - bps) / 10000), so a cap computed
    // now is always still covered by host_budget at end_event.
    let max_host_budget = u64::try_from(
        (pool as u128)
            .checked_mul((BPS_DENOMINATOR - event.payout_bps as u64) as u128)
            .ok_or(EventPoolError::MathOverflow)?
            / BPS_DENOMINATOR as u128,
    )
    .map_err(|_| EventPoolError::MathOverflow)?;
    let new_total = event
        .approved_sponsor_total
        .checked_add(s.amount)
        .ok_or(EventPoolError::MathOverflow)?;
    require!(
        new_total <= max_host_budget,
        EventPoolError::SponsorshipBudgetExceeded
    );
    event.approved_sponsor_total = new_total;
    s.status = SponsorshipStatus::Approved;
    Ok(())
}
