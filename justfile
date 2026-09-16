# Task runner for the whole repository. Each deployable keeps its own recipes in
# a module (`just api::test`, `just web::test`); the recipes here run every
# module that exists. `just --list` shows everything.

set shell := ["bash", "-euo", "pipefail", "-c"]

mod api
mod web

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

# Run every test suite
test: api::test web::test

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
