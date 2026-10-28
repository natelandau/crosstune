# Crosstune operations

Setup, and the procedures and gotchas of testing, releasing, deploying,
and rolling back. `just --list` describes every recipe. How each
deployable reads its settings: `architecture.md`, Configuration.

## Prerequisites

| Tool                                                   | Version        | Notes                                                                           |
| ------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------- |
| [uv](https://docs.astral.sh/uv/)                       | any            | Installs Python 3.13, the API's dependencies, and the git hooks.                |
| [Node.js](https://nodejs.org/)                         | 22.22 or newer | Runs the web toolchain.                                                         |
| [pnpm](https://pnpm.io/)                               | 12.11.2        | Pinned in `web/package.json`. `corepack enable` installs it.                    |
| [just](https://just.systems)                           | any            | The task runner.                                                                |
| [Docker](https://docs.docker.com/get-docker/)          | any            | Runs Postgres 18 and RustFS for development and the API tests. Must be running. |
| [ffmpeg](https://ffmpeg.org/)                          | any            | Transcodes recordings. Without it the API tests that use audio skip.            |
| [Xcode](https://developer.apple.com/xcode/)            | 27             | Builds and tests the Apple app. Root `lint`, `format`, and `test` need it.      |
| [Periphery](https://github.com/peripheryapp/periphery) | 3.8            | Finds unused Swift code for `just apple::deadcode`.                             |

Also a free [Clerk](https://clerk.com) development instance with email
verification code, Apple, and Google sign-in on. The Apple app's
welcome screen calls Apple and Google sign-in directly. From its
dashboard: the Frontend API URL
(`https://<slug>.clerk.accounts.dev`) and the publishable key
(`pk_test_...`).

## Set up once

In the main checkout:

1. Start Docker.
2. Run `just dev-setup`. It installs dependencies and the git hooks,
   creates each module's `.env` from its example, and starts Postgres and
   RustFS with their buckets.
3. In `api/.env`, set `CROSSTUNE_CLERK_ISSUER` to the Frontend API URL.
4. In `web/.env`, set `VITE_CLERK_PUBLISHABLE_KEY` to the publishable key.
5. In Xcode > Settings > Locations, set Derived Data to Relative,
   `.build/DerivedData`, so removing a worktree removes its build.

Migrations run every time `just dev` starts. Nothing is created by hand.
Worktrees: `CLAUDE.md`, Task runner.

## Run

- Start at `localhost:4321`, where Sign in leads to the app on 5173. The
  API answers `{"status":"ok"}` at `localhost:8000/healthz`.
- `just api::testdata <account>` seeds and sets the billing state of a
  local account. It needs `CROSSTUNE_TESTDATA_ENABLED=true` in `api/.env`.
- Browsers reach RustFS through the dev server's `/storage` proxy. Its
  console is at `localhost:9001` (`crosstune` / `crosstune-local-secret`).
- A restart of the API runs the orphan sweep, which deletes every local
  file with no user, recording, or scan row.
- `just dev-down` keeps the Postgres and RustFS volumes.
  `docker compose down -v` removes them.

Apple app:

- The Debug build calls the API on 8000 and signs in against the Clerk
  development instance. Recordings need `just dev`: the local API signs
  recording URLs as `/storage/...`, which go through the web dev server's
  proxy on 5173.
- A device build reaches the Mac through Tailscale Serve: run `just dev`,
  then `tailscale serve 5173`, and list `.ts.net` in `LOCAL_ALLOWED_HOSTS`
  in `web/.env`. `just apple::setup` writes the device's origins into
  `apple/Config/Local.xcconfig`, which git ignores and only Debug builds
  read. Its settings carry `[sdk=iphoneos*]`, so the Simulator and the Mac
  keep localhost.
- `just apple::shots` needs the screen unlocked.

## Test

`just test` runs every unit and integration suite. `just e2e` runs
Playwright.

### Gate cache

A lint or test recipe runs through
[gate-cache](https://github.com/natelandau/gate-cache). It records a pass
against the git tree of every file git does not ignore, committed or not,
and skips when the recipe runs again on the same tree. Hooks, people, and
agents share the passes, in every worktree. It turns itself off when `CI`
is set.

- A recipe run with args always runs and records nothing. A recipe that
  forwards args passes their count with `--argc "$#"` and appends them to
  the command, so it spells the command once.
- A gate that reads an ignored file, such as a module's `.env`, names it
  with `--file`. One that depends on a tool no lockfile pins, such as Node,
  ffmpeg, or Xcode's Swift, names its version command with `--tool`. A
  hash of both joins the gate name.
- A gate never reads a service, since gate-cache cannot see one change.
  `api-test` is the one exception: every run creates and migrates its own
  databases from the tree and drops them after.
- `just gate status --name <gate>` says whether one gate would skip.

### End-to-end suite

- Needs `CLERK_SECRET_KEY` and `E2E_CLERK_USER_EMAILS` in `web/.env`, and
  the same development key as `CROSSTUNE_CLERK_SECRET_KEY` in `api/.env`.
- One worker per address in `E2E_CLERK_USER_EMAILS`, each signed in as its
  own user, so workers never share data. A spec that deletes or changes
  the account makes its own user with `createThrowawayUser` and removes it
  with `removeClerkUser` (`web/e2e/helpers.ts`).
- The recording specs run only here.
- To keep the database after a failure: `just api::run-e2e`, then
  `just web::e2e` in a second terminal. `just api::e2e-db-reset` empties
  it.

### In CI

- A failed Playwright test reruns once. One that passed only on a rerun
  leaves the job green and uploads `playwright-report`. The `Web`
  workflow's browser tests rerun up to twice, and its job summary lists
  every test that needed a rerun.
- The `Web` test shards run in Playwright's container image. Its tag
  tracks `web/package.json`'s `playwright` version, and
  `just web::playwright-image` fails when they differ, so bump both
  together.
- An API test that uses RustFS skips locally when RustFS is down, and
  fails in CI, where it always runs.

## Commit

- Conventional commits. The commit-msg hook rejects any other. Every `cz`
  command runs from the root, where `.cz.toml` is.
- A model change: `just api::makemigrations "message"`, review the file,
  then `just api::migrate`.
- An API change: `just contract` regenerates the OpenAPI file and every
  generated client and vocabulary copy.
- A validated value or length: edit `api/src/crosstune/vocabulary.py`,
  write the migration for its check constraint or column, run
  `just contract`, and give a new value its label in
  `web/src/constants.ts`.
- Squash merges only. The PR title and body become the commit message, so
  a breaking change needs `!` in the PR title and a `BREAKING CHANGE:`
  paragraph in the PR body. The branch commits' footers are dropped.

## Delivery

- A merge to `main` deploys development: Railway when `api/` changed,
  Workers Builds when `web/` changed. A development deploy waits for CI.
- A merge to `main` that changes `site/` deploys the site to production.
  The site has no development deploy and no part in a release, so copy
  about an unreleased feature waits until that release ships.
- A version tag deploys the API and the web client to production: the
  `Release` workflow moves the `production` branch to the tag, and both
  hosts deploy from it. Nothing else writes to `production`. The workflow
  is production's only gate.
- A pull request from a branch of this repository that changes `api/` gets
  its own API (Railway `pr-<n>`), database (Neon branch), and recording
  prefix, through the `Preview` workflow. Any other PR's preview uses the
  development API. A fork or Dependabot PR gets none: its run has no
  Actions secrets.
- Every push to such a PR resets its Neon branch, so preview data is lost.
  Closing the PR deletes its environment. If cleanup fails, run `Preview`
  from the Actions tab with the PR number. The preview bucket's lifecycle
  rule is the backstop.
- `API`, `Web`, `Site`, and `Analytics` start on every PR and skip jobs for
  what it does not touch, so they can be required checks. `Apple` runs
  only when `apple/`, the contract, or the tracking plan changes, so it is
  not required. `E2E` is not required, so a Clerk outage never blocks
  unrelated merges.
- A workflow from a fork runs only after you approve it on the PR.
- Dependabot runs monthly and skips a release until it is seven days old.
  To decline one update in a grouped PR, comment
  `@dependabot ignore <dependency>`. Closing a grouped PR declines all of
  it. A PR that bumps `packageManager` needs the pnpm step under Release.
- A change to `.github/dependabot.yml` closes every grouped PR the old
  config built. Merge the open ones first.
- An idle Railway environment shows the API as sleeping within 10 minutes.
  If it never does, something holds outbound traffic open: a connection, a
  timer, or telemetry. `railway logs --network` shows the connections.

## Release

On `main` with a clean tree:

```bash
git switch main && git pull
just bump
git push --follow-tags origin main
```

- `just bump` picks the increment from the commits, writes the version
  everywhere it lives, updates `CHANGELOG.md`, commits, and tags
  `v<version>`. `just bump --dry-run` shows the plan.
- Bump on `main` only. A tag on a PR branch points at a commit the squash
  merge never lands, and the workflow refuses it.
- The tag push runs `API`, `Web`, and `Apple` on the tagged commit, then
  force-pushes `production`. A failing `Apple` check or **Archive the Apple
  apps** job holds the whole release.
- After `production` moves, **Upload to TestFlight** uploads the archives
  built as `<run number>.<attempt>`.
- A failed upload does not undo production. Re-run **Archive the Apple
  apps**, which raises the attempt. A re-run of the upload alone sends the
  same build number, which App Store Connect refuses. From a Mac:
  `just apple::testflight <build number>`, higher than every uploaded
  build. It needs the Sentry variables in `apple/.env`, the PostHog token
  and `SENTRY_DSN` in `apple/Config/Secrets.xcconfig`, and `sentry-cli`.
- The App Store gets a release only when you submit its TestFlight build
  for review. The App Store version must equal the build's
  `MARKETING_VERSION`. An App Store release cannot be rolled back. A fix
  is a new build, after its own review.
- A home-screen install keeps the icon it was installed with. A release
  that changes the icon says so.
- A pnpm bump in `web/package.json` or `site/package.json` changes
  `PNPM_VERSION` in that Worker's build variables in the same change. Node
  is the module's `.node-version`.

### A change to a synced row's shape

The API and the web client deploy within minutes of each other, in either
order. App Store builds arrive days later, and old builds run until each
musician updates. The API refuses a push with an unknown or missing
required field, and that edit is lost. So a shape change is staged:

1. An API release that accepts both shapes.
2. The clients that send the new shape, through App Store review.
3. `CROSSTUNE_APPLE_MIN_VERSION` raised past every Apple build that sends
   the old shape (`architecture.md`, Supported client versions).
4. An API release that drops the old shape.

- A migration that renames or drops a table or column breaks the running
  API between the pre-deploy migration and the new API's healthcheck.
  Every pull fails in that window, and a push fails when its rows or their
  parents are in the changed table. No edit is lost, but a transcode
  claimed in the gap spends a retry.
- A value added to a validated vocabulary is recognized by the clients in
  one release and offered in a later one: on the web once the API that
  accepts it is live, on Apple once `CROSSTUNE_APPLE_MIN_VERSION` is past
  the first build that recognizes it.
- A local shape change adds a Dexie version with an upgrader on the web
  and appends a migration to `Schema.migrator` on Apple, and extends that
  client's migration test. Neither drops unsent edits or unuploaded files.
  A merged Apple migration is never edited, since a store that applied it
  never runs it again. Never renamed: a store holding an identifier the
  build does not know reads as one a newer build wrote, and the app
  deletes it.

### Rollback

- One host: redeploy an earlier build from its dashboard.
- The site: revert on `main`, or roll back on the `crosstune-site` Worker's
  Deployments tab.
- Both hosts: Actions tab, `Release` workflow, **Run workflow**, the older
  tag under **Use workflow from**. It also uploads that version to
  TestFlight with a new build number. App Store installs keep their build.
- Roll forward instead of rolling back past an API release that accepts a
  new shape: the API would refuse pushes from App Store builds that send
  it, and those edits are lost.
- Roll forward instead of rolling back past a release that changed a local
  database: every device deletes it and pulls again, losing unsent edits
  and unuploaded files.
- A rollback across a migration fails the pre-deploy command. Roll
  forward, or downgrade the schema first.

## Smoke check

After a deploy, from the root, with no credentials:

```bash
just smoke https://api.<domain> https://my.<domain> https://<domain>
```

The `Smoke` workflow runs the same script. Blank inputs use the
`*_ORIGIN_PRODUCTION` Actions variables. For a pull request, point it at
the PR's Railway hostname and preview URLs.

By hand on a phone, for what the script cannot check:

1. Open `https://my.<domain>` and sign in.
2. Add a tune and paste a YouTube link.
3. Install the app to the home screen.
4. Turn on airplane mode and edit the tune.
5. Turn off airplane mode.
6. Make sure that the edit synced. Settings shows the last sync time.

## App Store captures

Store screenshots and the App Preview come from XCTest recordings over one
fixture, `apple/Marketing/catalog.json`. The site uses no captures.

- A capture name is a test method without its `test` prefix. A run
  replaces every earlier capture, so run all of a set in one call.
- A name with `ipad` runs on the iPad. `folk` and `store-folk` run under a
  status bar with no signal.
- A `duo-` prefix runs a capture on the iPhone Duo: an iPhone capture with
  the Duo closed, an iPad capture with it open. With no names, every
  `store-` capture also runs on the Duo.
- No simctl command folds a simulator. When a run needs the Duo the other
  way, it waits for a person to fold or unfold it in DeviceHub.
- XCUIScreen sees only the Duo's outer display, so the script shoots the
  open Duo's stills with `simctl io` and the tests wait for each one.
- Run `capture-test` before `capture-mac`, since it clears the folder the
  Mac stills land in, and frame after both. `capture-mac` needs the screen
  unlocked.
- Framing renders HTML in Google Chrome with the site's font, so it needs
  Chrome and `just setup`. The preview needs ffmpeg.
- The capture simulators are never signed in to an Apple Account, so no
  system alert covers a capture, and location is refused, so a recording
  never opens on the location note.
- The `Marketing` test plan turns code coverage off: with it on, the Swift
  compiler crashes on the tuner's `isolated deinit`.
