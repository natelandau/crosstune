#!/usr/bin/env bash
# Sourced from apple/ by a script that uses a build after xcodebuild exits. Marks this
# checkout's builds in use until the script exits, so `just apple::prune-builds` keeps them.
# Sets the EXIT trap, so the script sets none of its own.
mkdir -p .build/in-use
in_use_marker="$PWD/.build/in-use/$$"
: > "$in_use_marker"
trap 'rm -f "$in_use_marker"' EXIT
