# SOLSocial: Design Spec

Event hosting infrastructure where entry fees fund the event, tickets are verifiable on Solana, and showing up gets you paid.

- **Target track:** DeFi (pooled escrow with programmatic payouts), plus Top 3 Overall
- **Builder:** solo, ~48 hours
- **Network:** Solana devnet
- **Currency:** native SOL (program written so the amount logic is token-agnostic; USDC is a stretch)

---

## 1. Scope

### MVP (must ship)
1. Host creates an event with an entry fee, capacity, start/end times.
2. Member connects Phantom, pays the fee, and receives a ticket.
3. Member sees event details only after holding a ticket (gated).
4. Member shows a rotating QR. Host scans it at the door and the member is checked in on-chain.
5. After the event ends, checked-in attendees claim an equal share of the attendee pool (airdrop incentive).
6. Host withdraws their budget share. Cancelled events allow refunds.

### Stretch A: Vendors (designed below, built if time allows)
Businesses register as vendors, propose sponsorships, hosts approve, vendors get a QR, host scans it to confirm delivery, and the vendor is paid from the pool.

### Stretch B: Graph-gated discovery (designed below, built if time allows)
You only see events from hosts connected to you through events you both attended.

---

## 2. Architecture

```
┌──────────────────────────────────────────────┐
│  Next.js 16 app (React 19, Tailwind v4)      │
│  ├─ UI: member / host / scanner pages        │
│  │   wallet-standard (Phantom), @solana/kit  │
│  └─ /api route handlers                      │
│      SIWS auth -> JWT, event metadata,       │
│      gated details, (stretch) graph feed     │
└───────────┬───────────────────┬──────────────┘
            │ Codama client     │ Supabase Postgres
            ▼                   │ RPC reads (@solana/kit)
┌──────────────────────────┐◄───┘
│  Anchor program          │   Helius RPC (devnet)
│  event_pool              │
└──────────────────────────┘
```

**Principle:** money custody, ticket ownership, and attendance proof live on-chain. Descriptions, search, and gating live off-chain. The UI reads chain state directly over RPC. The server side is thin, and it lives in the same Next.js app.

### Starting point
Template: `solana-foundation/templates/kit/nextjs-anchor` (Next.js 16, Tailwind v4, `@solana/kit`, wallet-standard, Anchor 1.1.2, Codama-generated client, LiteSVM tests). Scaffold with:
```
npx -y create-solana-dapp@latest -t solana-foundation/templates/kit/nextjs-anchor
```
We replace the sample `vault` program with `event_pool` and reuse the wallet layer, cluster switching, send-transaction pipeline and error parsing as they are.

### Repo layout (target)
```
/anchor/programs/event_pool   Anchor program (Rust) + LiteSVM tests
/app                          Next.js app router: pages, components, lib
/app/api                      Route handlers (auth, events, feed)
/app/generated/event_pool     Codama-generated program client
/docs                         this spec
```

### Tech choices
| Layer | Choice | Reason |
|---|---|---|
| Program | Anchor 1.1.x | Standard, IDL feeds Codama |
| Web + API | Next.js 16 (App Router), React 19, TS | One codebase, one deploy; shared types between UI and server |
| Styling | Tailwind v4 | Already in the template |
| Wallet | wallet-standard layer from the template (Phantom) | Already built, auto-discovers wallets |
| Chain client | `@solana/kit` plus Codama client | Typed instructions and accounts |
| QR | `qrcode.react` (display), `@yudiel/react-qr-scanner` (scan) | Browser camera, no native app |
| Signing/verify | `@solana/kit` key utilities or `tweetnacl` | ed25519 keygen/sign/verify in browser and server |
| DB | Supabase Postgres | Zero setup |
| RPC | Helius devnet | Reliable; webhooks available |
| Hosting | Vercel (app and API), Supabase (DB), Solana devnet | One deploy from GitHub |

**Next.js notes:** wallet hooks, QR display and the camera scanner must be client components (`'use client'`). Route handlers are serverless, so the graph index (Stretch B) is built on demand with caching or a cron job, not a background worker.

---

## 3. On-chain program (`event_pool`)

### 3.1 Accounts

