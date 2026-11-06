#!/usr/bin/env bash
# Runs the signed Mac app on the marketing catalog and captures its window to family-mac.png
# and the store stills in .build/capture.
set -euo pipefail

cd "$(dirname "$0")/.."
capture=.build/capture
mac_app=(uv run --project ../api python scripts/mac_app.py)

# A locked session draws no app windows.
if ioreg -n Root -d1 -a | grep -A1 CGSSessionScreenIsLocked | grep -q '<true/>'; then
  echo "the screen is locked, so the Mac app draws no window; unlock it and run again" >&2
  exit 1
fi

# The signed app is sandboxed, so it reads the fixture from a copy in its own container;
# asset paths in the fixture are relative to it, so the assets come along.
staged="$HOME/Library/Containers/app.crosstune.Crosstune/Data/Library/Caches/marketing-capture"
rm -rf "$staged"
mkdir -p "$staged"
cp -R Marketing/catalog.json Marketing/assets "$staged/"
fixture="$staged/catalog.json"
mkdir -p "$capture"

# The fixture's ids for the tunes, the list, and the recording the store stills open on.
id_of() {
  python3 -c '
import json, sys
catalog = json.load(open(sys.argv[1]))
table, key = {"tune": ("tunes", "title"), "list": ("lists", "name"), "recording": ("recordings", "label")}[sys.argv[2]]
print(next(r["id"] for r in catalog[table] if r[key] == sys.argv[3]))
' Marketing/catalog.json "$1" "$2"
}

# The install path mac_app.py runs from; matching it never touches a Crosstune the user has open.
app="$(cd "$HOME/Applications" && pwd -P)/Crosstune Dev.app"
# Set before the first launch, so a run that fails after claiming the app still releases it.
trap '"${mac_app[@]}" "done" > /dev/null' EXIT

# Launches the app on the fixture with any further arguments $2..., waits for the text in
# $loaded_text (a fixture tune by default), and saves its window to <name>.png. A launch per
# still, since the shell opens on the place its arguments name and nothing here clicks.
shoot() {
  local name="$1" pid="" loaded="" id
  shift
  local out="$PWD/$capture/$name.png"
  rm -f "$out"
  # Launch arguments set these for this run only, never the defaults every worktree shares.
  "${mac_app[@]}" run -MarketingShell "$fixture" -crosstune.appearance light \
    -catalogSort.v1 title.asc "$@"
  for _ in $(seq 1 30); do
    pid="$(pgrep -nf "^$app/Contents/MacOS/" || true)"
    [ -z "$pid" ] || break
    sleep 1
  done
  [ -n "$pid" ] || { echo "the Mac app did not start" >&2; exit 1; }
  # A fixture tune in the accessibility tree marks the catalog loaded.
  for _ in $(seq 1 30); do
    if peekaboo see --pid "$pid" --no-screenshot --tree 2> /dev/null | grep -q "${loaded_text:-Backstep Cindy}"; then
      loaded=1
      break
    fi
    sleep 1
  done
  if [ -z "$loaded" ]; then
    peekaboo see --pid "$pid" --no-screenshot --tree > "$capture/$name-tree.txt" 2>&1 || true
    echo "$name never showed ${loaded_text:-Backstep Cindy} in the Mac app; its window is in $capture/$name-tree.txt" >&2
    exit 1
  fi
  # Long enough for an opened tune's page to draw.
  sleep 2
  # Captured by window id: the app's window has no accessibility match that the
  # app-and-title selectors need. The main window is titled with its sidebar row.
  id="$(peekaboo window list --pid "$pid" --json | python3 -c '
import json, sys
windows = json.load(sys.stdin)["data"]["windows"]
print(next(w["window_id"] for w in windows if w["window_title"]))
')"
  peekaboo see --window-id "$id" --no-elements --retina --path "$out" > /dev/null
  "${mac_app[@]}" "done" > /dev/null
  echo "captured the Mac app to $out"
}

shoot family-mac
shoot store-mac-tune -MarketingTune "$(id_of tune 'Sail Away Ladies')"
shoot store-mac-lists -MarketingList "$(id_of list 'Saturday session')" \
  -MarketingTune "$(id_of tune 'Backstep Cindy')"
loaded_text='With the band' shoot store-mac-practice \
  -MarketingRecording "$(id_of recording 'With the band')" -MarketingSpeed 75
# An A 2 cents sharp, which reads as in tune. The spoken reading marks the tuner hearing it.
loaded_text='A4, in tune' shoot store-mac-tuner -MarketingSidebar tuner -TunerTone 440.51
