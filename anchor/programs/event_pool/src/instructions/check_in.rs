use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus, Ticket};

#[derive(Accounts)]
pub struct CheckIn<'info> {
    pub gate: Signer<'info>,
    #[account(
        mut,
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
        constraint = event.gate_authority == gate.key() @ EventPoolError::NotGateAuthority,
    )]
    pub event: Account<'info, Event>,
    /// CHECK: only used to derive the ticket PDA; the ticket seeds bind it to `ticket.member`.
    pub member: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [TICKET_SEED, event.key().as_ref(), member.key().as_ref()],
        bump = ticket.bump,
    )]
    pub ticket: Account<'info, Ticket>,
}

pub fn handler(ctx: Context<CheckIn>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let event = &mut ctx.accounts.event;
    require!(
        event.status == EventStatus::Open,
        EventPoolError::EventNotOpen
    );
    let opens_at = event
        .start_ts
        .checked_sub(CHECKIN_GRACE_SECS)
        .ok_or(EventPoolError::MathOverflow)?;
    require!(
        now >= opens_at && now <= event.end_ts,
        EventPoolError::CheckInNotOpen
    );

    let ticket = &mut ctx.accounts.ticket;
    require!(!ticket.checked_in, EventPoolError::AlreadyCheckedIn);
    ticket.checked_in = true;
    ticket.checked_in_at = now;
    event.checked_in = event
        .checked_in
        .checked_add(1)
        .ok_or(EventPoolError::MathOverflow)?;
    Ok(())
}
