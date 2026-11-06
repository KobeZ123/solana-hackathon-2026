#!/usr/bin/env bash
# Run a command with HOME redirected to $DEV_HOME so ~/.cache/solana (platform-tools)
# and other home-relative caches land on a volume with space.
# Usage: scripts/with-devhome.sh anchor build --ignore-keys
set -euo pipefail
source "$(dirname "$0")/env.sh"
SRC_HOME="$HOME"
mkdir -p "$DEV_HOME/.config"
# keep solana CLI config / wallet visible if present
[ -d "$SRC_HOME/.config/solana" ] && [ ! -e "$DEV_HOME/.config/solana" ] && ln -s "$SRC_HOME/.config/solana" "$DEV_HOME/.config/solana"
export HOME="$DEV_HOME"
exec "$@"
