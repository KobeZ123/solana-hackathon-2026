use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::VendorProfile;

#[derive(Accounts)]
pub struct RegisterVendor<'info> {
    #[account(mut)]
    pub vendor: Signer<'info>,
    #[account(
        init,
        payer = vendor,
        space = 8 + VendorProfile::INIT_SPACE,
        seeds = [VENDOR_SEED, vendor.key().as_ref()],
        bump,
    )]
    pub vendor_profile: Account<'info, VendorProfile>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterVendor>, vendor_key: Pubkey) -> Result<()> {
    let p = &mut ctx.accounts.vendor_profile;
    p.authority = ctx.accounts.vendor.key();
    p.vendor_key = vendor_key;
    p.bump = ctx.bumps.vendor_profile;
    Ok(())
}
