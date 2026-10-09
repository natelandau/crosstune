# Task runner for the whole repository. Each deployable keeps its own recipes in
# a module (`just api::test`, `just web::test`); the recipes here run every
# module that exists. `just --list` shows everything.

set shell := ["bash", "-euo", "pipefail", "-c"]

mod api
mod web
mod site
mod apple
mod analytics

# Where the end-to-end API serves, matching e2e_port in api/justfile and e2e_api in
# web/justfile. Not the :8000 of a dev session, so `just e2e` runs while `just dev` does.
e2e_api_port := "8001"

[private]
default:
    @just --list

# The prek hooks that only call a module's lint recipe, which `just lint` and CI run directly
module_hooks := "ty,ruff-check,ruff-format,web-eslint,web-prettier,web-tsc,site-eslint,site-prettier,site-tsc,apple-swift-format,analytics-check"

# Run every linter in every module, then the hooks no module covers
lint: api::lint web::lint site::lint apple::lint analytics::check lint-repo

# Run the prek hooks no module lint covers, such as the spell check, yamllint, and actionlint
lint-repo:
    PREK_SKIP=pytest,{{ module_hooks }} uv run --project api prek run --all-files --config .pre-commit-config.yaml

# Spell check the whole repository, or only the given paths
typos *paths:
    uv run --project api --only-group typos typos --config .typos.toml {{ paths }}

# Check formatting in every module
format: api::format web::format site::format apple::format

# Run every unit and integration suite; the end-to-end suite is `just e2e`
test: api::test web::test site::test apple::test analytics::test

# Run the end-to-end suite; extra args go to Playwright
[positional-arguments]
e2e *args:
    #!/usr/bin/env bash
    set -euo pipefail
    # Postgres, the API on the database the suite owns, then Playwright against a production
    # build. Every port here is clear of a dev session, so this runs while `just dev` does.
    docker compose up -d --wait
    just api::storage-setup
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
    trap 'pkill -f "crosstune.main:app --port {{ e2e_api_port }}" > /dev/null 2>&1 || true; just api::_e2e-db drop > /dev/null; just api::storage-reset crosstune-e2e > /dev/null' EXIT
    just api::e2e-db-reset
    just api::storage-reset crosstune-e2e
    echo "starting the e2e API on :{{ e2e_api_port }}, logging to $log"
    just api::_serve-e2e > "$log" 2>&1 &
    just api::wait-e2e "$!" "$log"
    just web::e2e "$@"

# Remove build artifacts and caches everywhere
clean: api::clean web::clean site::clean apple::clean

# Regenerate the OpenAPI contract and the typed web and Apple clients from it
contract: api::contract web::contract apple::contract

# Smoke-check a deployed API origin, web origin, and optionally site origin; needs no credentials
smoke api_origin web_origin site_origin="":
    scripts/smoke.sh '{{ api_origin }}' '{{ web_origin }}' '{{ site_origin }}'

# Install every module's dependencies and create missing .env files from their examples
setup: api::setup web::setup site::setup apple::setup

# The hooks every worktree shares call the prek of the checkout that installed them.

# Install dependencies, git hooks, and local services; run it in the main checkout only
dev-setup: setup
    uv run --project api prek install --config .pre-commit-config.yaml
    docker compose up -d

# Create .worktrees/<branch> with main's .env files, its dependencies, and its own database and bucket
worktree branch:
    #!/usr/bin/env bash
    set -euo pipefail
    # The branch starts from the main checkout's HEAD, wherever this runs from.
    main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    path="$main/.worktrees/{{ branch }}"
    git -C "$main" worktree add "$path" -b '{{ branch }}'
    # A rerun would fail on the existing branch, so a later failure says how to finish by hand.
    trap 'echo "worktree created at $path but setup failed; finish with: cd $path && just worktree-env && just setup && just api::worktree-db" >&2' ERR
    # This justfile, not the new checkout's, since a branch cut from an older commit may lack the recipe
    just --justfile '{{ justfile() }}' --working-directory "$path" worktree-env
    cd "$path"
    just api::setup web::setup site::setup apple::setup
    just api::worktree-db
    just --justfile '{{ justfile() }}' api::prune-worktree-dbs
    just --justfile '{{ justfile() }}' apple::prune-derived-data
    echo "worktree ready at $path"

# Copy the main checkout's .env files and Apple secrets into this worktree, replacing any already here
worktree-env:
    #!/usr/bin/env bash
    set -euo pipefail
    main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    here="$(git rev-parse --show-toplevel)"
    if [ "$main" = "$here" ]; then
        echo "this is the main checkout; run this in a worktree" >&2
        exit 1
    fi
    for env in "$main"/*/.env; do
        [ -e "$env" ] || continue
        cp "$env" "$here/${env#"$main"/}"
        echo "copied ${env#"$main"/}"
    done
    secrets=apple/Config/Secrets.xcconfig
    if [ -e "$main/$secrets" ]; then
        cp "$main/$secrets" "$here/$secrets"
        echo "copied $secrets"
    fi

# Start Postgres and RustFS, apply migrations, then run the API, web client, and site together
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    scripts/dev-ports.sh 8000 5173 4321
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
    uv run --project api honcho start -f Procfile.dev || [ $? -eq 130 ]

# Stop Postgres and RustFS; the API, web client, and site stop with Ctrl-C in `just dev`
dev-down:
    docker compose down

# Write a conventional commit interactively; extra args go to cz commit
[positional-arguments]
commit *args:
    uv run --project api cz commit "$@"

# Bump both package versions, update the changelog, and tag; extra args go to cz bump
[positional-arguments]
bump *args:
    uv run --project api cz bump "$@"

# Upgrade every dependency and hook version across all modules
update: api::update web::update site::update apple::update
    uv run --project api prek autoupdate --config .pre-commit-config.yaml
