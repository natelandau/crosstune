#!/usr/bin/env bash
# Usage: capture-test.sh [NAME]...
# Records the marketing UI tests named, or all of them when none are, and exports their
# attachments. CAPTURE and DERIVED_DATA name the folders `just apple::capture-test` keeps
# them in.
set -euo pipefail

cd "$(dirname "$0")/.."
capture="${CAPTURE:?CAPTURE is not set; run just apple::capture-test}"
derived_data="${DERIVED_DATA:?DERIVED_DATA is not set; run just apple::capture-test}"
scrub="scripts/scrub-env.sh"
# Simulators of their own, never signed in to an Apple Account, so no system alert covers a capture.
capture_device="Crosstune Capture iPhone 17 Pro Max"
capture_pad="Crosstune Capture iPad"

# Prints the udid of the simulator named $1, made from device type $2 on the newest iOS
# runtime when missing, booted with the capture status bar.
simulator() {
    # Called inside $(...), where bash clears errexit, so a failed create or boot would
    # otherwise print an empty udid and exit 0.
    set -e
    local device runtime
    device="$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = [d for ds in json.load(sys.stdin)["devices"].values() for d in ds]
print(next((d["udid"] for d in devices if d["name"] == sys.argv[1]), ""))
' "$1")"
    if [ -z "$device" ]; then
        runtime="$(xcrun simctl list runtimes available -j | python3 -c '
import json, sys
ios = [r for r in json.load(sys.stdin)["runtimes"] if r["platform"] == "iOS"]
print(max(ios, key=lambda r: [int(p) for p in r["version"].split(".")])["identifier"])
')"
        device="$(xcrun simctl create "$1" "com.apple.CoreSimulator.SimDeviceType.$2" "$runtime")"
    fi
    xcrun simctl bootstatus "$device" -b > /dev/null
    # The first keyboard otherwise opens under a swipe-to-type tip.
    xcrun simctl spawn "$device" defaults write com.apple.keyboard.preferences \
        DidShowContinuousPathIntroduction -bool true
    status_bar "$device" full
    echo "$device"
}
# Sets the capture status bar on simulator $1: full signal, or none at all when $2 is
# `none`. A full date, rather than a bare time, also fixes the date an iPad shows beside
# 9:41; today's date makes the weekday it shows the real one. simctl takes only UTC with
# milliseconds and shows it in the host's time zone, so 9:41 local is converted first.
status_bar() {
    # Overrides accumulate, so full signal sets every mode back as well as the bars.
    local signal=(--cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3)
    [ "$2" != none ] ||
        signal=(--cellularMode active --cellularBars 0 --wifiMode failed --wifiBars 0 --operatorName '')
    local at
    at="$(/bin/date -j -f '%Y-%m-%dT%H:%M:%S' "$(/bin/date +%Y-%m-%d)T09:41:00" +%s)"
    # The time goes in a call of its own: sent together with the other flags, the iPad shows
    # a weekday that disagrees with the date.
    xcrun simctl status_bar "$1" override --batteryState charged --batteryLevel 100 "${signal[@]}"
    xcrun simctl status_bar "$1" override --time "$(/bin/date -u -r "$at" '+%Y-%m-%dT%H:%M:%S.000Z')"
}

# A capture name is a test method without its `test` prefix: `hero-jam` is `test_hero_jam`
# or `testHeroJam`, in whichever class declares it. With no names, every capture runs.
names=("$@")
if [ "${#names[@]}" -eq 0 ]; then
    while IFS= read -r method; do names+=("$(echo "${method#test_}" | tr _ -)"); done < <(
        grep -ohE 'func test_[a-z0-9_]+\(' CrosstuneMarketingUITests/*.swift | sed -E 's/func (.*)\(/\1/')
fi
phone=() folk=() pad=()
for name in "${names[@]}"; do
    snake="test_${name//-/_}"
    camel="test$(echo "$name" | awk -F- '{ for (i = 1; i <= NF; i++) printf "%s", toupper(substr($i, 1, 1)) substr($i, 2) }')"
    file="$(grep -lE "func ($snake|$camel)\(" CrosstuneMarketingUITests/*.swift | head -n 1 || true)"
    [ -n "$file" ] || { echo "no capture test named $name" >&2; exit 1; }
    method="$(grep -oE "func ($snake|$camel)\(" "$file" | head -n 1 | sed -E 's/func (.*)\(/\1/')"
    # The class is the last one declared above the method, since a file can hold several.
    class="$(awk -v method="func $method(" '
        match($0, /class [A-Za-z0-9_]+:/) { owner = substr($0, RSTART + 6, RLENGTH - 7) }
        index($0, method) { print owner; exit }
    ' "$file")"
    [ -n "$class" ] || { echo "no class declares $method in $file" >&2; exit 1; }
    # The folk stills run alone under a status bar with no signal, and iPad captures on the iPad.
    case "$name" in
        folk | store-folk) folk+=("-only-testing:CrosstuneMarketingUITests/$class/$method") ;;
        *ipad*) pad+=("-only-testing:CrosstuneMarketingUITests/$class/$method") ;;
        *) phone+=("-only-testing:CrosstuneMarketingUITests/$class/$method") ;;
    esac
done

rm -rf "$capture"
mkdir -p "$capture/attachments"
status=0
# Runs one pass: $1 bundle name, $2 simulator, then the -only-testing or -skip-testing flags.
pass() {
    local bundle="$1" device="$2"
    shift 2
    local destination="platform=iOS Simulator,id=$device"
    "$scrub" xcodebuild build-for-testing -quiet -project Crosstune.xcodeproj -scheme Marketing \
        -destination "$destination" -derivedDataPath "$derived_data"
    # A failed test would otherwise wait up to ten minutes for a simulator sysdiagnose.
    "$scrub" xcodebuild test-without-building -quiet -project Crosstune.xcodeproj -scheme Marketing \
        -testPlan Marketing -destination "$destination" -derivedDataPath "$derived_data" \
        -collect-test-diagnostics never -resultBundlePath "$capture/$bundle.xcresult" \
        "$@" || status=$?
    # Exported even when a test fails, so its recording shows what went wrong. Every pass
    # exports into one folder and one manifest, whose file names are unique ids.
    if [ -d "$capture/$bundle.xcresult" ]; then
        xcrun xcresulttool export attachments --path "$capture/$bundle.xcresult" \
            --output-path "$capture/$bundle" > /dev/null
        python3 -c '
import json, pathlib, shutil, sys
source, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
manifest = target / "manifest.json"
tests = json.loads(manifest.read_text()) if manifest.exists() else []
for item in source.iterdir():
    if item.name != "manifest.json":
        shutil.move(str(item), target / item.name)
tests += json.loads((source / "manifest.json").read_text())
manifest.write_text(json.dumps(tests, indent=2))
shutil.rmtree(source)
' "$capture/$bundle" "$capture/attachments"
    fi
}

if [ ${#phone[@]} -gt 0 ] || [ ${#folk[@]} -gt 0 ]; then
    device="$(simulator "$capture_device" iPhone-17-Pro-Max)"
    [ ${#phone[@]} -eq 0 ] || pass Marketing "$device" "${phone[@]}"
    if [ ${#folk[@]} -gt 0 ]; then
        status_bar "$device" none
        pass MarketingFolk "$device" "${folk[@]}"
        status_bar "$device" full
    fi
fi
if [ ${#pad[@]} -gt 0 ]; then
    device="$(simulator "$capture_pad" iPad-Pro-13-inch-M5-12GB)"
    pass MarketingPad "$device" "${pad[@]}"
fi
exit "$status"
