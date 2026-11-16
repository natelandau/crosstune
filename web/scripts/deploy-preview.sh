#!/usr/bin/env bash
# Preview command for Workers Builds. The Preview is named with scripts/branch-slug.mjs,
# so the KV entry that the preview workflow writes points at it. A Dependabot branch
# built nothing (scripts/hosted-build.sh), so it uploads nothing.
set -euo pipefail

branch="${WORKERS_CI_BRANCH:?WORKERS_CI_BRANCH is not set; this script runs under Workers Builds}"

if [[ "$branch" == dependabot/* ]]; then
  printf '%s\n' "skipping the Dependabot branch $branch" >&2
  exit 0
fi

slug="$(node scripts/branch-slug.mjs)"
exec wrangler preview --name "$slug"
