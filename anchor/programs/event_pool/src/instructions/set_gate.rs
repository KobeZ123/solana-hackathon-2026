use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus};

#[derive(Accounts)]
pub struct SetGate<'info> {
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
        constraint = event.host == host.key() @ EventPoolError::NotHost,
    )]
    pub event: Account<'info, Event>,
}

pub fn handler(ctx: Context<SetGate>, gate: Pubkey) -> Result<()> {
    let event = &mut ctx.accounts.event;
    require!(
        event.status == EventStatus::Open,
        EventPoolError::EventNotOpen
    );
    event.gate_authority = gate;
    Ok(())
}
