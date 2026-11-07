//! Stretch A helpers (kept out of common.rs to avoid merge conflicts): PDAs, instruction
//! builders and readers for vendors and sponsorships.
#![allow(dead_code)]

use anchor_lang::{system_program, AccountDeserialize, InstructionData, ToAccountMetas};
use solana_sdk::{instruction::Instruction, pubkey::Pubkey, signature::Keypair, signer::Signer};

use super::common::*;
use crate::constants::*;
use crate::state::{Sponsorship, VendorProfile};
use crate::ID as PROGRAM_ID;

pub fn vendor_pda(authority: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VENDOR_SEED, authority.as_ref()], &PROGRAM_ID)
}

pub fn sponsor_pda(event: &Pubkey, vendor: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SPONSOR_SEED, event.as_ref(), vendor.as_ref()],
        &PROGRAM_ID,
    )
}

pub fn register_vendor_ix(vendor: &Pubkey, vendor_key: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::RegisterVendor {
            vendor: *vendor,
            vendor_profile: vendor_pda(vendor).0,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: crate::instruction::RegisterVendor {
            vendor_key: *vendor_key,
        }
        .data(),
    }
}

pub fn propose_sponsorship_ix(
    vendor: &Pubkey,
    event: &Pubkey,
    amount: u64,
    offer_hash: [u8; 32],
) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::ProposeSponsorship {
            vendor: *vendor,
            vendor_profile: vendor_pda(vendor).0,
            event: *event,
            sponsorship: sponsor_pda(event, vendor).0,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: crate::instruction::ProposeSponsorship { amount, offer_hash }.data(),
    }
}

pub fn approve_sponsorship_ix(host: &Pubkey, event: &Pubkey, vendor: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::ApproveSponsorship {
            host: *host,
            event: *event,
            vault: vault_pda(event).0,
            sponsorship: sponsor_pda(event, vendor).0,
        }
        .to_account_metas(None),
        data: crate::instruction::ApproveSponsorship {}.data(),
    }
}

pub fn reject_sponsorship_ix(host: &Pubkey, event: &Pubkey, vendor: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::RejectSponsorship {
            host: *host,
            event: *event,
            sponsorship: sponsor_pda(event, vendor).0,
        }
        .to_account_metas(None),
        data: crate::instruction::RejectSponsorship {}.data(),
    }
}

impl TestEnv {
    pub fn get_vendor(&self, authority: &Pubkey) -> VendorProfile {
        let acc = self.svm.get_account(&vendor_pda(authority).0).unwrap();
        VendorProfile::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn get_sponsorship(&self, event: &Pubkey, vendor: &Pubkey) -> Sponsorship {
        let acc = self.svm.get_account(&sponsor_pda(event, vendor).0).unwrap();
        Sponsorship::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }
}

/// Register `vendor` (asserts success) with a fresh vendor key; returns the key.
pub fn register_vendor_default(env: &mut TestEnv, vendor: &Keypair) -> Pubkey {
    let key = Pubkey::new_unique();
    assert_ok(&env.send(&[register_vendor_ix(&vendor.pubkey(), &key)], vendor, &[]));
    key
}

/// Register (if needed) and propose a sponsorship (asserts success).
pub fn propose(env: &mut TestEnv, vendor: &Keypair, event: &Pubkey, amount: u64) {
    let ix = propose_sponsorship_ix(&vendor.pubkey(), event, amount, [9u8; 32]);
    assert_ok(&env.send(&[ix], vendor, &[]));
}

/// Host approves the vendor's proposal (asserts success).
pub fn approve(env: &mut TestEnv, host: &Keypair, event: &Pubkey, vendor: &Pubkey) {
    let ix = approve_sponsorship_ix(&host.pubkey(), event, vendor);
    assert_ok(&env.send(&[ix], host, &[]));
}
