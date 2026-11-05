#!/usr/bin/env bash
# Captures iPhone and iPad app surfaces over the sample catalog, the iOS counterpart of
# mac-shots.sh. Each name is a launch: the app opens on that surface through
# `-SampleShell -SampleScreen <name>` in a capture simulator, and the simulator's screen is
# saved. Simulators draw headless, so nothing on the Mac takes focus.
set -euo pipefail

usage="usage: $0 [--out DIR] [--appearance light|dark] [--settle SECONDS] [--limit SECONDS] [--device iphone|ipad]... [--no-build] name...
names: the cases of SampleScreen (Sample/SampleScreen.swift), such as catalog, tune, tune-new,
plan, or welcome. settings-<tab> names are Mac only and are skipped."

apple="$(git rev-parse --show-toplevel)/apple"
out="$apple/.build/shots"
appearance=light
settle=2
limit=20
build=1
devices=()
names=()
while (($#)); do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --appearance) appearance="$2"; shift 2 ;;
    --settle) settle="$2"; shift 2 ;;
    --limit) limit="$2"; shift 2 ;;
    --device) devices+=("$2"); shift 2 ;;
    --no-build) build=0; shift ;;
    -h | --help) printf '%s\n' "$usage"; exit 0 ;;
    *) names+=("$1"); shift ;;
  esac
done
((${#names[@]})) || { printf '%s\n' "$usage" >&2; exit 2; }
case "$appearance" in light | dark) ;; *) printf '%s\n' "$usage" >&2; exit 2 ;; esac
((${#devices[@]})) || devices=(iphone ipad)
mkdir -p "$out"

cd "$apple"
# shellcheck source-path=SCRIPTDIR source=simulators.sh
source scripts/simulators.sh
# A fixed date, so the iPad's status bar reads the same in shots taken on different days.
export STATUS_BAR_DATE=2026-10-06
derived_data=.build/DerivedData
product="$derived_data/Build/Products/Debug-iphonesimulator/Crosstune.app"

if ((build)); then
  scripts/scrub-env.sh xcodebuild build -quiet -project Crosstune.xcodeproj -scheme Crosstune \
    -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived_data" \
    COMPILATION_CACHE_ENABLE_CACHING=YES COMPILATION_CACHE_LIMIT_SIZE=4G
fi
[[ -d "$product" ]] || { printf 'no simulator build at %s\n' "$product" >&2; exit 1; }
bundle="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$product/Info.plist")"

# A name SampleScreen does not know opens the plain shell, which would pass for a capture.
known="$(sed -nE 's/^ *case ([a-zA-Z]+)( = "([a-z-]+)")?$/\1 \3/p' \
  CrosstuneKit/Sources/CrosstuneUI/Sample/SampleScreen.swift | awk '{ print ($2 == "" ? $1 : $2) }')"
for name in "${names[@]}"; do
  [[ "$name" == settings-* ]] || grep -qxF "$name" <<< "$known" ||
    { printf 'no SampleScreen case is named %s\n' "$name" >&2; exit 2; }
done

# Whether shot $1 is blank: the area under the status bar one solid color, as the launch
# screen is before the app draws. Shrunk to 4 by 4, a solid area gives 16 equal pixels.
blank() {
  local probe="$out/.probe.bmp" height width
  height="$(sips -g pixelHeight "$1" | awk '/pixelHeight/ { print $2 }')"
  width="$(sips -g pixelWidth "$1" | awk '/pixelWidth/ { print $2 }')"
  sips --cropToHeightWidth "$((height * 3 / 5))" "$width" -z 4 4 -s format bmp "$1" --out "$probe" > /dev/null
  # The header gives where the pixels start (offset 10) and the bits per pixel (offset 28).
  local start depth pixels
  start=$(($(od -An -tu4 -j10 -N4 "$probe")))
  depth=$(($(od -An -tu2 -j28 -N2 "$probe") / 8))
  pixels="$(tail -c "+$((start + 1))" "$probe" | xxd -p -c "$depth" | sort -u | wc -l)"
  rm -f "$probe"
  ((pixels == 1))
}

shoot() {
  local device="$1" udid="$2" name="$3" file
  file="$out/$name-$appearance--$device.png"
  xcrun simctl launch --terminate-running-process "$udid" "$bundle" \
    -SampleShell -SampleScreen "$name" -crosstune.appearance "$appearance" > /dev/null
  # The store opens, then the surface pauses and presents, so the screen is read only once it
  # has drawn and two shots in a row match, after the settle time and within the limit.
  local previous="$out/.previous-$device.png" waited=0
  sleep "$settle"
  xcrun simctl io "$udid" screenshot "$previous" > /dev/null 2>&1
  while true; do
    sleep 1
    waited=$((waited + 1))
    xcrun simctl io "$udid" screenshot "$file" > /dev/null 2>&1
    if cmp -s "$previous" "$file" && ! blank "$file"; then break; fi
    if ((waited >= limit)); then
      printf 'warning: %s on %s was blank or still changed after %ss\n' "$name" "$device" "$((settle + limit))" >&2
      break
    fi
    cp "$file" "$previous"
  done
  rm -f "$previous"
  printf '%s\n' "$file"
}

for device in "${devices[@]}"; do
  case "$device" in
    iphone) udid="$(simulator "Crosstune Capture iPhone 17 Pro Max" iPhone-17-Pro-Max)" ;;
    ipad) udid="$(simulator "Crosstune Capture iPad" iPad-Pro-13-inch-M5-12GB)" ;;
    *) printf '%s\n' "$usage" >&2; exit 2 ;;
  esac
  xcrun simctl ui "$udid" appearance "$appearance"
  xcrun simctl install "$udid" "$product"
  for name in "${names[@]}"; do
    if [[ "$name" == settings-* ]]; then
      printf 'skipped %s: Settings tabs are Mac only\n' "$name" >&2
      continue
    fi
    shoot "$device" "$udid" "$name"
  done
  xcrun simctl terminate "$udid" "$bundle" > /dev/null 2>&1 || true
done
