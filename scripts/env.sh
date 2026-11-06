#!/usr/bin/env bash
# Source this before running anchor / cargo / solana build commands:
#   source scripts/env.sh
# Why: on the original dev machine the internal disk was ~100% full, so toolchains
# and build caches are redirected to a volume with space. Override DEV_HOME to taste.
# It deliberately does NOT change HOME globally; use `scripts/with-devhome.sh <cmd>`
# for commands (anchor build, cargo build-sbf) that download platform-tools into ~/.cache.
export DEV_HOME="${DEV_HOME:-/Volumes/KobeT9/devhome}"
mkdir -p "$DEV_HOME" "$DEV_HOME/.cargo/bin"
# rustup proxies (cargo, rustc, rustup...) must live in $CARGO_HOME/bin
for f in "$HOME"/.cargo/bin/*; do [ -e "$DEV_HOME/.cargo/bin/$(basename "$f")" ] || ln -s "$f" "$DEV_HOME/.cargo/bin/$(basename "$f")"; done
# anchor version manager lives in the real home
export AVM_HOME="${AVM_HOME:-$HOME/.avm}"
export RUSTUP_HOME="$DEV_HOME/.rustup"
export CARGO_HOME="$DEV_HOME/.cargo"
export npm_config_cache="$DEV_HOME/.npm"
export PATH="$CARGO_HOME/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"
