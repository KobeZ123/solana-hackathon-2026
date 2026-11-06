# Tickets: low-level implementation specs

Source of truth for work breakdown. Each `## Txx` section is mirrored as a GitHub issue
(created from this file). Status is tracked in the table below and in
[HANDOFF.md](./HANDOFF.md). High-level design: [DESIGN.md](./DESIGN.md).

**Program ID (fixed):** `E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping`
(keypair kept outside the repo at `$DEV_HOME/keys/event_pool-keypair.json`, only needed for deploy.)

## Status

| ID | Title | Wave | Depends on | Issue | PR | Status |
|---|---|---|---|---|---|---|
| T00 | Scaffold template + dev env scripts | 0 | - | - | #1 | done |
| T01 | Docs, tickets, issues, handoff | 0 | - | - | - | done |
| T10 | Program skeleton, `create_event`, `set_gate` | 1 | T00 | #2 | - | todo |
| T11 | `join_event`, `rotate_ticket_key` | 1b | T10 | #3 | - | todo |
| T12 | `check_in` | 1b | T10 | #4 | - | todo |
| T13 | `end_event`, `claim`, `withdraw_host` | 1b | T10 | #5 | - | todo |
| T14 | `cancel_event`, `refund` | 1b | T10 | #6 | - | todo |
| T15 | Localnet end-to-end lifecycle script | 2 | T11-T14 | #7 | - | todo |
| T20 | Web shell: replace vault UI, nav, route stubs | 1 | T00 | #8 | - | todo |
| T21 | Web libs: QR crypto, ticket keys, api-client/auth | 1 | T00 | #9 | - | todo |
| T22 | Create-event page | 2 | T10, T20, T30 | #10 | - | todo |
| T23 | Event page: join + gated details | 2 | T11, T20, T21, T31 | #11 | - | todo |
| T24 | Ticket page: rotating QR | 2 | T21, T23 | #12 | - | todo |
| T25 | Scanner page (gate key, verify, check-in) | 2 | T12, T21 | #13 | - | todo |
| T26 | Host dashboard | 2 | T13, T14, T20 | #14 | - | todo |
| T27 | Claim and refund UI | 2 | T13, T14, T20 | #15 | - | todo |
| T30 | API: store abstraction + wallet auth | 1 | T00 | #16 | - | todo |
| T31 | API: events endpoints + ticket gating | 1 | T30 | #17 | - | todo |
| T40 | Stretch A program: vendors + sponsorship proposals | 3 | T13 | #18 | - | todo |
| T41 | Stretch A program: delivery + settlement | 3 | T40 | #19 | - | todo |
| T42 | Stretch A UI: vendor flow | 3 | T41, T25 | #20 | - | todo |
| T50 | Stretch B API: attendance index + feed | 3 | T31, T12 | #21 | - | todo |
| T51 | Stretch B UI: feed, network page, visibility | 3 | T50 | #22 | - | todo |
| T60 | Devnet deploy + env + Vercel docs | 3 | all MVP | #23 | - | todo |
| T61 | README, demo script, final handoff | 3 | all | #24 | - | todo |

---

## Conventions (every ticket)

- **Branch:** `tNN-short-name` off latest `main`, in its own git worktree. **PR title:** `TNN: title`. **PR body** includes `Closes #<issue>`. Squash-merge to `main`, delete branch.
- **Commit message trailer** and **PR body footer:** use exactly the attribution lines from the session instructions (Co-Authored-By / Claude-Session / "Generated with Claude Code").
- **Toolchain env:** `source scripts/env.sh`. Run anchor/cargo-sbf builds through `scripts/with-devhome.sh` (e.g. `scripts/with-devhome.sh anchor build --ignore-keys` from `anchor/`). The internal disk of the dev machine is nearly full; never write toolchains or caches to `$HOME`.
- **Quality gate before merge:** `npm run lint`, `npx tsc --noEmit`, `npm run format:check` pass; program tickets also run `cargo test` in `anchor/`. Run `npx prettier --write` on touched files.
- **Generated client** (`app/generated/event_pool/`) is committed. After any program interface change run (from repo root) `scripts/with-devhome.sh bash -c 'npm run setup'` and commit the result. On a merge/rebase conflict inside `app/generated/` or `anchor/target`, **regenerate, never hand-merge**.
- **Do not edit** `docs/TICKETS.md` or `docs/HANDOFF.md` (owned by the orchestrator). Put notes for the handoff in the PR description and your final report: what was built, what was verified (and how), what is incomplete, any decision you made.
- **Never** commit secrets, keypairs, `.env*`, or `node_modules`. Do not use `git reset --hard`, force-push `main`, or delete other people's branches.
- If you touch shared files (`anchor/programs/event_pool/src/lib.rs`, `instructions/mod.rs`, `errors.rs`, `page.tsx`, `layout.tsx`), keep edits minimal and additive so parallel PRs rebase cleanly. `git fetch && git rebase origin/main` before opening the PR and again right before merging.
- Report honestly. If something could not be verified (no browser wallet in CI, devnet rate limited), say so in the PR.

