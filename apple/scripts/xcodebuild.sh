#!/usr/bin/env bash
# Runs xcodebuild against the Swift packages every checkout shares, without the
# caller's credential-like environment variables. Every build goes through it.
set -euo pipefail

scripts="$(cd "$(dirname "$0")" && pwd)"
packages="$(python3 "$scripts/source_packages.py" resolve --apple "$scripts/..")"
exec "$scripts/scrub-env.sh" xcodebuild "$@" -clonedSourcePackagesDirPath "$packages"
