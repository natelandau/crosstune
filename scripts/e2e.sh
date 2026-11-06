#!/usr/bin/env bash
# Usage: e2e.sh [PLAYWRIGHT ARGS...]
# Runs the end-to-end suite: Postgres, the API on the database the suite owns, then
# Playwright against a production build. Every port here is clear of a dev session, so
# this runs while `just dev` does.
set -euo pipefail

cd "$(dirname "$0")/.."
port="$(tr -d '[:space:]' < api/e2e-port)"

docker compose up -d --wait
just api::storage-setup
health="http://localhost:$port/healthz"
# The run owns the port and the database outright, so it never adopts a server whose
# database holds rows it did not write.
if curl -fsS "$health" > /dev/null 2>&1; then
  printf '%s\n' "something already serves :$port" >&2
  printf '%s\n' "stop it, or run 'just web::e2e' to use it and keep its database" >&2
  exit 1
fi
log="${TMPDIR:-/tmp}/crosstune-e2e-api.log"
# The database lives only as long as the run. CI meets one that never held a fixture, and
# a local database that outlived a run would feed the next one rows that change what a
# search returns. uvicorn outlives the `just` that spawned it, so its port finds it again.
cleanup() {
  pkill -f "crosstune.main:app --port $port" > /dev/null 2>&1 || true
  just api::_e2e-db drop > /dev/null
  just api::storage-reset crosstune-e2e > /dev/null
}
trap cleanup EXIT
just api::e2e-db-reset
just api::storage-reset crosstune-e2e
printf '%s\n' "starting the e2e API on :$port, logging to $log"
just api::_serve-e2e > "$log" 2>&1 &
just api::wait-e2e "$!" "$log"
just web::e2e "$@"
