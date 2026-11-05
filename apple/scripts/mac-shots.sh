#!/usr/bin/env bash
# Captures Mac app surfaces over the sample catalog, for a design pass. Each name is a launch:
# the app opens on that surface through `-SampleShell -SampleScreen <name>` (or a Settings tab
# through `settings-<tab>`), and every window it shows, sheets included, is saved by window id,
# which works while the app stays in the background. Runs through mac-app.sh, so it waits its
# turn for the shared install and always releases it.
set -euo pipefail

usage="usage: $0 [--out DIR] [--appearance light|dark] [--settle SECONDS] name... [-- app args...]
names: the cases of SampleScreen (Sample/SampleScreen.swift), such as catalog, tune, tune-new,
plan, welcome, or settings-<tab> for a Settings tab: general, account, tunes, recordings, importExport"

apple="$(git rev-parse --show-toplevel)/apple"
out="$apple/.build/shots"
appearance=""
settle=3
limit=20
names=()
extra=()
while (($#)); do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --appearance) appearance="$2"; shift 2 ;;
    --settle) settle="$2"; shift 2 ;;
    -h | --help) printf '%s\n' "$usage"; exit 0 ;;
    --) shift; extra=("$@"); break ;;
    *) names+=("$1"); shift ;;
  esac
done
((${#names[@]})) || { printf '%s\n' "$usage" >&2; exit 2; }
case "$appearance" in "" | light | dark) ;; *) printf '%s\n' "$usage" >&2; exit 2 ;; esac
mkdir -p "$out"

# The install path mac-app.sh runs from; matching it never touches a Crosstune the user has open.
app="$(cd "$HOME/Applications" && pwd -P)/Crosstune Dev.app"
trap '"$apple/scripts/mac-app.sh" "done" > /dev/null' EXIT

# Window id and title of each window the app shows, one per line, tab separated.
windows() {
  peekaboo window list --app "PID:$1" --json 2> /dev/null | python3 -c '
import json, sys
for w in (json.load(sys.stdin).get("data") or {}).get("windows") or []:
    bounds = w.get("bounds") or {}
    size = (bounds.get("width", 0), bounds.get("height", 0))
    # A sheet brings a blank, untitled 500 by 500 helper window that shows nothing of the app.
    if not w.get("window_title") and (min(size) <= 100 or size == (500, 500)):
        continue
    print(w["window_id"], w.get("window_title") or "", sep="\t")
' || true
}

shoot() {
  local name="$1" pid="" listed="" suffix="" args
  if [[ "$name" == settings-* ]]; then
    args=(-SampleShell -SampleSettingsTab "${name#settings-}")
  else
    args=(-SampleShell -SampleScreen "$name")
  fi
  # A launch argument sets the appearance for this run only, never the shared defaults.
  [[ -z "$appearance" ]] || { args+=(-crosstune.appearance "$appearance"); suffix="-$appearance"; }
  "$apple/scripts/mac-app.sh" run "${args[@]}" ${extra[@]+"${extra[@]}"} > /dev/null
  for _ in $(seq 1 30); do
    pid="$(pgrep -nf "^$app/Contents/MacOS/" || true)"
    [[ -z "$pid" ]] || break
    sleep 1
  done
  [[ -n "$pid" ]] || { printf '%s\n' "the Mac app did not start" >&2; exit 1; }
  for attempt in $(seq 1 20); do
    listed="$(windows "$pid")"
    [[ -z "$listed" ]] || break
    # Launched in the background, the app can come up with no window; a reopen makes one.
    ((attempt % 4 == 2)) && open -g "$app"
    sleep 1
  done
  [[ -n "$listed" ]] || { printf '%s\n' "the Mac app showed no window for $name" >&2; exit 1; }
  # Long enough for the store to open, the surface's own pause, and its presentation.
  sleep "$settle"
  # A sheet takes its window, and the window under it its title, partway through presenting,
  # so the windows are kept only once two rounds a second apart list and draw the same.
  local round="$out/.round" previous="$out/.previous" waited=0
  rm -rf "$round" "$previous"
  capture_windows "$pid" "$name$suffix" "$previous"
  while true; do
    sleep 1
    waited=$((waited + 1))
    capture_windows "$pid" "$name$suffix" "$round"
    same_round "$previous" "$round" && break
    if ((waited >= limit)); then
      printf 'warning: the windows for %s still changed after %ss\n' "$name" "$((settle + limit))" >&2
      break
    fi
    rm -rf "$previous"
    mv "$round" "$previous"
  done
  rm -f "$out/$name$suffix"--*.png
  local file
  for file in "$round"/*.png; do
    [[ -e "$file" ]] || continue
    mv "$file" "$out/"
    printf '%s\n' "$out/${file##*/}"
  done
  rm -rf "$round" "$previous"
}

# Captures every window of process $1 into folder $3, each named $2--<window title>.png.
capture_windows() {
  local pid="$1" prefix="$2" folder="$3" listed="" id title part file
  mkdir -p "$folder"
  for _ in 1 2 3; do
    listed="$(windows "$pid")"
    [[ -z "$listed" ]] || break
    sleep 1
  done
  while IFS=$'\t' read -r id title; do
    [[ -n "$id" ]] || continue
    # Named for the window's title; a sheet, popover, or alert has none. The double dash ends the
    # screen name, so clearing one screen's files never matches another that extends its name.
    part="$(tr '[:upper:] ' '[:lower:]-' <<< "${title:-sheet}")"
    file="$folder/$prefix--$part.png"
    [[ ! -e "$file" ]] || file="$folder/$prefix--$part-$id.png"
    # Peekaboo first: screencapture can return the whole window under a sheet for the sheet's
    # own id, and a fallback taken only some of the time makes two runs differ.
    peekaboo see --window-id "$id" --no-elements --retina --path "$file" > /dev/null 2>&1 ||
      peekaboo see --window-id "$id" --no-elements --retina --capture-engine sckit --path "$file" > /dev/null 2>&1 ||
      screencapture -o -x -l"$id" "$file" 2> /dev/null ||
      printf '%s\n' "could not capture window $id; capture needs the screen unlocked" >&2
  done <<< "$listed"
}

# Whether folders $1 and $2 hold the same files with the same bytes.
same_round() {
  [[ "$(ls "$1")" == "$(ls "$2")" ]] || return 1
  local file
  for file in "$1"/*.png; do
    [[ -e "$file" ]] || return 1
    cmp -s "$file" "$2/${file##*/}" || return 1
  done
}

for name in "${names[@]}"; do
  shoot "$name"
done
