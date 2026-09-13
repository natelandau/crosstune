#!/usr/bin/env bash
# Commitizen pre-bump hook. Runs after the version files are rewritten and
# before the bump commit, so the API lockfile records the new package version
# and rides along in that commit.
set -euo pipefail
cd "$(dirname "$0")/.."
uv lock --project api
git add api/uv.lock
