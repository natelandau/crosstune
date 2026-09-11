# Task runner for the whole repository. Each deployable keeps its own recipes in
# a module (`just api::test`, `just web::test`); the recipes here run every
# module that exists. `just --list` shows everything.

set shell := ["bash", "-euo", "pipefail", "-c"]

mod api
mod? web

[private]
default:
    @just --list

# Run every linter in every module
lint: api::lint

# Check formatting in every module
format: api::format

# Run every test suite
test: api::test

# Remove build artifacts and caches everywhere
clean: api::clean

# Install dependencies, git hooks, and start local services
dev-setup: api::setup
    uv run --project api prek install --config .pre-commit-config.yaml
    docker compose up -d

# Upgrade dependencies and hook versions
update: api::update
    uv run --project api prek autoupdate --config .pre-commit-config.yaml