## Shared contracts (all agents code against these)

### Program: `event_pool`

Crate `anchor/programs/event_pool`, program id above. Layout:
```
src/lib.rs               declare_id!, #[program] mod with thin dispatch to instructions::*
src/constants.rs         seeds, MIN_ENTRY_FEE, CHECKIN_GRACE_SECS
src/errors.rs            EventPoolError
src/state/mod.rs, event.rs, ticket.rs   (+ vendor.rs, sponsorship.rs in stretch A)
src/instructions/mod.rs, <one file per instruction>.rs
src/tests/...            LiteSVM tests (mod tests; helpers in tests/common.rs)
```
Constants: seeds `b"event"`, `b"vault"`, `b"ticket"`; `MIN_ENTRY_FEE = 1_000_000` lamports; `CHECKIN_GRACE_SECS = 3600` (check-in opens this long before `start_ts`).

**`Event`** PDA, seeds `[b"event", host, event_id.to_le_bytes()]`:
`host: Pubkey, event_id: u64, gate_authority: Pubkey, entry_fee: u64, capacity: u32, tickets_sold: u32, checked_in: u32, start_ts: i64, end_ts: i64, payout_bps: u16, status: EventStatus, attendee_pool: u64, host_budget: u64, host_withdrawn: bool, metadata_hash: [u8; 32], approved_sponsor_total: u64, bump: u8, vault_bump: u8`.
`EventStatus { Open, Ended, Cancelled }` (Anchor enum, `InitSpace`). `approved_sponsor_total` exists from day one so stretch A needs no layout change.

**Vault** PDA, seeds `[b"vault", event]`: system-owned, no data, holds lamports. `create_event` funds it with `Rent::minimum_balance(0)` from the host so later transfers are rent-valid. That rent minimum is never distributed: **pool = vault.lamports - rent_min**.

**`Ticket`** PDA, seeds `[b"ticket", event, member]`:
`event: Pubkey, member: Pubkey, ticket_key: Pubkey, checked_in: bool, checked_in_at: i64, claimed: bool, bump: u8`.

**Errors** (`EventPoolError`, in this order): `InvalidTimeRange, InvalidPayoutBps, InvalidCapacity, FeeTooLow, EventNotOpen, EventFull, EventEnded, EventNotEnded, EventNotCancelled, EventStarted, NotHost, NotGateAuthority, AlreadyCheckedIn, NotCheckedIn, CheckInNotOpen, AlreadyClaimed, AlreadyWithdrawn, MathOverflow` (stretch A appends: `SponsorshipBudgetExceeded, InvalidSponsorshipStatus, NotVendor`). Append only; do not reorder.

**Instructions** (account names are the contract for the Codama client):

