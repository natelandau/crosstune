# Task runner for the whole repository. Each deployable keeps its own recipes in
# a module (`just api::test`, `just web::test`); the recipes here run every
# module that exists. `just --list` shows everything.

set shell := ["bash", "-euo", "pipefail", "-c"]

mod api
mod web
mod site
mod apple
mod analytics

# Where the end-to-end API serves. Not the :8000 of a dev session, so `just e2e` runs while
# `just dev` does. api/e2e-port holds it for every justfile that needs it.
e2e_api_port := trim(read("api/e2e-port"))

# The prek hooks that only call a module's lint recipe, which `just lint` and CI run directly
module_hooks := "ty,ruff-check,ruff-format,web-eslint,web-prettier,web-tsc,site-eslint,site-prettier,site-tsc,apple-swift-format,analytics-check"

[private]
default:
    @just --list

# Run every linter in every module, then the hooks no module covers
lint: api::lint web::lint site::lint apple::lint analytics::check lint-repo

# Run the prek hooks no module lint covers, such as the spell check, yamllint, and actionlint
lint-repo:
    PREK_SKIP={{ module_hooks }} uv run --project api prek run --all-files --config .pre-commit-config.yaml

# Find unused code in every module that has a dead-code check; the Apple one builds the app first
deadcode: web::deadcode site::deadcode apple::deadcode

# Spell check the whole repository, or only the given paths
[positional-arguments]
typos *paths:
    scripts/gate-cache.sh typos --argc "$#" uv run --project api --only-group typos typos --config .typos.toml "$@"

# Run gate-cache: `status` lists the gates that passed or failed on this tree, `clear` forgets every pass
[positional-arguments]
gate *args:
    uv run --project api gate-cache "$@"

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

# Install every module's dependencies and create missing .env and secrets files from their examples
setup: api::setup web::setup site::setup apple::setup

# The hooks every worktree shares call the prek of the checkout that installed them.

# Install dependencies, git hooks, and local services; run it in the main checkout only
dev-setup: setup
    uv run --project api prek install --config .pre-commit-config.yaml
    docker compose up -d

# Create .worktrees/<branch> with main's .env, secrets, and local override files, its dependencies, and its own database and bucket
worktree $branch:
    #!/usr/bin/env bash
    set -euo pipefail
    # The branch starts from the main checkout's HEAD, wherever this runs from.
    main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    path="$main/.worktrees/$branch"
    git -C "$main" worktree add "$path" -b "$branch"
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

# Remove .worktrees/<branch>, its branch once merged, its database and bucket, and its Xcode DerivedData
worktree-remove $branch:
    #!/usr/bin/env bash
    set -euo pipefail
    main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    path="$main/.worktrees/$branch"
    registered() { git -C "$main" worktree list --porcelain | grep -qxF "worktree $path"; }
    if ! registered; then
        echo "no worktree at $path" >&2
        exit 1
    fi
    # This worktree's files vanish below, so everything after runs from the main checkout.
    cd "$main"
    if [ -x "$path/apple/scripts/mac-app.sh" ]; then
        (cd "$path" && apple/scripts/mac-app.sh done)
    fi
    # Never --force, which discards uncommitted work. git deregisters a worktree before it
    # deletes the folder, so a folder an editor filled with untracked build output stays behind.
    if ! git worktree remove "$path"; then
        registered && exit 1
        rm -rf "$path"
        echo "deleted $path, which git left behind"
    fi
    git fetch --quiet origin main || echo "could not fetch origin; checking the merge against the last fetch" >&2
    tip="$(git rev-parse "$branch")"
    merged() {
        git merge-base --is-ancestor "$tip" main && return 0
        git merge-base --is-ancestor "$tip" origin/main && return 0
        # A squash merge leaves no ancestry. A merged pull request whose head is this tip
        # proves it, and a later local commit means work the merge never saw.
        if command -v gh > /dev/null &&
            gh pr list --head "$branch" --state merged --json headRefOid --jq '.[].headRefOid' 2> /dev/null |
            grep -qxF "$tip"; then
            return 0
        fi
        # Without a pull request: the branch as one commit, which git cherry marks `-` when
        # origin/main already holds the same patch.
        local base squashed
        base="$(git merge-base "$tip" origin/main)"
        squashed="$(git commit-tree "$tip^{tree}" -p "$base" -m squashed)"
        [[ "$(git cherry origin/main "$squashed")" == -* ]]
    }
    if merged; then
        git branch -D "$branch"
    else
        echo "kept branch $branch: neither main nor origin/main holds its work" >&2
    fi
    just --justfile "$main/justfile" --working-directory "$main" api::prune-worktree-dbs
    just --justfile "$main/justfile" --working-directory "$main" apple::prune-derived-data
    echo "removed $path"

# Copy the main checkout's .env files, Apple secrets, and Apple local overrides into this worktree, replacing any already here
worktree-env:
    #!/usr/bin/env bash
    set -euo pipefail
    main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    here="$(git rev-parse --show-toplevel)"
    if [ "$main" = "$here" ]; then
        echo "this is the main checkout; run this in a worktree" >&2
        exit 1
    fi
    for file in "$main"/*/.env "$main/apple/Config/Secrets.xcconfig" "$main/apple/Config/Local.xcconfig"; do
        [ -e "$file" ] || continue
        relative="${file#"$main"/}"
        # A branch cut before a file was gitignored would otherwise commit it.
        if ! git -C "$here" check-ignore -q "$relative"; then
            echo "skipped $relative: this branch does not ignore it" >&2
            continue
        fi
        cp "$file" "$here/$relative"
        echo "copied $relative"
    done

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