**Event** PDA: seeds `["event", host, event_id: u64]`
| Field | Type | Notes |
|---|---|---|
| host | Pubkey | Creator |
| event_id | u64 | Host-scoped counter or timestamp |
| gate_authority | Pubkey | Ephemeral key allowed to call `check_in` (see 3.4) |
| entry_fee | u64 | Lamports |
| capacity | u32 | Max tickets |
| tickets_sold | u32 | |
| checked_in | u32 | |
| start_ts / end_ts | i64 | |
| payout_bps | u16 | Share of pool reserved for attendees (immutable), e.g. 3000 = 30% |
| status | enum | `Open, Ended, Cancelled` |
| attendee_pool | u64 | Snapshot at `end_event` |
| host_budget | u64 | Snapshot at `end_event` |
| host_withdrawn | bool | |
| metadata_hash | [u8;32] | Hash of off-chain details; binds DB content to chain |
| bump | u8 | |

**Vault** PDA: seeds `["vault", event]`. System-owned account that holds lamports (no data).

**Ticket** PDA: seeds `["ticket", event, member]`
| Field | Type | Notes |
|---|---|---|
| event | Pubkey | |
| member | Pubkey | Wallet that paid |
| ticket_key | Pubkey | Ephemeral key used to sign QR payloads |
| checked_in | bool | |
| checked_in_at | i64 | |
| claimed | bool | |
| bump | u8 | |

The Ticket doubles as the **attendance record**. Graph edges are derived from `checked_in == true`.

*(Stretch A)* **VendorProfile** PDA `["vendor", authority]` and **Sponsorship** PDA `["sponsor", event, vendor]`: see section 8.

### 3.2 Instructions

| Instruction | Signer | Behavior |
|---|---|---|
| `create_event(params)` | host | Init Event + Vault. Validates `payout_bps <= 10000`, `end_ts > start_ts`, `capacity > 0`. |
| `set_gate(gate_authority)` | host | Updates the gate key while status is `Open`. |
| `join_event(ticket_key)` | member | Requires `Open`, `tickets_sold < capacity`, `now < end_ts`. Transfers `entry_fee` to Vault, inits Ticket. |
| `rotate_ticket_key(new_key)` | member | Replaces the ticket key (lost localStorage). Only before check-in. |
| `check_in()` | gate_authority | Requires `Open`, within `[start_ts - grace, end_ts]`, not already checked in. Sets `checked_in`, increments counter. |
| `end_event()` | host | Requires `now >= end_ts`. Snapshots `pool = vault_balance - rent`. Sets `attendee_pool = pool * payout_bps / 10000`, `host_budget = pool - attendee_pool`. Status = `Ended`. If `checked_in == 0`, attendee_pool rolls into host_budget. |
| `claim()` | member | Requires `Ended`, `checked_in`, not `claimed`. Pays `attendee_pool / checked_in` from Vault. |
| `withdraw_host()` | host | Requires `Ended`, not withdrawn. Pays `host_budget` (minus approved vendor payouts in Stretch A). |
| `cancel_event()` | host | Allowed only while `Open` and before `start_ts`. Status = `Cancelled`. |
| `refund()` | member | Requires `Cancelled`. Returns `entry_fee`, closes Ticket. |

**Pull-based payout:** attendees claim their own share. This avoids unbounded loops and large batched transactions, so it works cleanly at hackathon scale. Division remainder (dust) stays in the vault and goes to the host.

### 3.3 Invariants
- Total lamports out of Vault never exceed Vault balance minus rent.
- `payout_bps` is immutable after creation.
- A ticket can be checked in once and claimed once.
- Refunds are only possible when the event is `Cancelled`.

### 3.4 Why a gate key
Phantom shows an approval popup for every transaction. A host scanning 50 people at the door cannot sign 50 popups. So:
1. Before the event, the host opens the scanner page. It generates an **ephemeral keypair** in the browser.
2. Host calls `set_gate(pubkey)` once (one popup) and sends ~0.01 SOL to the gate key for fees.
3. The scanner signs and sends `check_in` transactions with the gate key, with no popups.
4. The gate key can **only** call `check_in`. It cannot move funds. A leaked gate key can at worst check in a ticket that has a valid QR, and the host can rotate it.

