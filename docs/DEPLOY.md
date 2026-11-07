# Deploy guide (Solana devnet + Vercel + Supabase)

Everything here targets **devnet** only. Nothing in this repo deploys to mainnet.

Program id (fixed, from the committed keypair pubkey): `E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping`

## 1. Deploy the program to devnet

Prerequisites: Solana CLI, Anchor (see `scripts/env.sh`), and the real program keypair at
`$DEV_HOME/keys/event_pool-keypair.json` (default set in `scripts/env.sh`). The keypair is
never committed or printed; the script checks its pubkey matches the id above and aborts otherwise.

```bash
bash scripts/deploy-devnet.sh
```

What it does: `anchor build --ignore-keys` (through `scripts/with-devhome.sh`), copies the program
keypair into `anchor/target/deploy/`, picks the deployer wallet (`$DEPLOYER_KEYPAIR`, else the
`solana config` keypair, else a throwaway at `$DEV_HOME/keys/devnet-deployer.json`), estimates rent
from the `.so` size (about 3.7 SOL of programdata rent for the current ~360 KB program, so it wants
about 4.5 SOL), airdrops with retries, runs `solana program deploy --program-id`, then
`solana program show`. Re-running upgrades the program in place (idempotent).

Devnet airdrops are rate limited (about 1-2 SOL per request, a few per hour per IP). If the script
cannot reach the target it exits with code 2 and prints the deployer address. Fund that address at
<https://faucet.solana.com> (choose Devnet), then re-run `bash scripts/deploy-devnet.sh`
(set `DEPLOYER_KEYPAIR` if you used a non-default wallet). `SKIP_BUILD=1` reuses the existing `.so`.

Smoke check against the live program:

```bash
npx tsx scripts/smoke-devnet.ts          # executable check, plus create_event + join_event if airdrop works
SMOKE_FULL=0 npx tsx scripts/smoke-devnet.ts   # executable check only
```

## 2. Supabase (hosted store, required on Vercel)

The default JSON-file store (`STORE_FILE`, default `.data/store.json`) does **not** persist on Vercel
serverless (read-only/ephemeral filesystem, separate instances). A hosted deploy therefore needs Supabase.
Provisioning is manual:

1. Create a project at <https://supabase.com> (free tier is fine).
2. Apply `supabase/migrations/*.sql` in filename order (currently only `0001_init.sql`). Either paste
   each file into the SQL editor and run it, or run `supabase link --project-ref <ref>` then
   `supabase db push`.
3. Settings > API: copy the project URL (`SUPABASE_URL`) and the `service_role` key
   (`SUPABASE_SERVICE_ROLE_KEY`). The service role key is server-only; never prefix it with
   `NEXT_PUBLIC_`. The API uses Supabase only when both variables are set.

## 3. RPC (Helius recommended)

The public devnet RPC works for light use but throttles. For the demo create a free key at
<https://www.helius.dev>, then use `https://devnet.helius-rpc.com/?api-key=<key>` as `SOLANA_RPC_URL`.
Note `SOLANA_RPC_URL` is read by the server API only; the browser client currently talks to the public
devnet endpoint (`app/lib/solana-client.ts`).

## 4. Vercel

1. Push the repo to GitHub, then Vercel dashboard > Add New > Project > import the repo.
2. Framework preset: **Next.js** (auto-detected). Root directory: repo root. Build command
   `next build`, no output directory override.
3. Settings > Environment Variables (Production and Preview):

