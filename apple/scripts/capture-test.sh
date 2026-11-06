#!/usr/bin/env bash
# Usage: capture-test.sh [NAME]...
# Records the marketing UI tests named, or all of them when none are, and exports their
# attachments. CAPTURE and DERIVED_DATA name the folders `just apple::capture-test` keeps
# them in.
set -euo pipefail

cd "$(dirname "$0")/.."
capture="${CAPTURE:?CAPTURE is not set; run just apple::capture-test}"
derived_data="${DERIVED_DATA:?DERIVED_DATA is not set; run just apple::capture-test}"
# shellcheck source-path=SCRIPTDIR source=simulators.sh
source scripts/simulators.sh
# shellcheck source-path=SCRIPTDIR source=in-use.sh
source scripts/in-use.sh
# Simulators of their own, never signed in to an Apple Account, so no system alert covers a capture.
capture_device="Crosstune Capture iPhone 17 Pro Max"
capture_pad="Crosstune Capture iPad"
capture_duo="Crosstune Capture iPhone Duo"

# Whether the iPhone Duo simulator $1 is open: its inner display is black while it is closed.
duo_open() {
    local shot
    shot="$(mktemp -d)"
    xcrun simctl io "$1" screenshot --display primary-1 "$shot/inner.png" > /dev/null 2>&1
    # Shrunk to one pixel, a black display averages to zero in every channel.
    sips -z 1 1 -s format bmp "$shot/inner.png" --out "$shot/inner.bmp" > /dev/null
    local pixel
    pixel="$(tail -c 4 "$shot/inner.bmp" | xxd -p)"
    rm -rf "$shot"
    [ "$pixel" != 000000ff ]
}
# Waits until the iPhone Duo simulator $1 is $2 (open or closed). No simctl command folds a
# simulator, so a person does it in DeviceHub.
duo_wait() {
    local state=closed waited=0
    duo_open "$1" && state=open
    [ "$state" = "$2" ] && return
    local action=Unfold
    [ "$2" = open ] || action=Fold
    echo "$action the $capture_duo simulator in DeviceHub; waiting" >&2
    until { [ "$2" = open ] && duo_open "$1"; } || { [ "$2" = closed ] && ! duo_open "$1"; }; do
        waited=$((waited + 2))
        [ "$waited" -lt 600 ] || { echo "the $capture_duo simulator never became $2" >&2; exit 1; }
        sleep 2
    done
    # The app's window follows the fold a moment after the display does.
    sleep 3
}

# A capture name is a test method without its `test` prefix: `hero-jam` is `test_hero_jam`
# or `testHeroJam`, in whichever class declares it. A `duo-` prefix runs it on the iPhone Duo.
# With no names, every capture runs, and every store capture runs on the Duo too.
names=("$@")
if [ "${#names[@]}" -eq 0 ]; then
    while IFS= read -r method; do names+=("$(echo "${method#test_}" | tr _ -)"); done < <(
        grep -ohE 'func test_[a-z0-9_]+\(' CrosstuneMarketingUITests/*.swift | sed -E 's/func (.*)\(/\1/')
    for name in "${names[@]}"; do
        case "$name" in store-*) names+=("duo-$name") ;; esac
    done
fi
phone=() folk=() pad=() duo_outer=() duo_folk=() duo_inner=()
for full in "${names[@]}"; do
    name="${full#duo-}"
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
    # On the Duo, iPhone captures run closed on the outer display and iPad captures open on the
    # inner one.
    only="-only-testing:CrosstuneMarketingUITests/$class/$method"
    case "$full" in
        duo-folk | duo-store-folk) duo_folk+=("$only") ;;
        duo-*ipad*) duo_inner+=("$only") ;;
        duo-*) duo_outer+=("$only") ;;
        folk | store-folk) folk+=("$only") ;;
        *ipad*) pad+=("$only") ;;
        *) phone+=("$only") ;;
    esac
done

rm -rf "$capture"
mkdir -p "$capture/attachments"
status=0
# Runs one pass: $1 bundle name, $2 simulator, then the -only-testing or -skip-testing flags.
# Attachment names take the prefix in $prefix, so a Duo still never shares an iPhone's name.
pass() {
    local bundle="$1" device="$2"
    shift 2
    local destination="platform=iOS Simulator,id=$device"
    scripts/xcodebuild.sh build-for-testing -quiet -project Crosstune.xcodeproj -scheme Marketing \
        -destination "$destination" -derivedDataPath "$derived_data"
    # A failed test would otherwise wait up to ten minutes for a simulator sysdiagnose.
    scripts/xcodebuild.sh test-without-building -quiet -project Crosstune.xcodeproj -scheme Marketing \
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
source, target, prefix = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
manifest = target / "manifest.json"
tests = json.loads(manifest.read_text()) if manifest.exists() else []
for item in source.iterdir():
    if item.name != "manifest.json":
        shutil.move(str(item), target / item.name)
added = json.loads((source / "manifest.json").read_text())
for test in added:
    for item in test.get("attachments", []):
        item["suggestedHumanReadableName"] = prefix + item.get("suggestedHumanReadableName", "")
tests += added
manifest.write_text(json.dumps(tests, indent=2))
shutil.rmtree(source)
' "$capture/$bundle" "$capture/attachments" "${prefix:-}"
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

# The closed Duo's passes.
duo_closed() {
    duo_wait "$duo" closed
    [ ${#duo_outer[@]} -eq 0 ] || prefix=duo- pass MarketingDuo "$duo" "${duo_outer[@]}"
    if [ ${#duo_folk[@]} -gt 0 ]; then
        status_bar "$duo" none
        prefix=duo- pass MarketingDuoFolk "$duo" "${duo_folk[@]}"
        status_bar "$duo" full
    fi
}
# The open Duo's pass. Each still the tests ask for in the handoff folder is shot from the inner
# display to `duo-<name>.png`, beside the Mac stills.
duo_opened() {
    duo_wait "$duo" open
    local handoff
    handoff="$(cd "$capture" && pwd)/handoff"
    mkdir -p "$handoff"
    (
        while true; do
            for request in "$handoff"/*; do
                [ -e "$request" ] || continue
                case "$request" in *.done) continue ;; esac
                [ -e "$request.done" ] && continue
                name="$(basename "$request")"
                xcrun simctl io "$duo" screenshot --display primary-1 "$capture/duo-$name.png" > /dev/null 2>&1
                touch "$request.done"
            done
            sleep 0.2
        done
    ) &
    local shooter=$!
    TEST_RUNNER_CAPTURE_HANDOFF="$handoff" pass MarketingDuoInner "$duo" "${duo_inner[@]}"
    kill "$shooter"
    rm -rf "$handoff"
}
if [ $((${#duo_outer[@]} + ${#duo_folk[@]} + ${#duo_inner[@]})) -gt 0 ]; then
    duo="$(simulator "$capture_duo" iPhone-Duo)"
    # Whichever way the Duo already is goes first, so a run asks for at most one fold.
    if [ ${#duo_inner[@]} -gt 0 ] && duo_open "$duo"; then
        duo_opened
        [ $((${#duo_outer[@]} + ${#duo_folk[@]})) -eq 0 ] || duo_closed
    else
        [ $((${#duo_outer[@]} + ${#duo_folk[@]})) -eq 0 ] || duo_closed
        [ ${#duo_inner[@]} -eq 0 ] || duo_opened
    fi
fi
exit "$status"