| Instruction | Args | Accounts (signer first) | Rules |
|---|---|---|---|
| `create_event` | `event_id u64, entry_fee u64, capacity u32, start_ts i64, end_ts i64, payout_bps u16, metadata_hash [u8;32]` | `host` (signer, mut), `event` (init), `vault` (mut, system PDA), `system_program` | `entry_fee >= MIN_ENTRY_FEE`, `capacity > 0`, `end_ts > start_ts`, `payout_bps <= 10000`; `gate_authority = host`; status Open; fund vault with rent min |
| `set_gate` | `gate: Pubkey` | `host` (signer), `event` (mut) | host only; status Open |
| `join_event` | `ticket_key: Pubkey` | `member` (signer, mut), `event` (mut), `vault` (mut), `ticket` (init), `system_program` | Open, `now < end_ts`, `tickets_sold < capacity`; transfer `entry_fee` member->vault; `tickets_sold += 1` |
| `rotate_ticket_key` | `new_key: Pubkey` | `member` (signer), `event`, `ticket` (mut) | Open, not checked in |
| `check_in` | - | `gate` (signer), `event` (mut), `member` (unchecked, used for ticket seeds), `ticket` (mut) | `gate == event.gate_authority`; Open; `start_ts - GRACE <= now <= end_ts`; not already checked in; sets `checked_in`, `checked_in_at`; `event.checked_in += 1` |
| `end_event` | - | `host` (signer), `event` (mut), `vault` | host only; Open; `now >= end_ts`; `pool = vault.lamports - rent_min`; `attendee_pool = pool * payout_bps / 10000` (u128 math); `host_budget = pool - attendee_pool`; if `checked_in == 0` then `host_budget += attendee_pool, attendee_pool = 0`; status Ended |
| `claim` | - | `member` (signer, mut), `event` (mut), `ticket` (mut), `vault` (mut), `system_program` | Ended; ticket checked in; not claimed; pays `attendee_pool / checked_in` from vault (PDA-signed); `claimed = true` |
| `withdraw_host` | - | `host` (signer, mut), `event` (mut), `vault` (mut), `system_program` | host only; Ended; not withdrawn; pays `host_budget - approved_sponsor_total + dust` where `dust = attendee_pool - (attendee_pool / checked_in) * checked_in` (0 if `checked_in == 0`); `host_withdrawn = true` |
| `cancel_event` | - | `host` (signer), `event` (mut) | host only; Open; `now < start_ts`; status Cancelled |
| `refund` | - | `member` (signer, mut), `event` (mut), `ticket` (mut, `close = member`), `vault` (mut), `system_program` | Cancelled; pays `entry_fee` from vault; `tickets_sold -= 1` |

All lamport movement out of the vault uses `system_program::transfer` with PDA signer seeds `[b"vault", event.key(), &[event.vault_bump]]`. Use `checked_*` math everywhere.

### QR payload (client contract, T21)

```ts
type CheckinPayload = { v: 1; event: string; member: string; ts: number; sig: string }; // ts = unix seconds, sig = base58(ed25519(ticketSecret, message))
message = utf8(`checkin:${event}:${member}:${ts}`)
```
Valid when `|now - ts| <= 30` seconds and the signature verifies against `Ticket.ticket_key`. QR refreshes every 20 s. Vendor QR (stretch A) uses the same shape with `vendor` in place of `member` and message prefix `delivery:`.

### Web libs

- `app/lib/config.ts` (exists): `PROGRAM_ID`, `MIN_ENTRY_FEE_LAMPORTS`, `QR_MAX_AGE_SECS`, `QR_REFRESH_SECS`.
- `app/lib/qr/*` (T21): `generateTicketKey()`, `saveTicketKey/loadTicketKey(event, wallet)` (localStorage, try/catch), `createCheckinPayload`, `verifyCheckinPayload`, `encodePayload/decodePayload`.
- `app/lib/api-client.ts` + `useAuth()` (T21): sign-in-with-wallet against `/api/auth/*`, token kept in memory + sessionStorage; `apiFetch(path, init)` adds bearer token.
- `app/lib/event-pool/*` (T20/T22+): thin wrappers over the Codama client for fetching Event/Ticket accounts (`useEvent(pda)`, `useTicket(event, member)`) and sending instructions via `use-send-transaction`.

### API (T30/T31/T50)

Next.js route handlers under `app/api/`, helpers under `app/lib/server/`. Store interface in `app/lib/server/store.ts`; Supabase implementation used when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, otherwise a JSON-file store at `.data/store.json` (gitignored) so everything runs locally without provisioning. Env: `JWT_SECRET` (dev fallback with console warning), `SOLANA_RPC_URL` (default devnet), `NEXT_PUBLIC_PROGRAM_ID` (default `PROGRAM_ID`).

