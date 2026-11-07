# Demo data (free, local)

`npm run seed` fills the app with realistic demo events without spending anything. It starts a local
`solana-test-validator` with the program loaded, creates throwaway wallets (funded from the free local
faucet), and drives the real generated client to build the data. It also writes the matching event details
and vendor offers into the API's JSON store (`.data/store.json`).

## Use it
```bash
# terminal 1: start validator + seed (stays running; Ctrl-C stops it and discards everything)
SEED_FUND=<your-phantom-address> npm run seed      # SEED_FUND is optional: airdrops 50 free localnet SOL to you

# terminal 2: run the app pointed at the local validator
SOLANA_RPC_URL=http://127.0.0.1:8899 npm run dev
```
Then choose **localnet** in the app header. In Phantom: Settings > Developer Settings > Testnet Mode >
Solana Localnet (if your version offers it). If you already have a dev server running, restart it with the
`SOLANA_RPC_URL` above, otherwise the API cannot read the local chain.

## What it creates
| Event | State | Shows off |
|---|---|---|
| Friday Night Jam | live now, 9 joined, 6 checked in | scanner, host dashboard |
| Rooftop Sunset Meetup | upcoming, 7 joined | vendor sponsorships: one approved, one pending |
| Saturday Board Game Night | upcoming, 11 of 12 spots | nearly full |
| Builder Breakfast | upcoming, 3 joined | low fee |
| Solana Study Circle (members only) | upcoming, network visibility | hidden unless you are connected |
| Hack Night Recap | ended, 6 checked in, 3 claimed | payouts, a settled vendor |
| Lakeside Picnic (cancelled) | cancelled, 1 refunded | refunds |

The data is spread over 2 hosts, 16 members and 3 vendors; members are reused across events,
so the connection graph has real ties between those wallets. Your own wallet is not part of that graph until
you attend an event, so the members-only event stays hidden from you at first, which is the intended behavior.

## Notes
- The seeded wallets are throwaway and their keys are discarded, so you cannot act as the seeded hosts; host and
  join with your own wallet.
- Seeding moves any existing `.data/store.json` to `.data/store.json.bak-<timestamp>` first, because a fresh
  validator invalidates old events. Delete the backup when you no longer need it.
- Takes about two to three minutes (the "Hack Night Recap" window must close so it can be settled).
- It targets localnet only. Seeding devnet would work with the same script once the program is deployed there and
  `E2E_RPC_URL` points at devnet with funded wallets, but the public faucet makes that impractical.
