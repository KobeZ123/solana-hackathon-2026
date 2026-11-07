# Handoff

Read this first. Last updated: 2026-11-06, end of the orchestrated build.

## TL;DR
- **SOLSocial**: event hosting and community-building on Solana. Every RSVP is a small SOL payment; fees pool in an on-chain escrow; QR check-in is verified on-chain; guests who show up split a host-chosen share of the pool. Stretch features (built): vendor sponsorships and graph-gated discovery.
- All 24 tickets in [TICKETS.md](./TICKETS.md) are implemented and merged to `main`, with one exception: **the devnet deploy is not done** (see below).
- Design: [DESIGN.md](./DESIGN.md) · Pitch and copy: [PITCH.md](./PITCH.md) · Look and feel: [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) · Demo data: [SEED.md](./SEED.md) · Deploy: [DEPLOY.md](./DEPLOY.md) · E2E: [E2E.md](./E2E.md)
- Program ID: `E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping`. Its keypair is **not** in the repo: it lives at `$DEV_HOME/keys/event_pool-keypair.json` (default dev home is set in `scripts/env.sh`). **Back it up**; it is the program's identity and upgrade authority.

## What is verified (and how)
| Area | Evidence |
|---|---|
| Program (all instructions, MVP + vendors) | `cargo test`: 110 passing (LiteSVM), re-run by the orchestrator after the final rebase |
| Client + validator integration | `npm run e2e` on a live `solana-test-validator`. I re-ran the lifecycle and cancel/refund scenarios myself: 44 assertions passed. The T42 agent reported 83 passing after adding vendor scenarios; I did not re-run that final version |
| Web app | lint 0 errors, `tsc` clean, prettier clean on changed files, `vitest` 169 passing, `next build` OK (as of the last commit) |
| Seeded demo | `npm run seed` ran for real; I read all 7 events back from the chain and the API |
| UI look | Event page and home page viewed in a real browser against seeded data, console clean |

## What is NOT verified
- **No end-to-end click-through with a real Phantom wallet or phone camera.** Wallet signing, joining, the QR scanner and claim flows are exercised by the e2e script and unit tests against the generated client, not through the UI. Do this first.
- Phone-width layout was not viewed (the browser window would not resize).
- Supabase was never provisioned; its store is tested only against a fake PostgREST.
- `getProgramAccounts` paths (scanner ticket cache, feed indexer) are tested with fakes only.
- Scan success/failure screens still use green/red on purpose (legibility) and were not restyled.

## Not done / needs you
1. **Devnet deploy.** Scripts and docs exist (`scripts/deploy-devnet.sh`, `scripts/smoke-devnet.ts`, DEPLOY.md). Two attempts failed with `Max retries exceeded` / HTTP 429 because the public devnet RPC rate-limits program uploads. The throwaway deployer wallet is funded (~5 SOL, address `41XAJ4CRcG7WsUeFLBMRi7VeMcVFCNEF6jNA63KrTh99`, keypair outside the repo); leftover buffers were closed so the SOL is intact. **Fix:** get a free Helius (or similar) devnet RPC URL and run `RPC_URL=<url> bash scripts/deploy-devnet.sh`, then `npx tsx scripts/smoke-devnet.ts`. Tracked in the issue "Deploy event_pool to devnet".
2. Hosted deploy (Vercel + Supabase): see DEPLOY.md. The JSON-file store does not persist on Vercel, so Supabase is required there.
3. Redesign the remaining screens to the champagne mockup (`designs/champagne-gold-mockup.png`): landing, Events list, Create (5-step), Host dashboard, My tickets, Network, Vendor. Only the event details page, tokens, wordmark and background are done.
4. Your in-progress copy edits (`app/page.tsx`, `app/vendor/vendor-view.tsx`) were intentionally never committed by the build.

## Running it
```bash
source scripts/env.sh                 # optional toolchain/cache redirect (see below)
npm install
cp .env.example .env.local            # optional for local dev
npm run dev
```
- **Demo data without paying:** `SEED_FUND=<your-phantom-address> npm run seed`, then `SOLANA_RPC_URL=http://127.0.0.1:8899 npm run dev` and pick "localnet" in the header (details in SEED.md).
- **Currently on this machine:** a seeded local validator may still be running (`pgrep -fl solana-test-validator`) and a gitignored `.env.local` points the server at it. **Delete `.env.local` and stop the validator to use devnet again.**
- Program: `cd anchor && ../scripts/with-devhome.sh anchor build --ignore-keys && ../scripts/with-devhome.sh cargo test`. Regenerate the committed client after any program change with `scripts/with-devhome.sh npm run setup`; never hand-merge `app/generated/`.

## Machine notes
- The internal disk was ~100% full during the build (other data). Toolchains and caches are redirected to a dev volume by `scripts/env.sh` / `scripts/with-devhome.sh`; two agents were stranded when the shell tool failed, and I finished their branches by hand. If you free disk space you can drop the redirection.
- Agent worktrees live in `.claude/worktrees/` (gitignored, safe to delete with `git worktree remove --force <path>` then `git worktree prune`). The branch `backup/local-main-50b9ab8` is an old local backup, safe to delete.

## Decisions worth knowing
- A malicious host can check in wallets they control and take the attendee share; the split is fixed on-chain and visible but collusion is not prevented. Host stake/reputation is the natural next step.
- On-chain attendance is public. The server checks ticket ownership before releasing event details, and the in-app feed applies network visibility rules. Event details have no per-ticket-holder encryption.
- `settle_vendor` requires the event to be Ended; `approve_sponsorship` requires Open; cancelled events never pay vendors, so refunds are always fully funded.
- The ticket QR is signed by an ephemeral ticket key (registered on-chain at join) so there are no wallet popups; the host scanner uses an ephemeral gate key authorized once via `set_gate`.
- Palette is champagne/titanium on purpose (not purple/Solana-branded); Geist for UI, Instrument Serif for the wordmark only.
- Public-repo hygiene: no secrets or keypairs are in the repo; keep real keys in `.env.local` / Vercel env only, and consider enabling GitHub secret scanning and push protection.