| Route | Auth | Notes |
|---|---|---|
| `POST /api/auth/nonce` `{wallet}` -> `{nonce, message}` | no | nonce stored with 5 min TTL |
| `POST /api/auth/verify` `{wallet, signature}` -> `{token}` | no | verifies ed25519 over the nonce message; JWT (HS256, `jose`), 12 h |
| `POST /api/events` | JWT (host) | body: `{eventPda, title, summary, coverUrl?, details, visibility?}`; server reads the Event account via RPC, checks `account.host == jwt.wallet` and `metadata_hash == sha256(canonical JSON of {title, summary, coverUrl, details})` |
| `GET /api/events` | optional | public summaries (stretch B filters by network) |
| `GET /api/events/[pda]` | optional | summary + on-chain fee/capacity/tickets_sold/status |
| `GET /api/events/[pda]/details` | JWT | 200 if caller is host or a `Ticket` PDA exists for (event, wallet) (RPC `getAccountInfo`), else 403 |

---

## T10: Program skeleton, `create_event`, `set_gate`
**Labels:** program, wave-1 · **Depends on:** T00

Replace the template `vault` program with `event_pool`.
- Rename/replace `anchor/programs/vault` with `anchor/programs/event_pool`; update `anchor/Cargo.toml` members if needed, `Anchor.toml` (`[programs.devnet] event_pool = "<program id>"`, add `[programs.localnet]`), `declare_id!`.
- Implement module layout, constants, `EventPoolError`, `Event`/`EventStatus`/`Ticket` state exactly as in *Shared contracts*, and instructions `create_event` and `set_gate`. Other instructions are added by later tickets; leave `instructions/mod.rs` and `lib.rs` structured so each is a one-line additive change.
- Update `codama.json` (idl path `./anchor/target/idl/event_pool.json`, output `./app/generated/event_pool`), delete `app/generated/vault`, regenerate the client. Remove `app/components/vault-card.tsx` usage only as far as needed to keep `tsc`/build green (T20 owns the UI rewrite; a minimal stub on `page.tsx` is fine).
- LiteSVM test harness in `src/tests/common.rs`: load the built `.so`, helper to set the Clock sysvar (warp), airdrop, PDA derivation helpers, instruction builders. Tests: create_event happy path (account fields, vault funded with rent min); each validation error; `set_gate` host-only and Open-only.
- Acceptance: `anchor build --ignore-keys` OK, `cargo test` passes, `npm run setup` regenerates a client exposing `createEvent`/`setGate` instructions and `Event`/`Ticket` account decoders, `npm run lint && tsc && format:check` pass.

## T11: `join_event`, `rotate_ticket_key`
**Labels:** program, wave-1b · **Depends on:** T10

Implement per the contract table. Tests: happy path (fee moves member->vault, ticket fields, counter), double join rejected (PDA already exists), capacity full, after `end_ts`, not Open, insufficient funds; `rotate_ticket_key` happy path, after check-in rejected (add after T12 merges if ordering requires, or test via direct account setup), wrong signer. Regenerate client.

## T12: `check_in`
**Labels:** program, wave-1b · **Depends on:** T10

Per contract. Tests: gate (default = host) can check in; after `set_gate` only the new gate can (host no longer can); before the grace window rejected; after `end_ts` rejected; double check-in rejected; non-gate signer rejected; counter increments. Use the test-side join helper (from T11 if merged, otherwise a local helper that creates the Ticket account state directly). Regenerate client.

## T13: `end_event`, `claim`, `withdraw_host`
**Labels:** program, wave-1b · **Depends on:** T10

Per contract. Tests: full lifecycle with 3 joined, 2 checked in, `payout_bps = 3000`: attendee share, host budget, dust accounting; invariant `sum of all payouts <= pool` and vault retains exactly the rent minimum after everyone claims and the host withdraws (when dust is included); zero check-ins rolls attendee pool into host budget; early `end_event` rejected; double claim; claim without check-in; double withdraw; non-host withdraw. Regenerate client.

## T14: `cancel_event`, `refund`
**Labels:** program, wave-1b · **Depends on:** T10

Per contract. Tests: cancel before start, refund returns exactly `entry_fee` and closes the ticket (rent to member), cannot cancel after start, cannot cancel twice, refund when not cancelled rejected, cannot join a cancelled event, vault balance equals rent minimum after all refunds. Regenerate client.

## T15: Localnet end-to-end lifecycle script
**Labels:** program, testing, wave-2 · **Depends on:** T11, T12, T13, T14

