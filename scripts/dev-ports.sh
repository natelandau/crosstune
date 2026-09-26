#!/usr/bin/env bash
# Preflight for `just dev`: the API and web client need their ports free, and honcho
# stops both the moment either fails to bind. A server from an earlier session that
# outlived its terminal is the usual holder, so this names it and offers to stop it.
set -euo pipefail

usage="usage: $0 <port>..."
[[ $# -gt 0 ]] || { printf '%s\n' "$usage" >&2; exit 2; }

# The main checkout, so a server started from any worktree counts as ours
repo="$(cd "$(git rev-parse --git-common-dir)/.." && pwd -P)"

cwd_of() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; }

# A live `just dev` has honcho above its servers; a leftover has lost it
honcho_above() {
  local pid="$1"
  while [[ "$pid" -gt 1 ]]; do
    pid="$(ps -o ppid= -p "$pid" | tr -d ' ')"
    [[ -n "$pid" ]] || return 1
    if ps -o command= -p "$pid" | grep -q honcho; then
      printf '%s\n' "$pid"
      return 0
    fi
  done
  return 1
}

wait_free() {
  local port="$1"
  for _ in $(seq 1 20); do
    lsof -tiTCP:"$1" -sTCP:LISTEN > /dev/null 2>&1 || return 0
    sleep 0.5
  done
  return 1
}

held=0
for port in "$@"; do
  pids="$({ lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true; } | sort -u | tr "\n" " ")"
  [[ -n "$pids" ]] || continue

  ours=1
  live=""
  for pid in $pids; do
    case "$(cwd_of "$pid")/" in
      "$repo"/*) ;;
      *) ours=0 ;;
    esac
    live="${live:-$(honcho_above "$pid" || true)}"
  done

  printf '%s\n' "port $port is already in use:" >&2
  # shellcheck disable=SC2086
  ps -o pid=,lstart=,command= -p ${pids// /,} | sed 's/^/  /' >&2

  if [[ "$ours" -eq 0 ]]; then
    printf '%s\n' "that is not a Crosstune server; stop it or free port $port, then run 'just dev' again" >&2
    held=1
    continue
  fi

  if [[ -n "$live" ]]; then
    printf '%s\n' "it belongs to a running 'just dev' (honcho pid $live); Ctrl-C that session, or stop it here" >&2
    prompt="stop that session and continue? [y/N] "
    default=n
  else
    printf '%s\n' "it is a Crosstune server left over from an earlier session" >&2
    prompt="stop it and continue? [Y/n] "
    default=y
  fi

  if [[ ! -t 0 ]]; then
    printf '%s\n' "stop it with: kill $pids" >&2
    held=1
    continue
  fi

  read -r -p "$prompt" answer || { printf '\n' >&2; answer=n; }
  answer="${answer:-$default}"
  case "$answer" in
    [Yy]*) ;;
    *) held=1; continue ;;
  esac

  # shellcheck disable=SC2086
  kill $pids ${live:+$live} 2>/dev/null || true
  if ! wait_free "$port"; then
    printf '%s\n' "port $port is still held after stopping $pids" >&2
    held=1
  fi
done

exit "$held"
