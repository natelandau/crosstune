# Crosstune operations

How to work on Crosstune: set up, run, test, commit, release, deploy, roll
back, smoke check, and rebuild. The settings each host holds are in
`hosting.md`.

## Prerequisites

| Tool                                          | Version        | Notes                                                                |
| --------------------------------------------- | -------------- | -------------------------------------------------------------------- |
| [uv](https://docs.astral.sh/uv/)              | any            | Installs Python 3.13, the API's dependencies, and the git hooks.     |
| [Node.js](https://nodejs.org/)                | 22.12 or newer | Runs the web toolchain.                                              |
| [pnpm](https://pnpm.io/)                      | 12.4.1         | Pinned in `web/package.json`. `corepack enable` installs it.         |
| [just](https://just.systems)                  | any            | The task runner. `just --list` shows every recipe.                   |
| [Docker](https://docs.docker.com/get-docker/) | any            | Runs Postgres 18 for development and the API tests. Must be running. |
| [ffmpeg](https://ffmpeg.org/)                 | any            | Transcodes recordings. Without it the API tests that use audio skip. |

You also need a free [Clerk](https://clerk.com) development instance with
email magic link sign-in enabled. From its dashboard, copy the Frontend API
URL (`https://<slug>.clerk.accounts.dev`) and the publishable key
(`pk_test_...`).

## Set up once

1. Start Docker.
2. Run `just dev-setup`. It installs the Python and JavaScript dependencies
   and Chromium, installs the git hooks, creates `api/.env` and `web/.env`
   from their examples, and starts Postgres.
3. In `api/.env`, set `CROSSTUNE_CLERK_ISSUER` to the Frontend API URL.
4. In `web/.env`, set `VITE_CLERK_PUBLISHABLE_KEY` to the publishable key.

Migrations run every time `just dev` starts. Nothing is created by hand.

## Run

| Command             | Does                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `just dev`          | Starts Postgres, applies migrations, runs the API on 8000 and the web client on 5173. Ctrl-C stops both. |
| `just dev-down`     | Stops Postgres.                                                                                          |
| `just api::run`     | The API alone, reloading on changes under `api/src`.                                                     |
| `just web::run`     | The web client alone.                                                                                    |
| `just web::preview` | A production build on 4173 with the same `/v1` proxy.                                                    |

Open http://localhost:5173 and sign in with an email address. The API
answers `{"status":"ok"}` at http://localhost:8000/healthz. Every checkout
and worktree shares one Postgres container and one database.

## Test

| Command                 | Runs                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `just lint`             | Every linter in both modules, then a spell check.                          |
| `just test`             | API tests in their own Postgres container, and web unit and browser tests. |
| `just api::test [args]` | API tests. Args narrow the run and drop coverage.                          |
| `just web::test [args]` | Web tests. Args go to vitest.                                              |
| `just typos [paths]`    | Spell check.                                                               |
| `just e2e [args]`       | The Playwright suite. Args go to Playwright.                               |

The end-to-end suite:

- Signs in through the Clerk development instance and spends its usage
  limits. It needs `CLERK_SECRET_KEY` and `E2E_CLERK_USER_EMAIL` in
  `web/.env`.
- Serves the API on 8001 against `crosstune_e2e`, created for the run and
  dropped afterwards, so it runs beside `just dev` and starts empty.
- To keep the database after a failure, run `just api::run-e2e`, then
  `just web::e2e` in a second terminal. `just api::e2e-db-reset` empties it.
- Queries by accessible name. A renamed label, heading, or group needs
  `web/e2e/` checked, and only this suite catches it.

## Commit

- Commit messages follow conventional commits. The commit-msg hook rejects
  any other. `just commit` writes one interactively.
- Commitizen is configured in `.cz.toml` at the root, so every `cz` command
  runs from the root.
- A model change: `just api::makemigrations "message"`, review the file,
  then `just api::migrate`.
- An API change: `just contract` regenerates the OpenAPI file, the typed
  web client, and the client's generated vocabulary file. CI fails when
  the committed copies drift.
- A validated value or length limit: edit `api/src/crosstune/vocabulary.py`,
  write the migration for the check constraint or column it changes, run
  `just contract`, and give any new value its label in
  `web/src/constants.ts`.
- The repository takes squash merges only. The PR title and body become the
  commit message.

## Delivery

- A merge to `main` deploys development. Railway rebuilds the API when a
  file under `api/` changed. Workers Builds uploads the web client under the
  alias `main` when a file under `web/` changed.
- A version tag deploys production. The `Release` workflow moves the
  `production` branch to the tag, and both hosts deploy from that branch.
  Nothing else writes to `production`.
- Every pull request gets its own API and database. The `Preview` workflow
  creates a Neon branch `pr-<n>` from development, a Railway environment
  `pr-<n>` on the PR branch, and a KV entry that maps the PR's preview alias
  to that API. Every push resets the Neon branch, so preview data is lost.
  Closing the PR deletes all three. If cleanup fails, run the workflow from
  the Actions tab with the PR number and branch name.
- CI runs on every pull request and push to `main`. `API` lints, type
  checks, tests on Postgres 18, and checks the OpenAPI contract. `Web`
  lints, type checks, tests, builds, and checks the generated types. `E2E`
  runs Playwright on a PR that touches `web/` or `api/`, and on demand. It
  is not a required check, because a Clerk outage would block unrelated
  merges.
- A development deploy waits for CI (Railway's Wait for CI). Production has
  no host-side gate; the `Release` workflow is the gate.

## Release

On `main` with a clean tree:

```bash
git switch main && git pull
just bump
git push --follow-tags origin main
```

- `just bump` runs commitizen. It picks the increment from the commits,
  writes the version to the API package, `web/package.json`, and `.cz.toml`,
  refreshes `api/uv.lock`, updates `CHANGELOG.md`, commits, and tags
  `v<version>`. `just bump --dry-run` shows the plan.
- Bump on `main` only. A tag on a PR branch points at a commit the squash
  merge never lands, and the workflow refuses it.
- The tag push runs the `API` and `Web` workflows on the tagged commit,
  checks that it is on `main`, and force-pushes `production`. The bump
  commit itself skips CI on `main`, so each release runs the checks once.
  Every release rebuilds both services.
- Each version is its side's Sentry release tag.
- A home-screen install keeps the icon it was installed with. A release that
  changes the icon says so.
- When you bump pnpm in `web/package.json`, change `PNPM_VERSION` in the
  Worker's build variables in the same change. Node is `web/.node-version`.

A change to the shape of a synced row:

- The API refuses a push with an unknown or missing field, and the refused
  edit is lost. One tag deploys both sides within minutes of each other, in
  either order, and an edit in that window is lost.
- The lossless path is an API release that accepts both shapes, then a
  later one that drops the old field.
- Otherwise ship the client first and the API minutes later. An API shipped
  first breaks every install until its service worker updates.

Rollback:

- One host: redeploy an earlier build from its dashboard.
- Both hosts: Actions tab, `Release` workflow, **Run workflow**, choose the
  older tag under **Use workflow from**.
- A rollback across a migration fails the pre-deploy command. Roll forward,
  or downgrade the schema first.
- A client outage loses no edits. The outbox holds them.

## Smoke check

After a deploy, from the repository root, with no credentials:

```bash
just smoke https://api.<domain> https://<domain>
```

The `Smoke` workflow runs the same script. Blank inputs use the
`PRODUCTION_API_ORIGIN` and `PRODUCTION_WEB_ORIGIN` Actions variables. It
checks that `/healthz` answers ok, that an anonymous `/v1/me` is a 401
problem document from the API and through the web origin, and that the web
origin serves the app shell, the manifest, the service worker, and the
shell for a client-side route.

For a pull request, point it at the PR's Railway hostname and preview URL.

The manual phone test covers what the script cannot:

1. Open `https://<domain>` and sign in.
2. Add a song and paste a YouTube link.
3. Install the app to the home screen.
4. Turn on airplane mode and edit the song.
5. Turn off airplane mode.
6. Confirm the edit synced. Settings shows the last sync time.

## Rebuilding from nothing

Work through the hosts in this order: Neon, Sentry, Clerk, Railway,
Cloudflare, GitHub, then the smoke check. Return to Clerk for the webhooks
once Railway has hostnames. `hosting.md` holds every setting.