`scripts/e2e-localnet.ts` (run with `npx tsx`, add devDependency if needed) that: starts against `solana-test-validator` (script `scripts/e2e-localnet.sh` starts it with `--bpf-program <id> anchor/target/deploy/event_pool.so --reset` in a temp ledger dir on the external volume, waits for RPC, runs the TS, always kills the validator). The TS uses the Codama client + `@solana/kit` with generated keypairs: creates an event with short window, 3 members join, sets a gate key, 2 check in (using the real `lib/qr` sign/verify path so QR crypto is covered), warps/waits to `end_ts` (use a window a few seconds in the future and sleep), ends, claims, host withdraws, then asserts balances. Second scenario: cancel + refund. Add `npm run e2e`. Output must clearly print PASS/FAIL. Document how to run in the PR.

## T20: Web shell
**Labels:** web, wave-1 · **Depends on:** T00

Replace the vault landing page with the product shell. Header with logo/name, nav (Events, Create, My tickets placeholder), wallet button + cluster select (keep). Home page: hero + event list (client fetch `/api/events`, graceful empty/error states since the API may not exist yet). Create route stubs with placeholder content and correct layout for: `/events/new`, `/events/[pda]`, `/events/[pda]/ticket`, `/events/[pda]/host`, `/events/[pda]/scan`, `/events/[pda]/claim`. Mobile-first layout (scanner and ticket pages are used on phones). Keep light/dark theme. Remove `vault-card.tsx` and vault copy. Acceptance: `npm run build` passes, all routes render, lint/format clean, screenshots or a short description of each page in the PR.

## T21: Web libs: QR crypto, ticket keys, api-client/auth
**Labels:** web, wave-1 · **Depends on:** T00

Implement `app/lib/qr/*` and `app/lib/api-client.ts` + `useAuth()` per *Shared contracts*, plus reusable components `app/components/qr-display.tsx` (renders a payload with `qrcode.react`, accepts a `getPayload()` and auto-refreshes every `QR_REFRESH_SECS` with a countdown ring) and `app/components/qr-scanner.tsx` (wraps `@yudiel/react-qr-scanner`, emits decoded payload strings, camera-permission and error states, dedupes repeat reads within 2 s). Add a unit test setup (vitest) with tests for: sign/verify round trip, rejects tampered fields, rejects expired `ts` and future `ts` beyond 5 s skew, rejects wrong key, encode/decode round trip, ticket key storage with localStorage unavailable. Add `npm run test`. Use `@solana/kit` key utilities or `tweetnacl` (pick one, justify in PR); keys and signatures are base58 strings in payloads.

## T22: Create-event page
**Labels:** web, wave-2 · **Depends on:** T10, T20, T30

`/events/new` form: title, summary, location + details (gated), cover URL (optional), entry fee (SOL), capacity, start/end (datetime-local), attendee payout % (10-50 slider, default 30, converted to bps), visibility (public default; network option only shown/enabled when stretch B ships). Validation mirrors program rules and shows inline errors. Submit flow: compute `event_id` (e.g. `BigInt(Date.now())`), compute `metadata_hash` exactly as the API contract (shared helper `app/lib/metadata.ts` used by both client and server, with a unit test), send `create_event`, then sign in (`useAuth`) and `POST /api/events`; on success navigate to `/events/[pda]`. Handle partial failure (chain ok, API failed): show retry for the API step. Toast with explorer link.

## T23: Event page: join + gated details
**Labels:** web, wave-2 · **Depends on:** T11, T20, T21, T31

`/events/[pda]`: fetch the Event account (chain) and summary (API); show title, host, fee, capacity, tickets sold, time, status, live pool balance. Role-aware primary action: not connected -> connect; no ticket -> **Join** (generate ticket key via `lib/qr`, send `join_event` with its public key, store secret in localStorage); has ticket -> "View ticket" link + gated details (sign in, `GET /api/events/[pda]/details`); host -> link to dashboard and scanner. Handle sold out, ended, cancelled, wrong cluster, insufficient balance (with airdrop hint on devnet). Poll or revalidate after transactions (SWR).

## T24: Ticket page: rotating QR
**Labels:** web, wave-2 · **Depends on:** T21, T23

`/events/[pda]/ticket`: requires wallet + Ticket account. Loads the ticket secret from localStorage; if missing offer **Recover ticket** (generate new key, `rotate_ticket_key`, store). Shows `QrDisplay` with `createCheckinPayload`, large event name, checked-in state (poll Ticket account every 5 s and show a green confirmed screen when `checked_in`), and a brightness-friendly layout for phones. Handle already-checked-in, wrong wallet, event over.