The same idea applies to members (section 4): a **ticket key** signs QR payloads without Phantom popups.

---

## 4. Ticket QR design

Problem: a static QR can be screenshotted and shared. Phantom `signMessage` on every refresh would mean constant popups.

Solution:
1. At `join_event`, the web app generates an ephemeral **ticket keypair**, stores the secret in `localStorage`, and records the public key in the Ticket PDA.
2. The member's QR payload refreshes every ~20 seconds:
   ```json
   { "v": 1, "event": "<event pda>", "member": "<wallet>", "ts": 1730000000, "sig": "<ed25519 sig of 'checkin:{event}:{member}:{ts}'>" }
   ```
   Signed locally by the ticket key, so no popup.
3. The host scanner:
   - rejects if `now - ts > 30s`
   - looks up the Ticket (cached after load) and verifies `sig` against `ticket_key`
   - rejects if already `checked_in`
   - then sends `check_in` signed by the gate key
4. Scanner shows a green or red result immediately. Failed chain sends go into a local retry queue (venue wifi may be bad). The signature check itself needs no network once tickets are cached.

**Limits:** a member who clears browser storage uses `rotate_ticket_key` (Phantom-signed) to recover. A member can still hand their phone to a friend, which is acceptable.

---

## 5. Backend (Next.js route handlers)

### Responsibilities
- Authenticate wallets (Sign-In With Solana style).
- Store and gate event metadata.
- *(Stretch B)* Index attendance and serve graph queries.

### Auth
1. `POST /auth/nonce` with `{wallet}` returns `{nonce}`.
2. Wallet signs `"Sign in to Event Pool: {nonce}"` once (one popup).
3. `POST /auth/verify` with `{wallet, signature}` verifies ed25519 and returns a short-lived JWT.

