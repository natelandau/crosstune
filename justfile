# Task runner for the whole repository. Each deployable keeps its own recipes in
# a module (`just api::test`, `just web::test`); the recipes here run every
# module that exists. `just --list` shows everything.

set shell := ["bash", "-euo", "pipefail", "-c"]

mod api
mod web

# Where the end-to-end API serves, matching e2e_port in api/justfile and e2e_api in
# web/justfile. Not the :8000 of a dev session, so `just e2e` runs while `just dev` does.
e2e_api_port := "8001"

[private]
default:
    @just --list

# Run every linter in every module, then spell check the whole repository
lint: api::lint web::lint typos

# Spell check the whole repository, or only the given paths
typos *paths:
    uv run --project api typos --config .typos.toml {{ paths }}

# Check formatting in every module
format: api::format web::format

# Run every unit and integration suite; the end-to-end suite is `just e2e`
test: api::test web::test

# Run the end-to-end suite; extra args go to Playwright
e2e *args:
    #!/usr/bin/env bash
    set -euo pipefail
    # Postgres, the API on the database the suite owns, then Playwright against a production
    # build. Every port here is clear of a dev session, so this runs while `just dev` does.
    docker compose up -d --wait
    health="http://localhost:{{ e2e_api_port }}/healthz"
    # The run owns the port and the database outright, so it never adopts a server whose
    # database holds rows it did not write.
    if curl -fsS "$health" > /dev/null 2>&1; then
        echo "something already serves :{{ e2e_api_port }}" >&2
        echo "stop it, or run 'just web::e2e' to use it and keep its database" >&2
        exit 1
    fi
    log="${TMPDIR:-/tmp}/crosstune-e2e-api.log"
    # The database lives only as long as the run. CI meets one that never held a fixture, and
    # a local database that outlived a run would feed the next one rows that change what a
    # search returns. uvicorn outlives the `just` that spawned it, so its port finds it again.
    trap 'pkill -f "crosstune.main:app --port {{ e2e_api_port }}" > /dev/null 2>&1 || true; just api::_e2e-db drop > /dev/null' EXIT
    just api::e2e-db-reset
    echo "starting the e2e API on :{{ e2e_api_port }}, logging to $log"
    just api::run-e2e > "$log" 2>&1 &
    # The recipe creates and migrates the database before it serves, so this waits for
    # more than a process start.
    for _ in $(seq 1 90); do
        curl -fsS "$health" > /dev/null 2>&1 && break
        sleep 1
    done
    curl -fsS "$health" > /dev/null 2>&1 || { cat "$log"; echo "the e2e API did not start" >&2; exit 1; }
    just web::e2e {{ args }}

# Remove build artifacts and caches everywhere
clean: api::clean web::clean

# Regenerate the OpenAPI contract and the typed web client from it
contract: api::contract web::contract

# Smoke-check a deployed API origin and web origin; needs no credentials
smoke api_origin web_origin:
    scripts/smoke.sh '{{ api_origin }}' '{{ web_origin }}'

# Install dependencies, git hooks, and start local services
dev-setup: api::setup web::setup
    uv run --project api prek install --config .pre-commit-config.yaml
    docker compose up -d

# Start Postgres, apply migrations, then run the API and web client together
dev:
    docker compose up -d --wait
    just api::migrate
    # Ctrl-C ends the session with 130, which is the normal way out, not a failure
    uv run --project api honcho start -f Procfile.dev || [ $? -eq 130 ]

# Stop Postgres; the API and web client stop with Ctrl-C in `just dev`
dev-down:
    docker compose down

# Write a conventional commit interactively; extra args go to cz commit
commit *args:
    uv run --project api cz commit {{ args }}

# Bump both package versions, update the changelog, and tag; extra args go to cz bump
bump *args:
    uv run --project api cz bump {{ args }}

# Upgrade dependencies and hook versions
update: api::update web::update
    uv run --project api prek autoupdate --config .pre-commit-config.yaml
