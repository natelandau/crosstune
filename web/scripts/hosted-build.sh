#!/usr/bin/env bash
# Build command for Workers Builds. One Worker serves every branch, so the build
# picks the Clerk instance and the Sentry environment from the branch it is on.
# `production` is the release branch that the Release workflow moves to each
# version tag; every other branch, `main` included, is a preview.
set -euo pipefail

branch="${WORKERS_CI_BRANCH:?WORKERS_CI_BRANCH is not set; this script runs under Workers Builds}"

if [ "$branch" = "production" ]; then
  export VITE_CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY_PRODUCTION:?CLERK_PUBLISHABLE_KEY_PRODUCTION is not set}"
  export VITE_SENTRY_ENVIRONMENT=production
else
  export VITE_CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY_DEVELOPMENT:?CLERK_PUBLISHABLE_KEY_DEVELOPMENT is not set}"
  export VITE_SENTRY_ENVIRONMENT=development
fi

exec pnpm build
