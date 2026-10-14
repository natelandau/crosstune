#!/usr/bin/env bash
# Usage: gate-cache.sh NAME [--argc N] [--file PATH]... [--tool COMMAND]... COMMAND [ARGS...]
# Runs a lint or test gate through gate-cache, which skips it when the same gate already
# passed on the same files git does not ignore, and runs it uncached when CI is set. A
# checkout whose api environment lacks gate-cache, such as one `just setup` has not
# reached yet, runs the command itself. A run with extra args is a different gate, so a
# recipe that forwards its args passes their count with --argc and appends them to
# COMMAND: any count but 0 runs COMMAND directly, uncached.
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

argc=0
inputs=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --argc | --file | --tool)
      [[ $# -ge 2 ]] || { printf '%s\n' "gate-cache.sh: $1 needs a value" >&2; exit 2; }
      if [[ "$1" == --argc ]]; then
        argc="$2"
      else
        inputs+=("$1" "$2")
      fi
      shift 2
      ;;
    *) break ;;
  esac
done

if [[ "$argc" -ne 0 || ! -x "$gate_cache" ]]; then
  exec "$@"
fi

if [[ ${#inputs[@]} -gt 0 ]]; then
  keys=""
  for ((i = 0; i < ${#inputs[@]}; i += 2)); do
    value="${inputs[i + 1]}"
    if [[ "${inputs[i]}" == --file ]]; then
      # A missing file counts as a value of its own, so creating the file runs the gate.
      keys+="file $value: $(git hash-object -- "$value" 2> /dev/null || printf 'missing')"$'\n'
    else
      keys+="tool $value: $(bash -c "$value" 2>&1 || printf 'failed')"$'\n'
    fi
  done
  # A hash, not the values, so a secret in an ignored file never reaches a marker.
  name+="@$(printf '%s' "$keys" | shasum -a 256 | cut -c1-12)"
fi
exec "$gate_cache" --name "$name" -- "$@"
