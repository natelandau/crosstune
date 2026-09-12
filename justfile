# Task runner for the whole repository. Each deployable keeps its own recipes in
# a module (`just api::test`, `just web::test`); the recipes here run every
# module that exists. `just --list` shows everything.

set shell := ["bash", "-euo", "pipefail", "-c"]

mod api
mod web

[private]
default:
    @just --list

# Run every linter in every module
lint: api::lint web::lint

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

# Upgrade dependencies and hook versions
update: api::update web::update
    uv run --project api prek autoupdate --config .pre-commit-config.yaml