## T25: Scanner page
**Labels:** web, wave-2 · **Depends on:** T12, T21

`/events/[pda]/scan` (host only): step 1 gate setup: generate ephemeral gate keypair (stored in localStorage per event), show its address and balance, buttons to **fund gate** (host signs a transfer of 0.01 SOL) and **authorize gate** (`set_gate`). Step 2 scanning: `QrScanner`; for each payload verify with `verifyCheckinPayload` against the cached ticket keys (fetch all Tickets for the event via `getProgramAccounts` with a memcmp filter on `event`, refresh every 15 s and on a cache miss), reject stale/invalid/unknown/already-checked-in with distinct red states, otherwise send `check_in` signed by the gate key (no wallet popup) and show a big green state with the member address; counters (scanned ok / rejected). Failed sends go in a retry queue shown in the UI. Result states auto-clear after 2 s so the next person can scan.

## T26: Host dashboard
**Labels:** web, wave-2 · **Depends on:** T13, T14, T20

`/events/[pda]/host` (host only): live pool balance, tickets sold / capacity, checked in, computed attendee pool and host budget preview from `payout_bps`; actions by state: Open before start -> **Cancel event**; Open after `end_ts` -> **End event**; Ended -> **Withdraw host budget** (shows exact amount incl. dust); links to scanner and public page. Show the attendee list (wallet, checked in, claimed) from Tickets. Confirm dialogs for irreversible actions, toasts with explorer links.

## T27: Claim and refund UI
**Labels:** web, wave-2 · **Depends on:** T13, T14, T20

`/events/[pda]/claim` for members: states: event not ended (explain), ended + checked in + unclaimed -> **Claim X SOL**, claimed (show tx link), not checked in (explain no payout), cancelled -> **Refund** (shows entry fee), refunded. Add "My tickets" on the home page or `/tickets`: list the connected wallet's Tickets (`getProgramAccounts` memcmp on `member`) with event status and the right call to action per ticket.

## T30: API: store abstraction + wallet auth
**Labels:** api, wave-1 · **Depends on:** T00

Implement the store interface and both implementations (Supabase and JSON-file), `supabase/migrations/0001_init.sql` (tables `events`, `auth_nonces`, `attendance` per DESIGN.md with RLS enabled and no public policies; server uses the service role), auth routes, `requireAuth` helper, JWT with `jose`. Tests (vitest, shared setup with T21 if it lands first; otherwise add vitest config idempotently): nonce TTL and single use, bad signature rejected, valid signature accepted, token expiry, store contract tests run against the file store. `.env.example` documenting all env vars. Do not provision Supabase; document the manual step.

## T31: API: events endpoints + ticket gating
**Labels:** api, wave-1 · **Depends on:** T30

Implement the events routes in *Shared contracts*. Account reading uses `@solana/kit` RPC (`SOLANA_RPC_URL`): derive Event/Ticket PDAs with `PROGRAM_ID` and decode just the fields needed (`host`, `entry_fee`, `capacity`, `tickets_sold`, `checked_in`, `start_ts`, `end_ts`, `status`, `metadata_hash`) using a small hand-written decoder with the Anchor 8-byte discriminator skipped, until the Codama client exists (T10), then switch to it if trivial. Put the RPC access behind an injectable interface so unit tests use a fake chain. Shared `app/lib/metadata.ts` canonical hash helper (sha256 over canonical JSON, keys sorted, UTF-8) is owned by T22 *if T22 lands first*; otherwise create it here and T22 imports it. Tests: host mismatch rejected, hash mismatch rejected, details 403 without ticket / 200 with ticket / 200 for host, summary merges chain + stored data, unknown event 404.

## T40: Stretch A program: vendors + sponsorship proposals
**Labels:** program, stretch-a, wave-3 · **Depends on:** T13

