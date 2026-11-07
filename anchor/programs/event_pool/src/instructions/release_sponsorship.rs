use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Sponsorship, SponsorshipStatus};

#[derive(Accounts)]
pub struct ReleaseSponsorship<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(
        mut,
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
    #[account(
        mut,
        seeds = [VAULT_SEED, event.key().as_ref()],
        bump = event.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Host recovers an Approved-but-undelivered reservation after the event ended. The status
/// becomes `Rejected` (there is no separate "released" variant). If the host already ran
/// `withdraw_host`, the freed amount is paid out immediately so nothing is stranded in the
/// vault; otherwise `withdraw_host` picks it up through the lower `approved_sponsor_total`.
pub fn handler(ctx: Context<ReleaseSponsorship>) -> Result<()> {
    let event = &mut ctx.accounts.event;
    let s = &mut ctx.accounts.sponsorship;
    require!(
        event.status == EventStatus::Ended,
        EventPoolError::EventNotEnded
    );
    require!(
        s.status == SponsorshipStatus::Approved,
        EventPoolError::InvalidSponsorshipStatus
    );
    event.approved_sponsor_total = event
        .approved_sponsor_total
        .checked_sub(s.amount)
        .ok_or(EventPoolError::MathOverflow)?;
    s.status = SponsorshipStatus::Rejected;

    if event.host_withdrawn && s.amount > 0 {
        let event_key = event.key();
        let seeds: &[&[u8]] = &[VAULT_SEED, event_key.as_ref(), &[event.vault_bump]];
        transfer(
            CpiContext::new_with_signer(
                System::id(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.host.to_account_info(),
                },
                &[seeds],
            ),
            s.amount,
        )?;
    }
    Ok(())
}
