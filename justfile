# Task runner for the whole repository. Each deployable keeps its own recipes in
# a module (`just api::test`, `just web::test`); the recipes here run every
# module that exists. `just --list` shows everything.

import 'scripts/settings.just'

[doc("API lint, tests, database, storage, test data")]
mod api
[doc("Web client lint, tests, e2e suite, builds")]
mod web
[doc("Marketing site lint, tests, builds, assets")]
mod site
[doc("Apple app lint, tests, builds, captures, releases")]
mod apple
[doc("Tracking plan checks and the PostHog sync")]
mod analytics
[doc("Lint and tests for the tooling scripts")]
mod scripts
[doc("Operator commands that change accounts")]
mod ops 'api/ops.just'

# The prek hooks that only call a module's lint recipe, which `just lint` and CI run directly
module_hooks := "ty,ruff-check,ruff-format,api-ruff-config,web-eslint,web-prettier,web-tsc,site-eslint,site-prettier,site-tsc,apple-swift-format,analytics-check,scripts-lint"

[default]
_default:
    @just --list

# Run every linter, then the repo-wide hooks
[group('check')]
[parallel]
lint: api::lint web::lint site::lint apple::lint analytics::check scripts::lint
    # Its hooks rewrite files, so it waits until no module linter is reading them.
    just lint-repo

# Run the prek hooks no module lint covers
[group('check')]
lint-repo:
    PREK_SKIP={{ module_hooks }} uv run prek run --all-files --config .pre-commit-config.yaml

# Check formatting in every module
[group('check')]
[parallel]
format: api::format web::format site::format apple::format scripts::format

# Find unused code; the Apple check builds first
[group('check')]
[parallel]
deadcode: web::deadcode site::deadcode apple::deadcode

# Spell check the repository or the given paths
[group('check')]
[arg("paths", help="Files or folders to check; none checks the whole repository")]
typos *paths:
    scripts/gate-cache.sh typos --argc "$#" uv run --only-group typos typos --config .typos.toml "$@"

# Run every unit and integration suite
[group('check')]
test: api::test web::test site::test apple::test analytics::test scripts::test

# Run the end-to-end suite
[group('check')]
[arg("args", help="Arguments for Playwright")]
e2e *args:
    scripts/e2e.sh "$@"

# Smoke-check deployed origins
[group('check')]
[arg("api", help="The deployed API's origin, such as https://api.example.com")]
[arg("web", help="The deployed web client's origin")]
[arg("site", help="The deployed marketing site's origin; empty skips it")]
smoke api web site="":
    scripts/smoke.sh '{{ api }}' '{{ web }}' '{{ site }}'

# Show or clear the passed lint and test gates
[group('check')]
[arg("args", help="A gate-cache subcommand, such as status or clear")]
gate *args:
    uv run gate-cache "$@"

# Capture the branch's UI changes against main
[group('check')]
[arg("args", help="--platform web|mac|ios, and Mac and iOS screen names such as tune or plan")]
shots *args:
    uv run python scripts/shots.py "$@"

# Run Postgres, RustFS, the API, web, and site
[group('dev')]
[script]
dev:
    uv run python scripts/dev_ports.py 8000 5173 4321
    docker compose up -d --wait
    just api::storage-setup
    # A worktree's api/.env names main's database again after `just worktree-env` copies it.
    # worktree-db points it back at the worktree's own copy and migrates that.
    if [ "$(git rev-parse --absolute-git-dir)" != "$(git rev-parse --path-format=absolute --git-common-dir)" ]; then
        just api::worktree-db
    else
        just api::migrate
    fi
    echo 'Open http://localhost:4321 (site) or http://localhost:5173 (app)'
    # Ctrl-C ends the session with 130, which is the normal way out, not a failure
    uv run honcho start -f Procfile.dev || [ $? -eq 130 ]

# Stop Postgres and RustFS
[group('dev')]
dev-down:
    docker compose down

# Regenerate the OpenAPI contract and its clients
[group('dev')]
contract: api::contract web::contract apple::contract

# Create a set-up worktree at .worktrees/<branch>
[group('worktree')]
[arg("branch", help="The new branch, cut from the main checkout's HEAD")]
worktree $branch:
    uv run python scripts/worktree.py create "$branch"

# Remove a worktree, and its branch once merged
[group('worktree')]
[arg("branch", help="The branch whose worktree to remove")]
worktree-remove $branch:
    uv run python scripts/worktree.py remove "$branch"

# Copy main's .env and secrets files here
[group('worktree')]
worktree-env:
    uv run python scripts/worktree.py copy-env

# Install dependencies and create missing .env files
[group('maintenance')]
setup: api::setup web::setup site::setup apple::setup
    uv sync

# The hooks every worktree shares call the prek of the checkout that installed them.

# Install hooks and services; main checkout only
[group('maintenance')]
dev-setup: setup
    uv run prek install --config .pre-commit-config.yaml
    docker compose up -d

# Upgrade every dependency and hook version
[group('maintenance')]
update: api::update web::update site::update apple::update
    uv lock --upgrade
    uv sync
    uv run prek autoupdate --config .pre-commit-config.yaml

# Remove build artifacts and caches everywhere
[group('maintenance')]
clean: api::clean web::clean site::clean apple::clean

# Write a conventional commit interactively
[group('release')]
[arg("args", help="Arguments for cz commit")]
commit *args:
    uv run cz commit "$@"

# Bump versions, update the changelog, and tag
[group('release')]
[arg("args", help="Arguments for cz bump")]
bump *args:
    uv run cz bump "$@"
