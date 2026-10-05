#!/usr/bin/env bash
# Runs the Debug Mac app from one fixed path, shared by every checkout and worktree, one at a
# time. The login keychain trusts an app by its path and signature, so a build launched from
# its own DerivedData asks for the keychain password once per Clerk item in every new worktree.
#
# A worktree holds a lease from `run` until `done`, across as many commands as its checks
# take. Builds run in parallel; only installing and running the app waits its turn, oldest
# waiter first. A lease whose worktree is gone, or that no `run` has renewed in
# LEASE_TTL seconds, is taken over so a crashed session can't block the rest.
set -euo pipefail

usage="usage: $0 run [app args...] | done | status"

state="$HOME/Library/Caches/crosstune/mac-app"
lease="$state/lease"
queue="$state/queue"
mkdir -p "$HOME/Applications"
# Resolved, since the app's process path is what quitting it matches and ~/Applications may be a link
dest="$(cd "$HOME/Applications" && pwd -P)/Crosstune Dev.app"
ttl="${LEASE_TTL:-900}"

me="$(git rev-parse --show-toplevel)"
apple="$me/apple"
# Apart from `just apple::build`, whose unsigned Debug products fail the signed build here
derived="$apple/.build/RunDerivedData"

now() { date +%s; }

owner() { cat "$lease/owner" 2>/dev/null || true; }

renewed() {
  local at
  at="$(cat "$lease/renewed" 2>/dev/null || true)"
  printf '%s\n' "${at:-0}"
}

# Atomic, so a reader never sees the file empty between truncate and write
renew() { now > "$lease/renewed.tmp" && mv -f "$lease/renewed.tmp" "$lease/renewed"; }

stale() {
  local holder
  holder="$(owner)"
  [[ -z "$holder" || ! -d "$holder" ]] && return 0
  (($(now) - $(renewed) > ttl))
}

# A ticket is named for its arrival time and its waiter's pid, so glob order is arrival order
# and a waiter that died without cleaning up can be dropped. The pid must still run this
# script, since a reused pid would otherwise hold the head of the queue forever.
live_tickets() {
  local path ticket
  for path in "$queue"/*; do
    [[ -e "$path" ]] || continue
    ticket="${path##*/}"
    if [[ "$(ps -p "${ticket#*-}" -o command= 2>/dev/null)" == *mac-app.sh* ]]; then
      printf '%s\n' "$ticket"
    else
      rm -f "$path"
    fi
  done
}

quit_app() {
  pkill -f "^$dest/Contents/MacOS/" 2>/dev/null || true
  for _ in $(seq 1 50); do
    pgrep -f "^$dest/Contents/MacOS/" > /dev/null || return 0
    sleep 0.2
  done
  pkill -9 -f "^$dest/Contents/MacOS/" 2>/dev/null || true
}

# Renewing fails once the lease has moved, so a holder that lost it queues instead
held() { [[ "$(owner)" == "$me" ]] && renew 2>/dev/null; }

claim() {
  held && return

  mkdir -p "$queue"
  local ticket shown=""
  ticket="$(now)-$$"
  touch "$queue/$ticket"
  trap 'rm -f "$queue/$ticket"' EXIT

  while true; do
    if held; then
      rm -f "$queue/$ticket"
      trap - EXIT
      return
    fi
    # Only the oldest waiter contends, so a stale lease has one taker
    if [[ "$(live_tickets | head -n 1)" == "$ticket" ]]; then
      if [[ -d "$lease" ]] && stale; then
        # Moved aside before the final check, so a holder renewing in between either lands
        # first and keeps the lease, or finds it gone and queues
        local aside="$state/stale.$$"
        if mv "$lease" "$aside" 2>/dev/null; then
          if lease="$aside" stale; then
            printf '%s\n' "taking over the lease from $(lease="$aside" owner) (stale)"
            rm -rf "$aside"
          else
            mv "$aside" "$lease"
          fi
        fi
      fi
      if mkdir "$lease" 2>/dev/null; then
        printf '%s\n' "$me" > "$lease/owner"
        renew
        rm -f "$queue/$ticket"
        trap - EXIT
        return
      fi
    fi
    local holder
    holder="$(owner)"
    # Empty while a new holder is still writing its name
    if [[ -n "$holder" && "$holder" != "$shown" ]]; then
      printf '%s\n' "waiting for the Mac app: held by $holder"
      shown="$holder"
    fi
    sleep 2
  done
}

run() {
  # Signed, so the keychain sees the same identity from every worktree
  xcodebuild build -quiet -project "$apple/Crosstune.xcodeproj" -scheme Crosstune \
    -configuration Debug -destination 'platform=macOS' -derivedDataPath "$derived"
  claim
  quit_app
  rm -rf "$dest"
  ditto "$derived/Build/Products/Debug/Crosstune.app" "$dest"
  open -g -n "$dest" --args "$@"
  printf '%s\n' "running $dest for $me; finish with: just apple::done"
}

finish() {
  if [[ "$(owner)" != "$me" ]]; then
    printf '%s\n' "this worktree does not hold the Mac app (holder: $(owner))"
    return
  fi
  quit_app
  rm -rf "$lease"
  printf '%s\n' "released the Mac app"
}

status() {
  if [[ -d "$lease" ]]; then
    local age=$(($(now) - $(renewed)))
    printf '%s\n' "held by $(owner), renewed ${age}s ago$(stale && echo ', stale' || true)"
  else
    printf '%s\n' "free"
  fi
  printf '%s waiting\n' "$(live_tickets | wc -l | tr -d ' ')"
}

case "${1:-}" in
  run) shift; run "$@" ;;
  done) finish ;;
  status) status ;;
  *) printf '%s\n' "$usage" >&2; exit 2 ;;
esac
