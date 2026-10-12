#!/usr/bin/env bash
# Usage: gate.sh NAME COMMAND [ARGS...]
# Runs a lint or test gate through gate-cache, which skips it when the same gate already
# passed on the same git tree. CI always runs the command itself, and so does a checkout
# whose api environment lacks gate-cache, such as one `just setup` has not reached yet.
# A run with extra args is a different gate, so recipes send only their bare form here.
set -euo pipefail

name="$1"
shift
gate_cache="$(dirname "$0")/../api/.venv/bin/gate-cache"
if [[ -z "${CI:-}" && -x "$gate_cache" ]]; then
  exec "$gate_cache" --name "$name" -- "$@"
fi
exec "$@"
