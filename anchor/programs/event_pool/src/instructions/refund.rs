use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Ticket};

#[derive(Accounts)]
pub struct Refund<'info> {
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
        close = member,
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

pub fn handler(ctx: Context<Refund>) -> Result<()> {
    let event = &mut ctx.accounts.event;
    require!(
        event.status == EventStatus::Cancelled,
        EventPoolError::EventNotCancelled
    );
    event.tickets_sold = event
        .tickets_sold
        .checked_sub(1)
        .ok_or(EventPoolError::MathOverflow)?;

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
        event.entry_fee,
    )?;
    Ok(())
}
