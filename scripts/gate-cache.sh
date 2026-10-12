#!/usr/bin/env bash
# Usage: gate-cache.sh NAME [--file PATH]... [--tool COMMAND]... COMMAND [ARGS...]
# Runs a lint or test gate through gate-cache, which skips it when the same gate already
# passed on the same files git does not ignore, and runs it uncached when CI is set. A
# checkout whose api environment lacks gate-cache, such as one `just setup` has not
# reached yet, runs the command itself. A run with extra args is a different gate, so
# recipes send only their bare form here.
#
# gate-cache keys a pass on the name and the files alone. A gate that also reads an
# ignored file names it with --file, and one whose result depends on a tool no lockfile
# pins names the command that prints its version with --tool. Their hash joins the gate
# name, so a change to either runs the gate again.
set -euo pipefail

name="$1"
shift
root="$(cd "$(dirname "$0")/.." && pwd)"
gate_cache="$root/api/.venv/bin/gate-cache"
cached=0
if [[ -x "$gate_cache" ]]; then
  cached=1
fi

inputs=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file | --tool)
      [[ $# -ge 2 ]] || { printf '%s\n' "gate-cache.sh: $1 needs a value" >&2; exit 2; }
      if [[ "$cached" -eq 1 ]]; then
        if [[ "$1" == --file ]]; then
          # A missing file counts as a value of its own, so creating the file runs the gate.
          inputs+="file $2: $(git hash-object -- "$2" 2> /dev/null || printf 'missing')"$'\n'
        else
          inputs+="tool $2: $(bash -c "$2" 2>&1 || printf 'failed')"$'\n'
        fi
      fi
      shift 2
      ;;
    *) break ;;
  esac
done

if [[ "$cached" -eq 1 ]]; then
  if [[ -n "$inputs" ]]; then
    # A hash, not the values, so a secret in an ignored file never reaches a marker.
    name+="@$(printf '%s' "$inputs" | shasum -a 256 | cut -c1-12)"
  fi
  exec "$gate_cache" --name "$name" -- "$@"
fi
exec "$@"
