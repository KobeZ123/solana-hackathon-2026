use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Ticket};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub member: Signer<'info>,
    #[account(
        mut,
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
    )]
    pub event: Account<'info, Event>,
    #[account(
        mut,
        seeds = [TICKET_SEED, event.key().as_ref(), member.key().as_ref()],
        bump = ticket.bump,
    )]
    pub ticket: Account<'info, Ticket>,
    #[account(
        mut,
        seeds = [VAULT_SEED, event.key().as_ref()],
        bump = event.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Claim>) -> Result<()> {
    let event = &ctx.accounts.event;
    let ticket = &mut ctx.accounts.ticket;
    require!(
        event.status == EventStatus::Ended,
        EventPoolError::EventNotEnded
    );
    require!(ticket.checked_in, EventPoolError::NotCheckedIn);
    require!(!ticket.claimed, EventPoolError::AlreadyClaimed);

    let share = event
        .attendee_pool
        .checked_div(event.checked_in as u64)
        .ok_or(EventPoolError::MathOverflow)?;
    ticket.claimed = true;

    let event_key = event.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, event_key.as_ref(), &[event.vault_bump]];
    transfer(
        CpiContext::new_with_signer(
            System::id(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.member.to_account_info(),
            },
            &[seeds],
        ),
        share,
    )?;
    Ok(())
}
