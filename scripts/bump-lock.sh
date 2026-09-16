#!/usr/bin/env bash
# Commitizen pre-bump hook. Runs after the version files are rewritten and
# before the bump commit, so everything derived from the package version
# rides along in that commit: the API lockfile, and the OpenAPI contract,
# whose info.version the API reads from the package.
set -euo pipefail
cd "$(dirname "$0")/.."
uv lock --project api
just api::contract
just web::contract
git add api/uv.lock web/src/api/openapi.json web/src/api/schema.d.ts
