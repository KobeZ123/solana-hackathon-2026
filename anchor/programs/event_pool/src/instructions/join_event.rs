use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Ticket};

#[derive(Accounts)]
pub struct JoinEvent<'info> {
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
        seeds = [VAULT_SEED, event.key().as_ref()],
        bump = event.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        init,
        payer = member,
        space = 8 + Ticket::INIT_SPACE,
        seeds = [TICKET_SEED, event.key().as_ref(), member.key().as_ref()],
        bump,
    )]
    pub ticket: Account<'info, Ticket>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<JoinEvent>, ticket_key: Pubkey) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let event = &mut ctx.accounts.event;
    require!(
        event.status == EventStatus::Open,
        EventPoolError::EventNotOpen
    );
    require!(now < event.end_ts, EventPoolError::EventEnded);
    require!(
        event.tickets_sold < event.capacity,
        EventPoolError::EventFull
    );

    transfer(
        CpiContext::new(
            System::id(),
            Transfer {
                from: ctx.accounts.member.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        event.entry_fee,
    )?;

    event.tickets_sold = event
        .tickets_sold
        .checked_add(1)
        .ok_or(EventPoolError::MathOverflow)?;

    let ticket = &mut ctx.accounts.ticket;
    ticket.event = event.key();
    ticket.member = ctx.accounts.member.key();
    ticket.ticket_key = ticket_key;
    ticket.checked_in = false;
    ticket.checked_in_at = 0;
    ticket.claimed = false;
    ticket.bump = ctx.bumps.ticket;
    Ok(())
}
