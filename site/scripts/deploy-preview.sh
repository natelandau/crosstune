#!/usr/bin/env bash
# Preview command for Workers Builds. A Dependabot branch built nothing
# (scripts/hosted-build.sh), so it uploads nothing.
set -euo pipefail

branch="${WORKERS_CI_BRANCH:?WORKERS_CI_BRANCH is not set; this script runs under Workers Builds}"

if [[ "$branch" == dependabot/* ]]; then
  printf '%s\n' "skipping the Dependabot branch $branch" >&2
  exit 0
fi

exec wrangler preview
