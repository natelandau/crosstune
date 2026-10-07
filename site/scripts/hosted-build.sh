#!/usr/bin/env bash
# Build command for Workers Builds. One Worker serves every branch, so the build
# picks the Clerk instance from the branch it is on. The site deploys production
# from `main`, not from the release branch, so it ships without a version tag;
# every other branch is a preview.
set -euo pipefail

branch="${WORKERS_CI_BRANCH:?WORKERS_CI_BRANCH is not set; this script runs under Workers Builds}"

if [[ "$branch" == "main" ]]; then
  export PUBLIC_CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY_PRODUCTION:?CLERK_PUBLISHABLE_KEY_PRODUCTION is not set}"
  # Analytics runs on production only; previews send nothing.
  export PUBLIC_POSTHOG_TOKEN="${POSTHOG_PROJECT_TOKEN_PRODUCTION:?POSTHOG_PROJECT_TOKEN_PRODUCTION is not set}"
else
  export PUBLIC_CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY_DEVELOPMENT:?CLERK_PUBLISHABLE_KEY_DEVELOPMENT is not set}"
fi

exec pnpm build
