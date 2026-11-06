use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::*;
use crate::errors::EventPoolError;
use crate::state::{Event, EventStatus};

#[derive(Accounts)]
pub struct WithdrawHost<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [EVENT_SEED, event.host.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
        constraint = event.host == host.key() @ EventPoolError::NotHost,
    )]
    pub event: Account<'info, Event>,
    #[account(
        mut,
        seeds = [VAULT_SEED, event.key().as_ref()],
        bump = event.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WithdrawHost>) -> Result<()> {
    let event = &mut ctx.accounts.event;
    require!(
        event.status == EventStatus::Ended,
        EventPoolError::EventNotEnded
    );
    require!(!event.host_withdrawn, EventPoolError::AlreadyWithdrawn);

    // Integer-division remainder of the attendee pool goes to the host.
    let dust = if event.checked_in == 0 {
        0
    } else {
        let n = event.checked_in as u64;
        event
            .attendee_pool
            .checked_sub(
                (event.attendee_pool / n)
                    .checked_mul(n)
                    .ok_or(EventPoolError::MathOverflow)?,
            )
            .ok_or(EventPoolError::MathOverflow)?
    };
    let amount = event
        .host_budget
        .checked_sub(event.approved_sponsor_total)
        .ok_or(EventPoolError::MathOverflow)?
        .checked_add(dust)
        .ok_or(EventPoolError::MathOverflow)?;
    event.host_withdrawn = true;

    let event_key = event.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, event_key.as_ref(), &[event.vault_bump]];
    transfer(
        CpiContext::new_with_signer(
            System::id(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.host.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    Ok(())
}
