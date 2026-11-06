use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus};

#[derive(Accounts)]
pub struct CancelEvent<'info> {
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
        constraint = event.host == host.key() @ EventPoolError::NotHost,
    )]
    pub event: Account<'info, Event>,
}

pub fn handler(ctx: Context<CancelEvent>) -> Result<()> {
    let event = &mut ctx.accounts.event;
    require!(
        event.status == EventStatus::Open,
        EventPoolError::EventNotOpen
    );
    require!(
        Clock::get()?.unix_timestamp < event.start_ts,
        EventPoolError::EventStarted
    );
    event.status = EventStatus::Cancelled;
    Ok(())
}
