#!/usr/bin/env bash
# Usage: gate.sh NAME COMMAND [ARGS...]
# Runs a lint or test gate through gate-cache, which skips it when the same gate already
# passed on the same git tree. CI always runs the command itself, and so does a checkout
# whose api environment lacks gate-cache, such as one `just setup` has not reached yet.
# A run with extra args is a different gate, so recipes send only their bare form here.
set -euo pipefail

name="$1"
shift
root="$(cd "$(dirname "$0")/.." && pwd)"
gate_cache="$root/api/.venv/bin/gate-cache"
# Git hands hooks in a linked worktree GIT_DIR alone, which makes git take the current
# directory, a module here, for the top of the tree and see every other file as changed.
if [[ -n "${GIT_DIR:-}" && -z "${GIT_WORK_TREE:-}" ]]; then
  export GIT_WORK_TREE="$root"
fi
if [[ -z "${CI:-}" && -x "$gate_cache" ]]; then
  exec "$gate_cache" --name "$name" -- "$@"
fi
exec "$@"
