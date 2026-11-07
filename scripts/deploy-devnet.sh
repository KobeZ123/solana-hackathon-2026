#!/usr/bin/env bash
# Build and deploy the event_pool program to Solana DEVNET (never mainnet). Idempotent:
# re-running upgrades the existing program in place.
#
#   bash scripts/deploy-devnet.sh
#
# Env overrides:
#   DEV_HOME          toolchain/key home (default /Volumes/KobeT9/devhome)
#   DEPLOYER_KEYPAIR  deployer wallet keypair (default: `solana config` keypair, else a
#                     throwaway at $DEV_HOME/keys/devnet-deployer.json)
#   RPC_URL           devnet RPC (default https://api.devnet.solana.com)
#   AIRDROP_TRIES     max airdrop attempts (default 6)
#   SKIP_BUILD=1      reuse an existing anchor/target/deploy/event_pool.so
# No secret is ever printed. Keys live outside the repo.
set -euo pipefail

EXPECTED_ID="E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
AIRDROP_TRIES="${AIRDROP_TRIES:-6}"
FAUCET="https://faucet.solana.com"
DEPLOY_DIR="$ROOT/anchor/target/deploy"
SO="$DEPLOY_DIR/event_pool.so"
PROGRAM_KP="$DEPLOY_DIR/event_pool-keypair.json"
SRC_KP="$DEV_HOME/keys/event_pool-keypair.json"

case "$RPC_URL" in *mainnet*) echo "refusing: mainnet RPC"; exit 1 ;; esac

# 1. Build
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "== anchor build"
  (cd "$ROOT/anchor" && "$ROOT/scripts/with-devhome.sh" anchor build --ignore-keys)
fi
[ -f "$SO" ] || { echo "missing $SO (build failed?)"; exit 1; }

# 2. Program keypair (verify pubkey, never print the secret)
[ -f "$SRC_KP" ] || { echo "missing program keypair $SRC_KP"; exit 1; }
GOT_ID="$(solana-keygen pubkey "$SRC_KP")"
if [ "$GOT_ID" != "$EXPECTED_ID" ]; then
  echo "program keypair pubkey is $GOT_ID, expected $EXPECTED_ID; aborting"; exit 1
fi
mkdir -p "$DEPLOY_DIR"
cp "$SRC_KP" "$PROGRAM_KP"
chmod 600 "$PROGRAM_KP"
echo "program id: $GOT_ID"

# 3. Deployer wallet
if [ -z "${DEPLOYER_KEYPAIR:-}" ]; then
  CFG_KP="$(solana config get | sed -n 's/^Keypair Path: //p')"
  if [ -n "$CFG_KP" ] && [ -f "$CFG_KP" ]; then DEPLOYER_KEYPAIR="$CFG_KP"
  else DEPLOYER_KEYPAIR="$DEV_HOME/keys/devnet-deployer.json"; fi
fi
if [ ! -f "$DEPLOYER_KEYPAIR" ]; then
  echo "creating throwaway devnet deployer at $DEPLOYER_KEYPAIR"
  mkdir -p "$(dirname "$DEPLOYER_KEYPAIR")"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$DEPLOYER_KEYPAIR" >/dev/null
  chmod 600 "$DEPLOYER_KEYPAIR"
fi
DEPLOYER="$(solana-keygen pubkey "$DEPLOYER_KEYPAIR")"
echo "deployer: $DEPLOYER"

# 4. Estimate rent: program data account = 2 * .so size (room for upgrades) + header
SIZE="$(wc -c < "$SO" | tr -d ' ')"
DATA_LEN=$((SIZE * 2 + 45))
RENT_SOL="$(solana rent "$DATA_LEN" --url "$RPC_URL" | sed -n 's/^Rent-exempt minimum: \([0-9.]*\) SOL.*/\1/p')"
# the deploy also holds a temporary buffer account (~ .so size) + fees: want rent * 1.2 + 0.1
NEED="$(awk -v r="${RENT_SOL:-3}" 'BEGIN{printf "%.2f", r*1.2+0.1}')"
echo ".so is $SIZE bytes; programdata rent ~${RENT_SOL:-?} SOL; want balance >= $NEED SOL"

balance() { solana balance "$DEPLOYER" --url "$RPC_URL" 2>/dev/null | awk '{print $1}' || true; }
BAL="$(balance)"; BAL="${BAL:-0}"
echo "balance: $BAL SOL"

# 5. Airdrop with retries (the devnet faucet is rate limited)
try=0
while awk -v b="$BAL" -v n="$NEED" 'BEGIN{exit !(b<n)}'; do
  try=$((try + 1))
  if [ "$try" -gt "$AIRDROP_TRIES" ]; then
    echo "airdrop did not reach $NEED SOL (balance $BAL)."
    echo "Fund $DEPLOYER manually at $FAUCET (devnet), then re-run:"
    echo "  DEPLOYER_KEYPAIR=$DEPLOYER_KEYPAIR bash scripts/deploy-devnet.sh"
    exit 2
  fi
  amt=2; [ "$try" -gt 2 ] && amt=1
  echo "airdrop attempt $try/$AIRDROP_TRIES ($amt SOL)"
  if solana airdrop "$amt" "$DEPLOYER" --url "$RPC_URL" >/dev/null 2>&1; then
    echo "  ok"
  else
    echo "  rate limited/failed; waiting $((try * 15))s"
    sleep $((try * 15))
  fi
  BAL="$(balance)"; BAL="${BAL:-0}"
  echo "  balance: $BAL SOL"
done

# 6. Deploy / upgrade
echo "== deploying to devnet"
solana program deploy "$SO" --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" \
  --program-id "$PROGRAM_KP" --max-sign-attempts "${MAX_SIGN_ATTEMPTS:-100}" --use-rpc

# 7. Verify
echo "== solana program show"
solana program show "$GOT_ID" --url "$RPC_URL"
echo "DEPLOYED program id: $GOT_ID (devnet)"
echo "Next: npx tsx scripts/smoke-devnet.ts"
