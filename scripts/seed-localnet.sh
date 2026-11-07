#!/usr/bin/env bash
# Start a local validator with the program, seed demo data, and KEEP the validator running so the
# app can use it. Ctrl-C stops the validator and removes its ledger.
# Usage: npm run seed      (env: SEED_FUND=<wallet,wallet> to airdrop free localnet SOL to you,
#                           E2E_RPC_PORT=8899, STORE_FILE=.data/store.json)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/env.sh   # DEV_HOME, TMPDIR on the dev volume, solana on PATH

PROGRAM_ID="E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping"
SO="$ROOT/anchor/target/deploy/event_pool.so"
RPC_PORT="${E2E_RPC_PORT:-8899}"
export E2E_RPC_PORT="$RPC_PORT"
export STORE_FILE="${STORE_FILE:-.data/store.json}"

if [ ! -f "$SO" ]; then
  echo "[seed] building program ($SO missing)"
  (cd anchor && ../scripts/with-devhome.sh anchor build --ignore-keys)
fi

# A fresh validator invalidates any events recorded by an earlier run: keep a copy, start clean.
if [ -f "$STORE_FILE" ]; then
  BAK="$STORE_FILE.bak-$(date +%s)"
  mv "$STORE_FILE" "$BAK"
  echo "[seed] moved existing API store to $BAK"
fi

LEDGER="$(mktemp -d "$TMPDIR/seed-ledger.XXXXXX")"
LOG="$LEDGER/validator.log"
VPID=""
cleanup() {
  if [ -n "$VPID" ] && kill -0 "$VPID" 2>/dev/null; then
    kill "$VPID" 2>/dev/null || true
    wait "$VPID" 2>/dev/null || true
  fi
  rm -rf "$LEDGER"
}
trap cleanup EXIT INT TERM

echo "[seed] starting solana-test-validator (rpc port $RPC_PORT)"
solana-test-validator --reset --quiet \
  --ledger "$LEDGER/ledger" \
  --rpc-port "$RPC_PORT" \
  --bpf-program "$PROGRAM_ID" "$SO" >"$LOG" 2>&1 &
VPID=$!

for i in $(seq 1 90); do
  if ! kill -0 "$VPID" 2>/dev/null; then
    echo "[seed] validator exited early:"; tail -30 "$LOG"; exit 1
  fi
  if curl -s -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    "http://127.0.0.1:$RPC_PORT" 2>/dev/null | grep -q '"ok"'; then
    echo "[seed] validator healthy after ${i}s"
    break
  fi
  if [ "$i" = 90 ]; then echo "[seed] validator not healthy in time:"; tail -30 "$LOG"; exit 1; fi
  sleep 1
done

npx tsx scripts/seed-localnet.ts

cat <<MSG

[seed] The validator is running at http://127.0.0.1:$RPC_PORT. In a second terminal start the app:

    SOLANA_RPC_URL=http://127.0.0.1:$RPC_PORT npm run dev

Then pick "localnet" in the app header. For Phantom: Settings > Developer Settings > Testnet Mode >
Solana Localnet (if your Phantom version offers it). Press Ctrl-C here to stop and discard everything.
MSG
wait "$VPID"