### Endpoints (MVP)
All paths are route handlers under `/api` (for example `/api/events`).
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/events` | JWT (host) | Store metadata after on-chain `create_event`. Server recomputes and checks `metadata_hash` against the Event account. |
| GET | `/events/{pda}` | none | Public summary only: title, cover image, date, fee, capacity, host. Fee and capacity are read from the chain. |
| GET | `/events/{pda}/details` | JWT | Full details (location, description, links). Server verifies via RPC that a Ticket PDA exists for `(event, wallet)`, or that the caller is the host. Otherwise 403. |
| GET | `/events/{pda}/tickets` | JWT (host) | Ticket list with ticket keys for the scanner cache. Can also be read straight from the chain. |

### Tables
```sql
events(
  event_pda text primary key,
  host_wallet text not null,
  title text not null,
  summary text,
  cover_url text,
  details jsonb not null,       -- gated: location, full description, links
  metadata_hash text not null,
  visibility text default 'public',  -- 'public' | 'network' (Stretch B)
  created_at timestamptz default now()
)
```

**Honesty note:** gating is server-enforced, and metadata is not cryptographically encrypted. A determined user with DB access could read it. That is acceptable for the MVP. A stronger version would encrypt details per ticket holder.

---

## 6. Frontend

### Routes
| Route | Role | Purpose |
|---|---|---|
| `/` | all | Event list (public events; later, graph feed) |
| `/events/new` | host | Create event form (fee, capacity, times, payout %) then sign `create_event` |
| `/events/:pda` | all | Summary, **Join** button, details unlocked after ticket |
| `/events/:pda/ticket` | member | Rotating QR |
| `/events/:pda/host` | host | Pool balance, ticket count, check-in count, `end_event`, `withdraw_host`, `cancel_event` |
| `/events/:pda/scan` | host | Camera scanner with gate key (section 3.4) |
| `/events/:pda/claim` | member | Claim airdrop after `Ended` |
| `/vendor/*` | vendor | *(Stretch A)* |

### Notes
- The scanner and ticket pages must work well on a phone browser (camera permission, large result states).
- Chain reads go through a small hook layer around the Anchor client.
- Show a live pool balance and "checked in X / Y" on the host page for demo effect.

---

## 7. Core flows

### Create and join
```
Host: create_event (Phantom) -> POST /events (metadata + hash)
Member: open link -> connect Phantom -> join_event (pays fee, registers ticket_key)
Member: GET /events/{pda}/details (JWT) -> sees location and details
```

### Door
```
Host: open /scan -> generate gate key -> set_gate + fund (one-time)
Member: opens /ticket -> rotating QR
Host: scan -> verify sig locally -> check_in (gate key) -> green check
```

### Payout
```
Host: end_event (after end_ts) -> pool snapshot
Attendees: claim() each get attendee_pool / checked_in
Host: withdraw_host() -> host_budget
```

### Cancel
```
Host: cancel_event (before start) -> members refund()
```

---

## 8. Stretch A: Vendor sponsorship flow (designed)

**Idea:** vendors (food trucks, shops, venues) supply goods or services and get paid from the event pool, with the host's approval and a proof of delivery.

### Accounts
**VendorProfile** `["vendor", authority]`: `authority`, `vendor_key` (ephemeral QR signing key, like a ticket key), `name_hash`, `bump`.

**Sponsorship** `["sponsor", event, vendor]`:
| Field | Notes |
|---|---|
| event, vendor | |
| amount | Lamports requested |
| status | `Proposed, Approved, Delivered, Paid, Rejected` |
| offer_hash | Hash of off-chain offer description |
| bump | |

### Instructions
| Instruction | Signer | Behavior |
|---|---|---|
| `register_vendor(vendor_key)` | vendor | Creates VendorProfile |
| `propose_sponsorship(amount, offer_hash)` | vendor | Status = `Proposed`. Event must be `Open`. |
| `approve_sponsorship()` | host | Reserves `amount`. Tracks `event.approved_sponsor_total`; requires `approved_sponsor_total + amount <= host_budget_cap` where `host_budget_cap = pool * (10000 - payout_bps) / 10000` at the time of approval. |
| `reject_sponsorship()` | host | |
| `confirm_delivery()` | gate_authority | Vendor shows QR (signed by `vendor_key`, same format as ticket QR). Host scans, verifies, and calls this. Status = `Delivered`. |
| `settle_vendor()` | anyone | Requires `Delivered`. Pays `amount` from Vault to vendor. Status = `Paid`. |

**Interaction with MVP:** `withdraw_host` pays `host_budget - approved_sponsor_total`. Vendors are paid out of the host's share, so attendee payouts are never reduced. If the host budget cannot cover a sponsorship, approval fails.

**QR:** payload `{v, event, vendor, ts, sig}` signed by `vendor_key`, 20s rotation, verified by the scanner against the VendorProfile.

**Off-chain:** vendor profile page (name, logo, offer), sponsorship inbox on the host page. Tables: `vendors`, `sponsorship_offers`.

---

## 9. Stretch B: Graph-gated discovery (designed)

**Idea:** you only see events hosted by people you are connected to. Attending events together builds your network and unlocks more events.

### Graph definition
Discovery is driven by on-chain transactions to an event (a Ticket PDA exists). Attendance is public chain data, and that is acceptable here: the goal is in-app discovery, not hiding the graph.
- **Weak tie A-B:** both A and B hold a Ticket for the same event (paid, not necessarily checked in). Hosts count as holders of their own event.
- **Strong tie A-B:** both A and B have `Ticket.checked_in == true` for the same event. Only strong ties count toward "unlock" progress, which rewards showing up.
- **Visible to viewer V:** an event with `visibility == 'network'` is visible if the host is within **1 hop** of V by a weak or strong tie. Hosts may optionally require strong ties only. Events with `visibility == 'public'` are always visible. Hosts can always see their own events.
- Optionally **2 hops** ("friends of friends") as a setting.

### Indexing
- MVP-stretch: a route handler or cron job queries `getProgramAccounts` with a memcmp filter for `checked_in == true` Tickets and rebuilds the edge table every N seconds. This is fine at hackathon scale.
- Better: Helius webhook on `check_in` upserts edges incrementally.

```sql
attendance(event_pda text, wallet text, checked_in boolean default false,
           checked_in_at timestamptz,
           primary key (event_pda, wallet));

-- 1-hop connections for a viewer; strong = both checked in
create view connections as
select a.wallet as viewer, b.wallet as peer,
       (a.checked_in and b.checked_in) as strong
from attendance a
join attendance b on a.event_pda = b.event_pda and a.wallet <> b.wallet;
```

### Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/feed` (JWT) | Events with `visibility=public`, plus `network` events whose host is in `connections` for the viewer |
| GET | `/me/network` (JWT) | Peers, shared events, simple score (connections count, events attended) |

### Enforcement
- `GET /events/{pda}` for a `network` event returns 404 unless the viewer qualifies.
- **Limit to state honestly:** the existence of events and attendance is public on-chain data, so the graph is derivable by anyone reading the chain. What is private is the event **details** and the **feed**. The pitch is "private invites and gated details, built from on-chain proof of presence", not "invisible on chain".

### Incentive UI
Show "You are 1 event away from unlocking N more events", a connections count, and attendance badges. Optional: mint a compressed NFT at check-in as a collectible proof of attendance.

---

## 10. Threats and honest limitations
| Risk | Mitigation or note |
|---|---|
| Screenshot-shared QR | Rotating signed QR with a 30s window |
| Double check-in | On-chain `checked_in` flag |
| Host drains pool via fake attendees | **Not fully preventable in the MVP.** A malicious host can check in wallets they control. `payout_bps` is immutable and visible, entry fee is public, and a host reputation or stake is future work. State this plainly in the pitch. |
| Gate key leak | It can only call `check_in`. The host can rotate it with `set_gate`. |
| Lost ticket key | `rotate_ticket_key` |
| Cancelled event funds | Refund path, with the vault holding exact balances |
| Dust from division | Remains in the vault and goes to the host in `withdraw_host` |
| Unclaimed payouts | Future: claim deadline and sweep to host |
| Devnet faucet limits | Pre-fund wallets early; use faucet.solana.com and Helius RPC |

---

## 11. Build plan (hacking runs Fri 12:00 PM ET to Sun 11:45 AM ET; initial submission Sun 10:00 AM ET)

| Block | Work | Done when |
|---|---|---|
| **Fri eve** (3-4h) | Scaffold from the nextjs-anchor template. Replace the vault with the event_pool program. Anchor program: `create_event`, `join_event`, `check_in`, `end_event`, `claim`, `withdraw_host`. LiteSVM tests (`cargo test`). | Tests pass for the full happy path |
| **Fri night** (1-2h) | Deploy to devnet, generate IDL and TS client. | `join_event` works from a script |
| **Sat morning** (3-4h) | Web: wallet connect (from template), create event, event page, join. Route handlers: auth, metadata, gated details. | Create then join then see details in browser |
| **Sat afternoon** (3-4h) | Ticket QR page, scanner page with gate key, host dashboard. | Scan from a second phone and see check-in on chain |
| **Sat eve** (2h) | `end_event`, `claim`, `withdraw_host`, cancel and refund. | Full lifecycle demo works end to end |
| **Sat night / Sun early** | **Stretch:** pick ONE of A or B. B is cheaper (backend and UI, no new program code). A needs more on-chain code. | |
| **Sun morning** (before 10:00 AM ET) | Deploy to Vercel, write README, record demo video, submit initial entry. | Initial submission in |
| **Sun to 11:45 AM ET** | Polish and final submission. | Final submission in |

**Cut order if behind:** refund/cancel first, then stretch features, then dashboard polish. Never cut: join, QR check-in, claim.

---

## 12. Demo script (2-3 min)
1. Host creates "Rooftop Meetup" with a 0.1 SOL fee and a 30% attendee payout.
2. Two members join from different wallets. The pool balance climbs live.
3. Show gated details unlocking after joining.
4. Door scan: show the rotating QR, scan, green check, and an on-chain tx link.
5. A screenshot replay of an old QR gets rejected.
6. End event, attendees claim their share, and the host withdraws the budget.
7. Close on the stretch story: vendors paid on proof of delivery, and discovery that grows as you attend.

---

## 13. Open questions
- Name and branding
- Fixed vs. host-chosen `payout_bps` range (suggest 10-50%)
- Whether to mint a cNFT at check-in (nice but not required)
- Which stretch to build first (A or B)
