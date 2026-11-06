use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus};

#[derive(Accounts)]
pub struct EndEvent<'info> {
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
}

pub fn handler(ctx: Context<EndEvent>) -> Result<()> {
    let event = &mut ctx.accounts.event;
    require!(
        event.status == EventStatus::Open,
        EventPoolError::EventNotOpen
    );
    require!(
        Clock::get()?.unix_timestamp >= event.end_ts,
        EventPoolError::EventNotEnded
    );

    let rent_min = Rent::get()?.minimum_balance(0);
    let pool = ctx
        .accounts
        .vault
        .lamports()
        .checked_sub(rent_min)
        .ok_or(EventPoolError::MathOverflow)?;
    let mut attendee_pool = u64::try_from(
        (pool as u128)
            .checked_mul(event.payout_bps as u128)
            .ok_or(EventPoolError::MathOverflow)?
            / BPS_DENOMINATOR as u128,
    )
    .map_err(|_| EventPoolError::MathOverflow)?;
    let mut host_budget = pool
        .checked_sub(attendee_pool)
        .ok_or(EventPoolError::MathOverflow)?;
    if event.checked_in == 0 {
        host_budget = host_budget
            .checked_add(attendee_pool)
            .ok_or(EventPoolError::MathOverflow)?;
        attendee_pool = 0;
    }
    event.attendee_pool = attendee_pool;
    event.host_budget = host_budget;
    event.status = EventStatus::Ended;
    Ok(())
}
