#!/usr/bin/env bash
# Build command for Workers Builds. One Worker serves every branch. The site
# deploys production from `main`, not from the release branch, so it ships
# without a version tag; every other branch is a preview.
set -euo pipefail

branch="${WORKERS_CI_BRANCH:?WORKERS_CI_BRANCH is not set; this script runs under Workers Builds}"

# Workers Builds builds every branch and has no way to exclude one. A dependency update
# must not run its code with the build token, so a Dependabot branch builds nothing and
# scripts/deploy-preview.sh uploads nothing.
if [[ "$branch" == dependabot/* ]]; then
  printf '%s\n' "skipping the Dependabot branch $branch" >&2
  exit 0
fi

if [[ "$branch" == "main" ]]; then
  # Analytics runs on production only; previews send nothing.
  export PUBLIC_POSTHOG_TOKEN="${POSTHOG_PROJECT_TOKEN_PRODUCTION:?POSTHOG_PROJECT_TOKEN_PRODUCTION is not set}"
fi

exec pnpm build
