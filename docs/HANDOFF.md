# Handoff

Living status document. Read this first when you come back. Updated by the orchestrating session after each wave.
Last updated: 2026-11-06 (mid-build, orchestrator checkpoint 2).

## TL;DR
- Idea: event hosting where entry fees fund the event, QR tickets verified on Solana, attendees airdropped the pool share for showing up.
- Design: [DESIGN.md](./DESIGN.md). Work breakdown and status table: [TICKETS.md](./TICKETS.md). One GitHub issue per ticket.
- Stack: Anchor 1.1.2 program, Next.js 16 app + API routes, `@solana/kit`, Codama client, Phantom via wallet-standard, Supabase (optional; JSON-file store by default locally).
- Program ID: `E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping` (keypair outside the repo at `$DEV_HOME/keys/event_pool-keypair.json`; **back this file up**, it is the program's upgrade authority key for the devnet deploy).

## Current state
Landed on main (orchestrator re-ran the gates on main/branches after merging; results below):
- **Program `event_pool`** (all MVP + stretch A instructions): create_event, set_gate, join_event, rotate_ticket_key, check_in, end_event, claim, withdraw_host, cancel_event, refund, register_vendor, propose/approve/reject_sponsorship, confirm_delivery, settle_vendor, release_sponsorship. `cargo test`: **110 passing** (LiteSVM), re-run by me after the final rebase.
- **Localnet e2e** (`npm run e2e`, T15 #44): ran for real on a live `solana-test-validator`, **44 assertions passed** (lifecycle + cancel/refund) against the latest program build.
- **API**: store abstraction (Supabase or JSON file), wallet sign-in + JWT, events endpoints with ticket gating, attendance index + feed + network endpoints (T30, T31, T50).
- **Web**: shell/nav, create event, event page (join + gated details), rotating-QR ticket page, scanner (gate key, no popups), host dashboard, claim/refund + My tickets, feed + network page (T20-T27, T51).
- Web gate on main: lint 0 errors, tsc clean, prettier clean, vitest 137 passing, `next build` OK.
In flight: T42 (vendor UI + vendor e2e scenario), T60 (devnet deploy + DEPLOY.md). Then T61 (README + final handoff).
Live status: table in TICKETS.md and the issue list.

## Machine/environment notes (important)
- The internal disk of this Mac was ~100% full (about 1 GB free). Toolchains and caches are redirected to `$DEV_HOME` via `scripts/env.sh` and `scripts/with-devhome.sh`. Use them for every anchor/cargo command. If you free up disk space you can drop the redirection.
- Pinned Rust for the program is 1.96 (`anchor/rust-toolchain.toml`).
- The generated Codama client (`app/generated/event_pool`) is committed; regenerate with `npm run setup` (through `with-devhome.sh`), never hand-merge it.

## How to run (will be filled in as tickets land)
```
source scripts/env.sh
npm install
cd anchor && ../scripts/with-devhome.sh anchor build --ignore-keys && ../scripts/with-devhome.sh cargo test
npm run dev
```

## Decisions made while building
- Local `main` had an unpushed commit (design docs) when work started; it was included in the scaffold PR, and the old local main is kept as branch `backup/local-main-50b9ab8` (safe to delete).
- The internal disk of this Mac is ~100% full from other data (not this project). Two agents were stranded when the Bash tool stopped working; the orchestrator finished their branches (T15, T41) by hand. Freeing disk space or setting CLAUDE_CODE_TMPDIR to the external volume is recommended.
- Agents merged their own PRs after their gates passed; some used a force-push on their own feature branch only. Never on main.
- Supabase is not provisioned automatically; the API falls back to a JSON-file store so local dev and demos work without it. Provision Supabase and set env vars for a hosted deploy (see DEPLOY.md when T60 lands).

## What I could not verify
- **Nothing in the web UI has been clicked through in a browser with a real Phantom wallet or camera.** UI is verified by types, unit tests of the pure logic, production build, and HTTP smoke checks. The on-chain half is verified by the LiteSVM tests and the localnet e2e, which drive the generated client with real transactions.
- Supabase was never provisioned; its store implementation is tested against a fake PostgREST and the same contract tests as the file store.
- `getProgramAccounts` (scanner ticket cache, feed indexer) is only tested with fakes in unit tests; the e2e does not exercise it.
- Known gaps: attendance index keeps stale rows for refunded tickets (only possible on cancelled events); no 2-hop visibility; a refunded ticket looks the same as no ticket in the UI.
(Updated as work lands. Browser wallet flows cannot be exercised headlessly; those are verified by build/typecheck and by the localnet e2e script, not by a real Phantom session.)

## Next steps for you
1. Skim the PR list and the status table.
2. Run the app locally and click through once with Phantom on devnet.
3. Provision Supabase + Vercel if you want a hosted demo (see DEPLOY.md).