| Variable                    | Value                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_PROGRAM_ID`    | `E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping`                                         |
| `SOLANA_RPC_URL`            | Helius devnet URL (section 3)                                                          |
| `JWT_SECRET`                | `openssl rand -hex 32` (required in production: the server refuses to sign without it) |
| `SUPABASE_URL`              | from Supabase (section 2)                                                              |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase (section 2)                                                              |
| `CRON_SECRET`               | `openssl rand -hex 32`                                                                 |

Do not set `STORE_FILE` on Vercel. `NEXT_PUBLIC_*` values are inlined at build time, so redeploy after
changing `NEXT_PUBLIC_PROGRAM_ID`. 4. Deploy. Open the URL; `GET /api/events` should return 200 with a JSON list.

### Cron: attendance index refresh

`/api/index/refresh` requires `Authorization: Bearer $CRON_SECRET`. It accepts `POST` and also `GET`
(added so Vercel Cron works: Vercel cron jobs issue GET requests, and when a `CRON_SECRET` env var exists
Vercel sends it as `Authorization: Bearer <CRON_SECRET>` automatically). Add a `vercel.json`:

```json
{
  "crons": [{ "path": "/api/index/refresh", "schedule": "0 8 * * *" }]
}
```

The Hobby plan only allows cron jobs that run at most once per day, and a more frequent expression makes
the deployment fail; Pro allows e.g. `*/5 * * * *`. This file is not committed because the schedule is a
plan-dependent choice. The feed also refreshes on demand (throttled), so cron is a convenience, not a
requirement. External scheduler alternative:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/index/refresh
```

## 5. Phantom on devnet

1. Install Phantom (browser extension or mobile).
2. Settings > Developer Settings > turn on **Testnet Mode**, then choose **Solana Devnet**.
3. Fund the wallet: copy the address, request SOL at <https://faucet.solana.com> (Devnet), or
   `solana airdrop 2 <address> --url devnet`. Each ticket needs the entry fee plus a few thousand lamports of rent/fees.
4. Make sure the app's cluster selector is on devnet.

## 6. Pre-demo checklist

- [ ] `solana program show E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping --url devnet` shows the program, not "Unable to find".
- [ ] `npx tsx scripts/smoke-devnet.ts` prints PASS.
- [ ] Vercel env vars set; latest deployment is Production and green; `/api/events` returns 200.
- [ ] Supabase migrations applied; `JWT_SECRET` and `CRON_SECRET` are set.
- [ ] Helius key works (no 429s) and is not committed anywhere.
- [ ] Host and member wallets each hold at least 1 devnet SOL (Phantom in devnet mode).
- [ ] The scanning phone/laptop opens the site over **HTTPS** and camera permission is granted.
- [ ] Do one full dry run: create event, join with a second wallet, show the QR, check in, end event.
- [ ] A fallback browser profile is ready in case the camera or extension misbehaves.

## 7. Troubleshooting

- **Blockhash not found / expired**: the transaction sat too long before sending (wallet prompt left
  open) or the RPC lags. Retry; if persistent switch to the Helius RPC.
- **Insufficient funds for rent / "Attempt to debit an account but found no record of a prior credit"**: the
  wallet is empty or below the rent-exempt minimum for the new account. Airdrop devnet SOL. For the deploy
  itself, the deployer needs about 4.5 SOL (see section 1).
- **Wrong cluster / "program not found" / accounts missing**: Phantom or the app is on mainnet/testnet, or
  `NEXT_PUBLIC_PROGRAM_ID` does not match the deployed id. Check Phantom Testnet Mode > Solana Devnet and the
  app's cluster selector; redeploy Vercel after changing the id.
- **Camera does not start**: browsers only expose the camera on HTTPS (or localhost). Use the Vercel URL,
  not an `http://<lan-ip>` URL; grant the permission in the site settings.
- **Ticket QR missing after clearing browser data**: the ticket key is kept in `localStorage`. If it is
  cleared, open the ticket page (`/events/<pda>/ticket`) and use **Recover ticket**: it sends the
  `rotate_ticket_key` instruction (one wallet approval) to bind a fresh key to the same ticket, and the
  QR works again. This is only possible before the ticket has been checked in.
- **API returns 503 about JWT_SECRET or CRON_SECRET**: the variable is missing in that Vercel environment.
- **Data disappears between requests on Vercel**: Supabase vars are unset, so the ephemeral file store is in
  use. Set both Supabase variables.
- **Airdrop `429` / "rate limit reached"**: wait and retry, use <https://faucet.solana.com>, or ask a teammate to send SOL.
