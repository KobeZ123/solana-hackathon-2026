use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Ticket};

#[derive(Accounts)]
pub struct RotateTicketKey<'info> {
    pub member: Signer<'info>,
    #[account(
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
}

pub fn handler(ctx: Context<RotateTicketKey>, new_key: Pubkey) -> Result<()> {
    require!(
        ctx.accounts.event.status == EventStatus::Open,
        EventPoolError::EventNotOpen
    );
    let ticket = &mut ctx.accounts.ticket;
    require!(!ticket.checked_in, EventPoolError::AlreadyCheckedIn);
    ticket.ticket_key = new_key;
    Ok(())
}
