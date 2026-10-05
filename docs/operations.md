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
| [Xcode](https://developer.apple.com/xcode/)   | 27             | Builds and tests the Apple app. Root `lint`, `format`, and `test` need it.      |

You also need a free [Clerk](https://clerk.com) development instance with
email verification code sign-in enabled. From its dashboard, copy the Frontend API
URL (`https://<slug>.clerk.accounts.dev`) and the publishable key
(`pk_test_...`).

## Set up once

1. Start Docker.
2. Run `just dev-setup`. It installs the Python and JavaScript dependencies
   and Chromium, installs the git hooks, creates `api/.env`, `web/.env`,
   and `apple/.env` from their examples, starts Postgres and RustFS, and creates the
   `crosstune-local` and `crosstune-e2e` buckets.
3. In `api/.env`, set `CROSSTUNE_CLERK_ISSUER` to the Frontend API URL.
4. In `web/.env`, set `VITE_CLERK_PUBLISHABLE_KEY` to the publishable key.

Migrations run every time `just dev` starts. Nothing is created by hand.

Run `just dev-setup` in the main checkout only. The git hooks every
checkout shares call the `prek` of the checkout that installed them, so
installing them from a worktree breaks them once that worktree is removed.
Create a worktree with `just worktree <branch>`: it copies each module's
`.env` from the main checkout and runs `just setup`, so `just e2e` works
there. In a worktree made another way, run `just worktree-env`, then
`just setup`.

A worktree never uses the main checkout's database or bucket, since
branches write migrations at the same time. `just api::worktree-db` copies
the `crosstune` database into `crosstune_wt_<name>` and every object in
`crosstune-local` into `crosstune-wt-<name>`, migrates the copy, and points
the worktree's `api/.env` at both. `just worktree` runs it, and so does
`just dev` in a worktree. The copy is a snapshot of the main checkout;
`just api::worktree-db reset` replaces it with a fresh one.
`just worktree` also runs `just api::prune-worktree-dbs`, which drops the
database and bucket of every worktree that no longer exists.

## Run

| Command             | Does                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `just dev`          | Starts Postgres and RustFS, applies migrations, runs the API on 8000, the web client on 5173, and the site on 4321; start at `localhost:4321`, where Sign in leads to the app. Ctrl-C stops all three. If a port is taken, it names what holds it and offers to stop a Crosstune server left from an earlier session. |
| `just dev-down`     | Stops Postgres and RustFS.                                                                                                                                                                                                                                                                                            |
| `just api::run`     | The API alone, reloading on changes under `api/src`.                                                                                                                                                                                                                                                                  |
| `just web::run`     | The web client alone.                                                                                                                                                                                                                                                                                                 |
| `just site::dev`    | The site alone, on Astro's dev server.                                                                                                                                                                                                                                                                                |
| `just web::preview` | A production build on 4173 with the same `/v1` proxy.                                                                                                                                                                                                                                                                 |

Open http://localhost:5173 and sign in with an email address. The API
answers `{"status":"ok"}` at http://localhost:8000/healthz. Every checkout
and worktree shares one Postgres container, and each worktree has its own
database in it. Browsers reach
RustFS through the dev server's `/storage` proxy, so a phone on the dev
server's Tailscale Serve URL can record and play back too.

The Apple app's Debug build calls the API on port 8000 and signs in
against the Clerk development instance. Start the API with `just dev` or
`just api::run`, then run the Mac app with `just apple::run [app args]`
and quit it with `just apple::done`. Every worktree runs one installed
copy, so the keychain asks for its password once rather than once per
worktree; `run` waits while another worktree holds it. For a Simulator,
open `apple/Crosstune.xcodeproj` and run the `Crosstune` scheme. Recordings need `just dev`: the local
API signs recording URLs as `/storage/...`, and the app sends them through
the web dev server's proxy on port 5173, as a browser does. The local API listens on the Mac only,
so a device needs another API. Create `apple/Config/Local.xcconfig`, which
git ignores and only Debug builds read, and point it at the development
API:

```text
CROSSTUNE_API_ORIGIN = https:/$()/crosstune-development.up.railway.app
```

An xcconfig reads `//` as a comment, so `$()` splits the slashes.

RustFS holds local recordings. Its console is at http://localhost:9001,
sign in with `crosstune` and `crosstune-local-secret`. List objects with
`just api::storage ls [prefix]` and download one with
`just api::storage get <key> [dest]`. Both read the bucket `api/.env`
names, and take `--bucket crosstune-e2e` to read the end-to-end bucket.
`just api::storage-reset [bucket]` deletes every object in a bucket, the
one `api/.env` names by default. A restart of the API runs the orphan sweep,
which deletes every file that has no user row or no recording or
scan row in the local database. `docker compose down -v`
removes the Postgres and RustFS volumes; `just dev-down` keeps them.

## Test

| Command                       | Runs                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `just lint`                   | Every linter in every module, then a spell check.                                                                     |
| `just test`                   | API tests on databases of their own in the compose Postgres, web unit and browser tests, and the Swift package tests. |
| `just api::test [args]`       | API tests. Args narrow the run and drop coverage.                                                                     |
| `just web::test [args]`       | Web tests. Args go to vitest.                                                                                         |
| `just web::stress <n> [args]` | Web tests `n` times, shuffled, a new order each run. Prints failing seeds; `SEED=<seed>` replays one.                 |
| `just site::test [args]`      | Builds the site, then runs its tests against the output. Args go to vitest.                                           |
| `just apple::test [args]`     | Swift package tests on the Mac. Args go to `swift test`.                                                              |
| `just apple::build`           | The app for the iOS Simulator and macOS, unsigned.                                                                    |
| `just typos [paths]`          | Spell check.                                                                                                          |
| `just e2e [args]`             | The Playwright suite. Args go to Playwright.                                                                          |

The end-to-end suite:

- Signs in through the Clerk development instance and spends its usage
  limits. It needs `CLERK_SECRET_KEY` and `E2E_CLERK_USER_EMAILS` in
  `web/.env`, and the same development key as `CROSSTUNE_CLERK_SECRET_KEY`
  in `api/.env`.
- Runs one worker per address in `E2E_CLERK_USER_EMAILS`, and each worker
  signs in as its own user, so workers never share data. A spec that
  deletes or changes the account makes its own user with
  `createThrowawayUser` and removes it with `removeClerkUser`, both in
  `web/e2e/helpers.ts`.
- Serves the API on 8001 against `crosstune_e2e`, created for the run and
  dropped afterwards, so it runs beside `just dev` and starts empty.
- To keep the database after a failure, run `just api::run-e2e`, then
  `just web::e2e` in a second terminal. `just api::e2e-db-reset` empties it.
- Queries by accessible name. A renamed label, heading, or group needs
  `web/e2e/` checked, and only this suite catches it.
- Runs the recording specs in `web/e2e/`, the only place they run.

In CI, a failed Playwright test reruns once before it fails the run. A test
that passed only on a rerun leaves the job green and uploads the
`playwright-report` artifact. The `Web` workflow's browser tests rerun up to
twice, and its job summary lists every test that needed a rerun.

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
  web client, the web client's generated vocabulary file, the Apple app's
  Swift client, and its own generated vocabulary file. CI fails when the
  committed copies drift.
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
- A merge to `main` that changes a file under `site/` deploys the site to
  production. The site has no development deploy and no part in a release.
- A version tag deploys the API and the web client to production. The
  `Release` workflow moves the `production` branch to the tag, and both
  hosts deploy from that branch. Nothing else writes to `production`.
- A pull request from a branch of this repository that changes a file
  under `api/` gets its own API, database, and recording prefix. Any other
  PR's preview uses the development API. A PR from a fork or from
  Dependabot gets none, because its run has no Actions secrets. The
  `Preview` workflow creates a Neon branch `pr-<n>` from development and a
  Railway environment `pr-<n>` on the PR branch, with the `pr-<n>/` prefix
  of the preview bucket. A KV entry maps the PR's preview alias to that
  API. Every push resets the Neon branch and migrates it to the PR's
  schema, so preview data is lost. Every push also copies into the prefix
  each object of the development bucket whose copy is missing, has a
  different size, or is older. Closing the PR deletes the Railway
  environment, the Neon branch, the KV entry, the
  `pr-<n>/` prefix, and the `crosstune / pr-<n>` GitHub environment that
  Railway's deploys create. The 90-day lifecycle rule on the preview bucket is
  the backstop for a failed prefix deletion. If cleanup fails, run the
  workflow from the Actions tab with the PR number.
- CI runs on every pull request and push to `main`. `API` lints, type
  checks, tests on Postgres 18, and checks the OpenAPI contract. Its lint
  job also runs actionlint and zizmor on the workflows and shellcheck on
  the scripts, so it starts for any change under `.github/`. `Web`
  lints, type checks, tests, builds, and checks the generated types.
  `Site` lints, type checks, tests the built pages, and validates the
  Worker config with a dry run.
  All three start on every PR, skip their jobs when it touches nothing
  they cover, and are required checks. A skipped job passes a required
  check.
  `Apple` runs on GitHub's `xcode-27` image: it lints, runs the Swift
  package tests, builds for the iOS Simulator and macOS, and checks the
  generated Swift client and vocabulary file. It runs only when `apple/` or
  the contract changes, and no host deploys from it. It is not a required
  check, because a required check must run on every PR and macOS minutes
  cost more. `E2E` runs Playwright on a PR that changes `web/` or `api/`
  beyond their unit and browser tests, test helpers, and Markdown, and on
  demand. It
  is not a required check, because a Clerk outage would block unrelated
  merges. It skips fork and Dependabot PRs, which cannot sign in.
- A workflow from a fork runs only after you approve it on the PR.
- Dependabot runs monthly and skips a release until it is seven days old.
  npm and uv updates arrive as one grouped PR per ecosystem; every other
  ecosystem opens one PR per dependency, so closing that PR skips the
  version. To decline one update in a grouped PR, comment
  `@dependabot ignore <dependency>` instead of closing it. Its PR title is
  the squashed commit's subject. Check a PR that bumps
  `packageManager` in `web/package.json`: it needs the pnpm step below.
- A change to `.github/dependabot.yml` makes Dependabot close every grouped
  PR the old config built. Merge the open ones before you push the change.
- A development deploy waits for CI (Railway's Wait for CI). Production has
  no host-side gate; the `Release` workflow is the gate. The site's gate is
  the pull request's checks.
- An idle Railway environment should show the API as sleeping within 10
  minutes. If it never does, something sends outbound traffic: an open
  connection, a timer, or telemetry. `railway logs --network` shows the
  connections.

## Release

On `main` with a clean tree:

```bash
git switch main && git pull
just bump
git push --follow-tags origin main
```

- `just bump` runs commitizen. It picks the increment from the commits,
  writes the version to the API package, `web/package.json`, the Apple
  app's `apple/Config/Version.xcconfig`, and `.cz.toml`,
  refreshes `api/uv.lock`, updates `CHANGELOG.md`, commits, and tags
  `v<version>`. `just bump --dry-run` shows the plan.
- Bump on `main` only. A tag on a PR branch points at a commit the squash
  merge never lands, and the workflow refuses it.
- The tag push runs the `API`, `Web`, and `Apple` workflows on the tagged
  commit, checks that it is on `main`, and force-pushes `production`. The
  bump commit itself skips CI on `main`, so each release runs the checks
  once. Every release rebuilds both services. A failing `Apple` check or
  **Archive the Apple apps** job holds the whole release.
- The archive job signs the iOS and macOS release builds with build number
  `<run number>.<attempt>` beside the checks. After `production` moves, the
  **Upload to TestFlight** job uploads those archives, and the internal
  testers get them once Apple processes them.
- A failed upload does not undo production. Re-run the **Archive the Apple
  apps** job, which raises the attempt and re-runs the jobs after it. A
  re-run of the upload alone sends the same build number, which App Store
  Connect refuses once it has that build. The same release runs from a Mac
  with `just apple::testflight <build number>` and the key in `apple/.env`.
  Use a build number higher than every uploaded build.
- Each version is its side's Sentry release tag.
- A home-screen install keeps the icon it was installed with. A release that
  changes the icon says so.
- When you bump pnpm in `web/package.json` or `site/package.json`, change
  `PNPM_VERSION` in that Worker's build variables in the same change. Node
  is the module's `.node-version`.

A change to the shape of a synced row:

- The API refuses a push with an unknown field or a missing required
  field, and the refused edit is lost. A push without an optional field
  stores its default, so a client that predates the field resets it. One
  tag deploys both sides within minutes of each other, in either order.
- Once the app has real users, a shape change is staged so no edit is
  lost: an API release that accepts both shapes, then the client, then an
  API release that drops the old field.
- While the app is pre-release, a clean break ships in one tag. An edit
  made while the two sides disagree is lost. After both hosts deploy,
  reload the app: the service worker updates and the local database
  migrates.
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
- A local shape change adds a Dexie version with an upgrader on the web
  and appends a migration to `Schema.migrator` on Apple, and extends that
  client's migration test. Neither may drop unsent edits or unuploaded
  recordings or scans. A merged Apple migration is never
  edited, since a store that applied it never runs it again, and never
  renamed, since a store holding an identifier the build does not know
  reads as one a newer build wrote and the app deletes it.

Rollback:

- One host: redeploy an earlier build from its dashboard.
- The site: revert on `main`, or roll back to an earlier version on the
  `crosstune-site` Worker's Deployments tab. A release does not touch it.
- Both hosts: Actions tab, `Release` workflow, **Run workflow**, choose the
  older tag under **Use workflow from**. It also uploads that version to
  TestFlight with a new build number, so testers get the build that matches
  the API.
- A rollback across a migration fails the pre-deploy command. Roll forward,
  or downgrade the schema first.
- A client outage loses no edits. The outbox holds them.
- A rollback past a release that changed a local database, a web
  rollback or an older TestFlight build, deletes that local database on
  every device and pulls again, losing unsent edits and unuploaded
  recordings and scans. Roll forward instead.

## Smoke check

After a deploy, from the repository root, with no credentials:

```bash
just smoke https://api.<domain> https://my.<domain> https://<domain>
```

The `Smoke` workflow runs the same script. Blank inputs use the
`API_ORIGIN_PRODUCTION`, `WEB_ORIGIN_PRODUCTION`, and
`SITE_ORIGIN_PRODUCTION` Actions variables. It checks that `/healthz`
answers ok, that an anonymous `/v1/me` is a 401 problem document from the
API and through the web origin, and that the web origin serves the app
shell, the manifest, the service worker, and the shell for a client-side
route. The site origin is optional. With it, the script also checks the
home page, `/privacy`, `/terms`, `/support`, a revalidating `/sw.js`, and
that `/v1/me` on the site is a 404, since the site never proxies the API.

For a pull request, point it at the PR's Railway hostname and preview URLs.

The manual phone test covers what the script cannot:

1. Open `https://my.<domain>` and sign in.
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
