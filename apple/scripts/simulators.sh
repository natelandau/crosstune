#!/usr/bin/env bash
# Simulator helpers shared by the capture scripts. Source it; it runs nothing on its own.

# Prints the udid of the simulator named $1, made from device type $2 on the newest iOS
# runtime that supports it when missing, booted with the capture status bar.
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
        # The newest runtime that supports the device type: a point release can ship for one
        # device only.
        runtime="$(xcrun simctl list runtimes available -j | python3 -c '
import json, sys
kind = "com.apple.CoreSimulator.SimDeviceType." + sys.argv[1]
ios = [r for r in json.load(sys.stdin)["runtimes"] if r["platform"] == "iOS"
       and any(t["identifier"] == kind for t in r.get("supportedDeviceTypes", []))]
print(max(ios, key=lambda r: [int(p) for p in r["version"].split(".")])["identifier"])
' "$2")"
        device="$(xcrun simctl create "$1" "com.apple.CoreSimulator.SimDeviceType.$2" "$runtime")"
    fi
    xcrun simctl bootstatus "$device" -b > /dev/null
    # The first keyboard otherwise opens under a swipe-to-type tip.
    xcrun simctl spawn "$device" defaults write com.apple.keyboard.preferences \
        DidShowContinuousPathIntroduction -bool true
    # Location refused up front, so no recording opens on the location note or tags a place.
    xcrun simctl privacy "$device" revoke location app.crosstune.Crosstune
    status_bar "$device" full
    echo "$device"
}
# Sets the capture status bar on simulator $1: full signal, or none at all when $2 is
# `none`. A full date, rather than a bare time, also fixes the date an iPad shows beside
# 9:41: today's date, so the weekday it shows is the real one, unless STATUS_BAR_DATE
# (YYYY-MM-DD) names a fixed one. simctl takes only UTC with
# milliseconds and shows it in the host's time zone, so 9:41 local is converted first.
status_bar() {
    # Overrides accumulate, so full signal sets every mode back as well as the bars.
    local signal=(--cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3)
    [ "$2" != none ] ||
        signal=(--cellularMode active --cellularBars 0 --wifiMode failed --wifiBars 0 --operatorName '')
    local at
    at="$(/bin/date -j -f '%Y-%m-%dT%H:%M:%S' "${STATUS_BAR_DATE:-$(/bin/date +%Y-%m-%d)}T09:41:00" +%s)"
    # The time goes in a call of its own: sent together with the other flags, the iPad shows
    # a weekday that disagrees with the date.
    xcrun simctl status_bar "$1" override --batteryState charged --batteryLevel 100 "${signal[@]}"
    xcrun simctl status_bar "$1" override --time "$(/bin/date -u -r "$at" '+%Y-%m-%dT%H:%M:%S.000Z')"
}
