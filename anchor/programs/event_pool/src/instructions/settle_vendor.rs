use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Sponsorship, SponsorshipStatus};

#[derive(Accounts)]
pub struct SettleVendor<'info> {
    /// Anyone may trigger settlement (pays the transaction fee only).
    pub payer: Signer<'info>,
    #[account(
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
    )]
    pub event: Account<'info, Event>,
    #[account(
        mut,
        seeds = [SPONSOR_SEED, event.key().as_ref(), sponsorship.vendor.as_ref()],
        bump = sponsorship.bump,
    )]
    pub sponsorship: Account<'info, Sponsorship>,
    /// CHECK: must equal `sponsorship.vendor`; only receives lamports.
    #[account(mut, constraint = vendor.key() == sponsorship.vendor @ EventPoolError::NotVendor)]
    pub vendor: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, event.key().as_ref()],
        bump = event.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SettleVendor>) -> Result<()> {
    let event = &ctx.accounts.event;
    // Only after end_event: while Open the pool is still being measured, and refunds on a
    // cancelled event must never be funded away. After Ended the amount is covered by the
    // reservation in `approved_sponsor_total`, which withdraw_host leaves in the vault.
    require!(
        event.status == EventStatus::Ended,
        EventPoolError::EventNotEnded
    );
    let s = &mut ctx.accounts.sponsorship;
    require!(
        s.status == SponsorshipStatus::Delivered,
        EventPoolError::InvalidSponsorshipStatus
    );
    s.status = SponsorshipStatus::Paid;

    let event_key = event.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, event_key.as_ref(), &[event.vault_bump]];
    transfer(
        CpiContext::new_with_signer(
            System::id(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.vendor.to_account_info(),
            },
            &[seeds],
        ),
        s.amount,
    )?;
    Ok(())
}