Per DESIGN.md section 8. Add `VendorProfile` (`[b"vendor", authority]`: `authority, vendor_key, bump`) and `Sponsorship` (`[b"sponsor", event, vendor]`: `event, vendor, amount, status, offer_hash, bump`; `SponsorshipStatus { Proposed, Approved, Delivered, Paid, Rejected }`). Instructions: `register_vendor(vendor_key)`, `propose_sponsorship(amount, offer_hash)` (Event Open), `approve_sponsorship` (host; requires `approved_sponsor_total + amount <= max_host_budget` where `max_host_budget = (vault.lamports - rent_min) * (10000 - payout_bps) / 10000`; increments `approved_sponsor_total`), `reject_sponsorship` (host; Proposed only). Append the stretch errors. Tests for each rule and the budget cap. Regenerate client.

## T41: Stretch A program: delivery + settlement
**Labels:** program, stretch-a, wave-3 · **Depends on:** T40

`confirm_delivery` (signer must be `event.gate_authority`; Sponsorship Approved -> Delivered; the vendor QR signature itself is verified client-side, same as tickets) and `settle_vendor` (anyone signs; Delivered -> Paid; transfers `amount` vault -> vendor wallet; allowed while Open or Ended). Update `withdraw_host` so it only releases `host_budget - approved_sponsor_total + dust` (already per contract) and add `release_sponsorship` (host, only for Approved-not-delivered after event Ended; decrements `approved_sponsor_total`) so unspent reservations can be recovered. Tests including the full vendor path and that vendor payout never reduces the attendee pool. Regenerate client; extend `scripts/e2e-localnet.ts` with a vendor scenario.

## T42: Stretch A UI: vendor flow
**Labels:** web, stretch-a, wave-3 · **Depends on:** T41, T25

Vendor registration page `/vendor` (profile name/logo stored via API `vendors` table, `register_vendor` on-chain with a generated vendor key in localStorage), propose sponsorship from an event page (amount + offer text), host inbox on the dashboard (approve/reject), vendor QR page (reuses `QrDisplay` with `delivery:` payloads), and a delivery-scan mode on the scanner page (verify against `VendorProfile.vendor_key`, call `confirm_delivery`, then `settle_vendor`). API: `vendors` and `sponsorship_offers` tables + routes.

## T50: Stretch B API: attendance index + feed
**Labels:** api, stretch-b, wave-3 · **Depends on:** T31, T12

Per DESIGN.md section 9. Indexer module `app/lib/server/attendance.ts`: `refreshAttendance()` reads all `Ticket` accounts via `getProgramAccounts` (injectable chain interface), upserts `attendance(event_pda, wallet, checked_in, checked_in_at)`; called on demand from the feed route with a 30 s in-process throttle, and exposed at `POST /api/index/refresh` (cron-friendly, protected by `CRON_SECRET`). Connections: weak tie = both hold tickets for a common event, strong tie = both checked in at a common event; hosts count as holders of their own events. Routes: `GET /api/feed` (public events + `network` events whose host is within 1 hop, `?strong=1` for strong ties only), `GET /api/me/network` (peers with shared-event counts, strong/weak, totals, "events unlockable" count). `GET /api/events/[pda]` returns 404 for `network` events the viewer cannot see. Unit tests on a fake chain covering weak vs strong ties, host counted, 1-hop only, visibility enforcement.

## T51: Stretch B UI: feed, network page, visibility
**Labels:** web, stretch-b, wave-3 · **Depends on:** T50

Home page uses `/api/feed` when signed in (fallback to public list). `/network` page: your connections, strong vs weak, shared events, progress nudge ("attend 1 more event to unlock N events"). Enable the `visibility` selector in create-event. Event cards show a "from your network" badge with the connecting event.

## T60: Devnet deploy + env + Vercel docs
**Labels:** infra, wave-3 · **Depends on:** all MVP

`scripts/deploy-devnet.sh`: builds with the real keypair (copies `$DEV_HOME/keys/event_pool-keypair.json` into `anchor/target/deploy/`), checks balance (devnet faucet / `solana airdrop`, tolerate rate limits and print manual faucet URL), deploys, prints program id and a verification `solana program show`. Actually deploy to devnet if funds allow and record the signature in the PR. `docs/DEPLOY.md`: Vercel setup, all env vars, Supabase provisioning steps (manual), Helius RPC key, devnet checklist, troubleshooting. Add `vercel.json` only if needed.

## T61: README, demo script, final handoff
**Labels:** docs, wave-3 · **Depends on:** all

Orchestrator-owned. README with pitch, architecture, quickstart, how to run tests/e2e, demo script from DESIGN.md section 12, known limitations; finalize HANDOFF.md.
