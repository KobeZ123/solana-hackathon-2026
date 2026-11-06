use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

#[cfg(test)]
mod tests;

pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping");

// Thin dispatch only. Each later instruction is one new fn here + one module in instructions/.
#[program]
pub mod event_pool {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn create_event(
        ctx: Context<CreateEvent>,
        event_id: u64,
        entry_fee: u64,
        capacity: u32,
        start_ts: i64,
        end_ts: i64,
        payout_bps: u16,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        instructions::create_event::handler(
            ctx,
            event_id,
            entry_fee,
            capacity,
            start_ts,
            end_ts,
            payout_bps,
            metadata_hash,
        )
    }

    pub fn set_gate(ctx: Context<SetGate>, gate: Pubkey) -> Result<()> {
        instructions::set_gate::handler(ctx, gate)
    }

    pub fn end_event(ctx: Context<EndEvent>) -> Result<()> {
        instructions::end_event::handler(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handler(ctx)
    }

    pub fn withdraw_host(ctx: Context<WithdrawHost>) -> Result<()> {
        instructions::withdraw_host::handler(ctx)
    }

    pub fn join_event(ctx: Context<JoinEvent>, ticket_key: Pubkey) -> Result<()> {
        instructions::join_event::handler(ctx, ticket_key)
    }

    pub fn rotate_ticket_key(ctx: Context<RotateTicketKey>, new_key: Pubkey) -> Result<()> {
        instructions::rotate_ticket_key::handler(ctx, new_key)
    }

    pub fn check_in(ctx: Context<CheckIn>) -> Result<()> {
        instructions::check_in::handler(ctx)
    }
}
