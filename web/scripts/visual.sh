#!/usr/bin/env bash
# Runs the visual project in CI's Playwright image on CI's CPU, so a baseline made here matches
# CI's rendering. node_modules and the pnpm store live in Docker volumes, since the host's hold
# macOS binaries.
set -euo pipefail
cd "$(dirname "$0")/.."

image=$(sed -nE 's|^ *image: (mcr\.microsoft\.com/playwright:[^ ]+).*|\1|p' ../.github/workflows/web.yml)
pnpm_version=$(node -p "require('./package.json').packageManager.split('@')[1]")
root=$(cd .. && pwd)

exec docker run --rm --platform linux/amd64 --ipc=host \
  -v "$root:/repo" \
  -v crosstune-visual-node-modules:/repo/web/node_modules \
  -v crosstune-visual-pnpm-store:/pnpm-store \
  -e npm_config_store_dir=/pnpm-store \
  -w /repo/web \
  "$image" \
  bash -c 'npm install --global --silent "pnpm@$0" && pnpm install --frozen-lockfile --silent --store-dir /pnpm-store && pnpm vitest run --project visual "$@"' \
  "$pnpm_version" "$@"
