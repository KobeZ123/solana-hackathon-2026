# E2E

`npm run e2e` runs the whole program lifecycle on a real `solana-test-validator`
through the generated Codama client and `@solana/kit`, including PDA derivation,
account decoding, the `app/lib/qr` crypto path and the validator's real clock.
(The Rust LiteSVM tests cover the program in isolation.)

## Run

```bash
npm install
npm run e2e                      # builds anchor/target/deploy/event_pool.so if missing
E2E_ONLY=cancel-refund npm run e2e   # one scenario
E2E_RPC_PORT=8999 npm run e2e        # different RPC port
```

`scripts/e2e-localnet.sh` starts the validator (`--reset`, program loaded with
`--bpf-program`, ledger in a temp dir under `$TMPDIR`, which `scripts/env.sh`
points at the external volume), waits for RPC health, runs
`scripts/e2e-localnet.ts` with `npx tsx`, and always kills the validator and
removes the ledger on exit. The exit code is non-zero if any assertion fails.
Takes about 1 minute (the lifecycle scenario waits ~25 s for `end_ts`).

## Scenarios

- `lifecycle`: create (start in a few seconds, check-in grace makes it open
  immediately), 3 joins, `set_gate`, QR verify (tampered, stale and wrong-key
  payloads rejected), 2 check-ins via the gate key, wait past `end_ts`,
  `end_event`, 2 claims, non-checked-in claim fails, host withdraws; asserts
  exact lamports (pool, attendee share, host budget plus dust) and that the vault
  ends at the rent minimum (890880).
- `cancel-refund`: event 2 h out, 2 joins, cancel, 2 refunds, ticket closed,
  vault back at the rent minimum, join on cancelled event fails.

## Extending

Helpers live in `scripts/lib/`: `chain.ts` (RPC, `send`, `fundedSigner`,
`chainNow`, `waitUntilChainPast`, balances) and `harness.ts` (`check`,
`checkEq`, `checkRejects`, `runScenarios`). Add an `async` function in
`scripts/e2e-localnet.ts` and append `{ name, run }` to `SCENARIOS`.
