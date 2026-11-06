# Handoff

Living status document. Read this first when you come back. Updated by the orchestrating session after each wave.
Last updated: 2026-11-06 (mid-build, orchestrator checkpoint 1).

## TL;DR
- Idea: event hosting where entry fees fund the event, QR tickets verified on Solana, attendees airdropped the pool share for showing up.
- Design: [DESIGN.md](./DESIGN.md). Work breakdown and status table: [TICKETS.md](./TICKETS.md). One GitHub issue per ticket.
- Stack: Anchor 1.1.2 program, Next.js 16 app + API routes, `@solana/kit`, Codama client, Phantom via wallet-standard, Supabase (optional; JSON-file store by default locally).
- Program ID: `E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping` (keypair outside the repo at `/Volumes/KobeT9/devhome/keys/event_pool-keypair.json`; **back this file up**, it is the program's upgrade authority key for the devnet deploy).

## Current state
Landed on main (all verified by the orchestrator re-running tests on main, see below):
- Program `event_pool`: create_event, set_gate, join_event, rotate_ticket_key, check_in, end_event, claim, withdraw_host, cancel_event, refund (PRs #28, #31-#34). `cargo test`: 75 passing (LiteSVM).
- API: store abstraction (Supabase or JSON file), wallet sign-in + JWT, events endpoints with ticket gating (#25, #27). vitest suite passing.
- Web: shell/nav (#29), QR crypto + components + api-client (#26), create-event page (#30), event page with join and gated details (#35), ticket page with rotating QR (#36).
In flight: T15 localnet e2e script, T25-T27 (scanner, host dashboard, claim/refund), stretch A program (T40/T41), stretch B (T50/T51). Not started: T42 (vendor UI), T60 (deploy), T61 (README).
Live status: table in TICKETS.md and the issue list.

## Machine/environment notes (important)
- The internal disk of this Mac was ~100% full (about 1 GB free). Toolchains and caches are redirected to `/Volumes/KobeT9/devhome` via `scripts/env.sh` and `scripts/with-devhome.sh`. Use them for every anchor/cargo command. If you free up disk space you can drop the redirection.
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
- Supabase is not provisioned automatically; the API falls back to a JSON-file store so local dev and demos work without it. Provision Supabase and set env vars for a hosted deploy (see DEPLOY.md when T60 lands).

## What I could not verify
(Updated as work lands. Browser wallet flows cannot be exercised headlessly; those are verified by build/typecheck and by the localnet e2e script, not by a real Phantom session.)

## Next steps for you
1. Skim the PR list and the status table.
2. Run the app locally and click through once with Phantom on devnet.
3. Provision Supabase + Vercel if you want a hosted demo (see DEPLOY.md).
