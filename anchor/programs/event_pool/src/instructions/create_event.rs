use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus};

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct CreateEvent<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(
        init,
        payer = host,
        space = 8 + Event::INIT_SPACE,
        seeds = [EVENT_SEED, host.key().as_ref(), &event_id.to_le_bytes()],
        bump,
    )]
    pub event: Account<'info, Event>,
    #[account(
        mut,
        seeds = [VAULT_SEED, event.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<CreateEvent>,
    event_id: u64,
    entry_fee: u64,
    capacity: u32,
    start_ts: i64,
    end_ts: i64,
    payout_bps: u16,
    metadata_hash: [u8; 32],
) -> Result<()> {
    require!(end_ts > start_ts, EventPoolError::InvalidTimeRange);
    require!(
        payout_bps <= MAX_PAYOUT_BPS,
        EventPoolError::InvalidPayoutBps
    );
    require!(capacity > 0, EventPoolError::InvalidCapacity);
    require!(entry_fee >= MIN_ENTRY_FEE, EventPoolError::FeeTooLow);

    let host = ctx.accounts.host.key();
    let event = &mut ctx.accounts.event;
    event.host = host;
    event.event_id = event_id;
    event.gate_authority = host;
    event.entry_fee = entry_fee;
    event.capacity = capacity;
    event.tickets_sold = 0;
    event.checked_in = 0;
    event.start_ts = start_ts;
    event.end_ts = end_ts;
    event.payout_bps = payout_bps;
    event.status = EventStatus::Open;
    event.attendee_pool = 0;
    event.host_budget = 0;
    event.host_withdrawn = false;
    event.metadata_hash = metadata_hash;
    event.approved_sponsor_total = 0;
    event.bump = ctx.bumps.event;
    event.vault_bump = ctx.bumps.vault;

    // Fund the vault with the rent-exempt minimum so later transfers are rent-valid.
    // This minimum is never distributed: pool = vault.lamports - rent_min.
    let rent_min = Rent::get()?.minimum_balance(0);
    transfer(
        CpiContext::new(
            System::id(),
            Transfer {
                from: ctx.accounts.host.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        rent_min,
    )?;

    Ok(())
}
