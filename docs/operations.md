# Crosstune operations

How to work on Crosstune: set up, run, test, commit, release, deploy, roll
back, smoke check, and rebuild. The settings each host holds are in
`hosting.md`.

## Prerequisites

| Tool                                          | Version        | Notes                                                                           |
| --------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| [uv](https://docs.astral.sh/uv/)              | any            | Installs Python 3.13, the API's dependencies, and the git hooks.                |
| [Node.js](https://nodejs.org/)                | 22.12 or newer | Runs the web toolchain.                                                         |
| [pnpm](https://pnpm.io/)                      | 12.4.1         | Pinned in `web/package.json`. `corepack enable` installs it.                    |
| [just](https://just.systems)                  | any            | The task runner. `just --list` shows every recipe.                              |
| [Docker](https://docs.docker.com/get-docker/) | any            | Runs Postgres 18 and RustFS for development and the API tests. Must be running. |
| [ffmpeg](https://ffmpeg.org/)                 | any            | Transcodes recordings. Without it the API tests that use audio skip.            |

You also need a free [Clerk](https://clerk.com) development instance with
email magic link sign-in enabled. From its dashboard, copy the Frontend API
URL (`https://<slug>.clerk.accounts.dev`) and the publishable key
(`pk_test_...`).

## Set up once

1. Start Docker.
2. Run `just dev-setup`. It installs the Python and JavaScript dependencies
   and Chromium, installs the git hooks, creates `api/.env` and `web/.env`
   from their examples, starts Postgres and RustFS, and creates the
   `crosstune-local` and `crosstune-e2e` buckets.
3. In `api/.env`, set `CROSSTUNE_CLERK_ISSUER` to the Frontend API URL.
4. In `web/.env`, set `VITE_CLERK_PUBLISHABLE_KEY` to the publishable key.

Migrations run every time `just dev` starts. Nothing is created by hand.

## Run

| Command             | Does                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `just dev`          | Starts Postgres and RustFS, applies migrations, runs the API on 8000 and the web client on 5173. Ctrl-C stops both. |
| `just dev-down`     | Stops Postgres and RustFS.                                                                                          |
| `just api::run`     | The API alone, reloading on changes under `api/src`.                                                                |
| `just web::run`     | The web client alone.                                                                                               |
| `just web::preview` | A production build on 4173 with the same `/v1` proxy.                                                               |

Open http://localhost:5173 and sign in with an email address. The API
answers `{"status":"ok"}` at http://localhost:8000/healthz. Every checkout
and worktree shares one Postgres container and one database. Browsers reach
RustFS through the dev server's `/storage` proxy, so a phone on the dev
server's Tailscale Serve URL can record and play back too.

RustFS holds local recordings. Its console is at http://localhost:9001,
sign in with `crosstune` and `crosstune-local-secret`. List objects with
`just api::storage ls [prefix]` and download one with
`just api::storage get <key> [dest]`. Both take `--bucket crosstune-e2e` to
read the end-to-end bucket instead of `crosstune-local`.
`just api::storage-reset [bucket]` deletes every object in a bucket,
`crosstune-local` by default. A restart of the API runs the orphan sweep,
which deletes every file that has no user row or no recording row in the
local database. `docker compose down -v` removes the
Postgres and RustFS volumes; `just dev-down` keeps them.

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
- Runs the recording specs in `web/e2e/`, the only place they run.

An API test that reads or writes RustFS skips locally when RustFS is down
and fails instead in CI, where the `API` workflow always starts it.

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
- Every pull request gets its own API, database, and recording prefix. The
  `Preview` workflow creates a Neon branch `pr-<n>` from development and a
  Railway environment `pr-<n>` on the PR branch, with the `pr-<n>/` prefix
  of the preview bucket. A KV entry maps the PR's preview alias to that
  API. Every push resets the Neon branch, so preview data is lost. Every
  push also copies into the prefix each object of the development bucket
  whose copy is missing, has a different size, or is older. Closing the
  PR deletes the Railway environment, the Neon branch, the KV entry, and
  the `pr-<n>/` prefix. The 90-day lifecycle rule on the preview bucket is
  the backstop for a failed prefix deletion. If cleanup fails, run the
  workflow from the Actions tab with the PR number and branch name.
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
  either order.
- Once the app has real users, a shape change is staged so no edit is
  lost: an API release that accepts both shapes, then the client, then an
  API release that drops the old field.
- While the app is pre-release, a clean break ships in one tag. An edit
  made while the two sides disagree is lost. After both hosts deploy,
  reload the app: the service worker updates and the local database starts
  over.
- A migration renaming or dropping a table or column breaks the running API
  between the pre-deploy migration and the new API passing its healthcheck.
  Sync requests that touch the changed table fail with a retryable 5xx and
  no edit is lost, but a transcode claimed in that gap uses one retry. A
  pull reads every table, so every pull fails in that window. A push
  succeeds only when neither its rows nor their parent rows are in the
  changed table.
- A value added to a validated vocabulary is recognized by the client in
  one release and offered in the next, once the API that accepts it is
  live on both hosts, because one tag deploys both sides in either order.
- A local shape change bumps the Dexie version with the start-over
  upgrader while the app is pre-release. Each device loses its unsent
  edits and unuploaded recordings, then pulls every row again.

Rollback:

- One host: redeploy an earlier build from its dashboard.
- Both hosts: Actions tab, `Release` workflow, **Run workflow**, choose the
  older tag under **Use workflow from**.
- A rollback across a migration fails the pre-deploy command. Roll forward,
  or downgrade the schema first.
- A client outage loses no edits. The outbox holds them.
- A web rollback past a release that bumped the local database version
  deletes the local database on every device and pulls again, losing
  unsent edits and unuploaded recordings.

## Smoke check

After a deploy, from the repository root, with no credentials:

```bash
just smoke https://api.<domain> https://<domain>
```

The `Smoke` workflow runs the same script. Blank inputs use the
`API_ORIGIN_PRODUCTION` and `WEB_ORIGIN_PRODUCTION` Actions variables. It
checks that `/healthz` answers ok, that an anonymous `/v1/me` is a 401
problem document from the API and through the web origin, and that the web
origin serves the app shell, the manifest, the service worker, and the
shell for a client-side route.

For a pull request, point it at the PR's Railway hostname and preview URL.

The manual phone test covers what the script cannot:

1. Open `https://<domain>` and sign in.
2. Add a tune and paste a YouTube link.
3. Install the app to the home screen.
4. Turn on airplane mode and edit the tune.
5. Turn off airplane mode.
6. Confirm the edit synced. Settings shows the last sync time.

## Rotate an R2 token

`hosting.md` lists the four R2 tokens: production read-write, development
read-write, development read-only, and preview read-write. Rotate any of
them with these steps.

1. In Cloudflare, open **R2 object storage** and select **Manage** next to
   **API Tokens**. Find the token that holds the bucket and the permission
   you are replacing, and note its name.
2. Select **Create Account API token**. Give the new token the same
   permission and the same single bucket scope as the token you are
   replacing. Copy the **Access Key ID** and the **Secret Access Key**.
   Cloudflare shows the secret once.
3. Set the two new values where the old token lives. For a Railway token
   (production or development read-write), open project `crosstune`, the
   matching environment, service `api`, **Variables**, and set
   `CROSSTUNE_STORAGE_ACCESS_KEY_ID` and
   `CROSSTUNE_STORAGE_SECRET_ACCESS_KEY`, then deploy. For a GitHub token (development read-only or preview
   read-write), open the repository's **Settings**, **Secrets and
   variables**, **Actions**, and update the matching secret pair from
   `hosting.md`.
4. Confirm the new token works. For a Railway token, once the deploy is
   healthy, record audio on that environment and play it back. For a
   GitHub token, open or push to a pull request and confirm the `Preview`
   workflow seeds and later removes its recordings.
5. If you rotate the preview token, run the `Preview` workflow again for
   each open pull request. Each run sets the token on its environment.
   Open previews that did not get the new token cannot reach their
   recordings until their next push.
6. In Cloudflare, delete the token you noted in step 1.

## Rebuilding from nothing

Work through the hosts in this order: Neon, Sentry, Clerk, Railway,
Cloudflare, GitHub, then the smoke check. Return to Clerk for the webhooks
once Railway has hostnames. `hosting.md` holds every setting.
