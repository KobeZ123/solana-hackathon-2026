## Solana Hackathon 2026

by: Kobe Zheng

This is a project built for the Solana 2026 hackathon: https://www.mlh.com/events/solana-hackathon

# SOLSocial

**Event hosting and community-building, on-chain.** SOLSocial turns every RSVP into a small Solana payment, so hosts know who is really coming, the event is funded before it starts, and the people who show up get rewarded.

How the transaction makes planning easier:
- **Real headcount.** Joining is a payment, so tickets sold means committed guests, not maybes.
- **Funded up front.** Entry fees pool into an on-chain escrow (a PDA vault), so the host isn't fronting the cost.
- **Showing up pays.** After the event, a host-chosen share of the pool (10-50%, fixed on-chain) is split equally among guests who checked in.
- **Fast, fraud-resistant door.** The ticket is a signed QR that refreshes every 20 seconds. The host scans it and the check-in is recorded on-chain.
- **Vendors get paid automatically**: propose a sponsorship, host approves, scan a delivery QR, get paid from the pool.
- **Community that compounds**: events can be visible only to people you've attended events with, so showing up widens your circle.

Pitch, talking points and app copy: [docs/PITCH.md](docs/PITCH.md)

Design: [docs/DESIGN.md](docs/DESIGN.md) · Work breakdown and status: [docs/TICKETS.md](docs/TICKETS.md) · **Handoff / current state: [docs/HANDOFF.md](docs/HANDOFF.md)** · Deploy: [docs/DEPLOY.md](docs/DEPLOY.md) · E2E: [docs/E2E.md](docs/E2E.md)

## Why Solana
- Per-person payouts, QR check-ins and vendor settlements are many tiny transactions; at fractions of a cent each they are viable, on other chains they are not.
- Escrow rules live in a program: the host cannot change the payout split, and attendees claim their own share, so there is no trusted middleman holding the pool.
- Attendance is on-chain proof of presence, which also drives discovery.

## Architecture
```
Next.js 16 app (React 19, Tailwind v4)           Anchor program `event_pool`
  UI pages (member / host / scanner / vendor)  -->   events, tickets, vault PDA, payouts,
  /api route handlers (auth, events, feed)           vendors, sponsorships
        |                                             ^
        +--> Supabase Postgres (or JSON file store)   |
        +--> RPC (Helius / devnet) ---- Codama-generated @solana/kit client
```
- **Program** (`anchor/programs/event_pool`): Anchor 1.1.2, LiteSVM tests.
- **Client**: `app/generated/event_pool` is generated from the IDL by Codama and committed.
- **QR tickets**: each member gets an ephemeral ticket key (registered on-chain at join) that signs a QR payload every 20 s with no wallet popups; the scanner verifies the signature locally against the on-chain key. The host's scanner uses an ephemeral *gate key* authorized once via `set_gate`, so checking in 100 people needs no wallet popups either.
- **Gated details and discovery**: the API checks on-chain ticket ownership before releasing event details, and builds the "mutual events" graph from on-chain tickets.

## Quickstart
Prereqs: Node 22, Rust, Solana CLI (agave) and Anchor 1.1.2 (`curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash`).
```bash
source scripts/env.sh          # optional: redirects toolchain caches (see HANDOFF.md)
npm install
cp .env.example .env.local     # all optional for local dev
npm run dev                    # http://localhost:3000
```
Connect Phantom set to **Devnet** (Settings > Developer Settings > Testnet Mode). Local dev works without Supabase (JSON-file store) but needs a deployed program on the cluster you use: see [docs/DEPLOY.md](docs/DEPLOY.md), or run against localnet (`solana-test-validator` with the program loaded; select "localnet" in the header).

## Demo data
`npm run seed` starts a local validator and fills the app with demo events, vendors, claims and a refund, all free. See [docs/SEED.md](docs/SEED.md).

## Tests
```bash
cd anchor && ../scripts/with-devhome.sh anchor build --ignore-keys && ../scripts/with-devhome.sh cargo test   # program (LiteSVM)
npm run test                  # vitest: QR crypto, API, scan/payout logic, UI helpers
npm run lint && npx tsc --noEmit && npm run build
npm run e2e                   # real solana-test-validator, Codama client, QR crypto (see docs/E2E.md)
```

## Demo script (2-3 min)
1. Host creates "Rooftop Meetup": 0.1 SOL fee, 30% attendee payout.
2. Two members join from different wallets; the pool balance climbs live. Details unlock after joining.
3. Door: member shows the rotating QR, host scans it (green check, on-chain tx). A screenshot of an old QR is rejected.
4. End the event: attendees claim their share, the host withdraws the budget.
5. Stretch: a vendor proposes a sponsorship, the host approves, a delivery QR is scanned, the vendor is paid from the pool. The network page shows how attending events unlocks more events.

## Known limitations
- A malicious host can check in wallets they control and take the attendee pool. The payout split is fixed and visible on-chain, but host collusion is not prevented in this version (idea: host stake/reputation).
- On-chain attendance is public; what is gated is event *details* and the in-app *feed*, not the existence of events on-chain.
- Event details are access-controlled by the server, not encrypted per ticket holder.
- See [docs/HANDOFF.md](docs/HANDOFF.md) for what has and has not been verified (no real-wallet browser run yet).
