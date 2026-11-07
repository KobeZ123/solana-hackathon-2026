#!/usr/bin/env bash
# Localnet end-to-end run: build the program if needed, start solana-test-validator
# with it loaded, run scripts/e2e-localnet.ts, always stop the validator.
# Usage: npm run e2e   (env: E2E_RPC_PORT=8899, E2E_ONLY=<scenario>)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/env.sh   # DEV_HOME, TMPDIR on the external volume, solana on PATH

PROGRAM_ID="E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping"
SO="$ROOT/anchor/target/deploy/event_pool.so"
RPC_PORT="${E2E_RPC_PORT:-8899}"
export E2E_RPC_PORT="$RPC_PORT"

if [ ! -f "$SO" ]; then
  echo "[e2e] building program ($SO missing)"
  (cd anchor && ../scripts/with-devhome.sh anchor build --ignore-keys)
fi

LEDGER="$(mktemp -d "$TMPDIR/e2e-ledger.XXXXXX")"
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

echo "[e2e] starting solana-test-validator (ledger $LEDGER, rpc port $RPC_PORT)"
solana-test-validator --reset --quiet \
  --ledger "$LEDGER/ledger" \
  --rpc-port "$RPC_PORT" \
  --bpf-program "$PROGRAM_ID" "$SO" >"$LOG" 2>&1 &
VPID=$!

for i in $(seq 1 90); do
  if ! kill -0 "$VPID" 2>/dev/null; then
    echo "[e2e] validator exited early:"; tail -30 "$LOG"; exit 1
  fi
  if curl -s -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    "http://127.0.0.1:$RPC_PORT" 2>/dev/null | grep -q '"ok"'; then
    echo "[e2e] validator healthy after ${i}s"
    break
  fi
  if [ "$i" = 90 ]; then echo "[e2e] validator not healthy in time:"; tail -30 "$LOG"; exit 1; fi
  sleep 1
done

set +e
npx tsx scripts/e2e-localnet.ts
STATUS=$?
set -e
exit "$STATUS"
