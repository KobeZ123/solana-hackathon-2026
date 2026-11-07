# SOLSocial development

## Run locally

Use Node.js 22 for the web app. To build or test the on-chain program or run the seeded local demo, install Rust, the Solana CLI, and Anchor 1.1.2.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). The app can use the deployed program on Devnet with Phantom in testnet mode. For a local validator with sample events, vendor offers, and payouts, follow the [demo data setup](SEED.md). For hosted storage and RPC configuration, see [deployment](DEPLOY.md).

The web app can use a JSON file for local storage. To move toolchain caches to another volume, source `scripts/env.sh` before running build or test commands. See the [handoff](HANDOFF.md) for the toolchain setup used during development.

## Architecture

- The Next.js app uses React and Tailwind for event discovery, tickets, host tools, and vendor flows. API routes handle wallet sign-in, event details, and the network feed.
- The Anchor program in [anchor/programs/event_pool](../anchor/programs/event_pool) manages event accounts, tickets, escrow, attendee claims, and vendor settlement. Codama generates the typed Solana Kit client in [app/generated/event_pool](../app/generated/event_pool).
- The backend uses Supabase Postgres in hosted environments or a JSON file locally. It checks on-chain ticket ownership before releasing gated event details and builds the shared-attendance graph from ticket accounts.
- Each ticket has a short-lived QR payload signed by a key registered on-chain when the guest joins. The scanner verifies the signature against that key. The host authorizes a gate key once so staff can scan multiple tickets without a wallet prompt for each guest.

See the [design notes](DESIGN.md) for the program and application design.

## Run checks

```bash
npm run test
npm run lint
npx tsc --noEmit
npm run build
npm run e2e
```

The [end-to-end guide](E2E.md) explains the local validator tests. For the Anchor build and LiteSVM tests, run this from the repo root:

```bash
(cd anchor && ../scripts/with-devhome.sh anchor build --ignore-keys && ../scripts/with-devhome.sh cargo test)
```
