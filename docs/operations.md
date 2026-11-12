# Crosstune operations

Setup, worktrees, recipes and tooling, Apple builds, and the procedures
and gotchas of testing, releasing, deploying, and rolling back.

- Every recipe: `just --list`. A recipe's arguments:
  `just --usage <recipe>`.
- How each deployable reads its settings: `architecture.md`,
  Configuration.

## Prerequisites

| Tool                                                   | Version        | Notes                                                                                              |
| ------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------- |
| [uv](https://docs.astral.sh/uv/)                       | any            | Installs Python 3.13, the API's dependencies, and the root tooling with the git hooks.             |
| [Node.js](https://nodejs.org/)                         | 22.22 or newer | Runs the web toolchain.                                                                            |
| [pnpm](https://pnpm.io/)                               | 12.11.2        | Pinned in `web/package.json`. `corepack enable` installs it.                                       |
| [just](https://just.systems)                           | 1.46 or newer  | The task runner. Recipe options and argument help need 1.46.                                       |
| [Docker](https://docs.docker.com/get-docker/)          | any            | Runs Postgres 18, RustFS, and the API's ffmpeg for development and the API tests. Must be running. |
| [ffmpeg](https://ffmpeg.org/)                          | any            | Builds the App Store preview. The API never uses it.                                               |
| [Xcode](https://developer.apple.com/xcode/)            | 27             | Builds and tests the Apple app. Root `lint`, `format`, and `test` need it.                         |
| [Periphery](https://github.com/peripheryapp/periphery) | 3.8            | Finds unused Swift code for `just apple::deadcode`.                                                |

Also a free [Clerk](https://clerk.com) development instance:

- Sign-in methods on: email verification code, Apple, and Google. The
  Apple app's welcome screen calls Apple and Google sign-in directly.
- From its dashboard: the Frontend API URL
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
6. Optional: shell completion for recipe and module names. For zsh,
   `just --completions zsh > ~/.zfunc/_just`, with `~/.zfunc` on `fpath`.

Migrations run each time `just dev` starts. Nothing is created by hand.

## Worktrees

When to use each recipe: `CLAUDE.md`, Worktrees.

- `just worktree <branch>`:
  - Adds `.worktrees/<branch>`.
  - Copies every module's `.env`, `apple/Config/Secrets.xcconfig`, and
    `apple/Config/Local.xcconfig` from the main checkout.
  - Runs `just setup`, so `just e2e` works there.
  - Makes the worktree's database and bucket.
- A worktree made another way: run `just worktree-env`, then
  `just setup`. `just dev` makes its database and bucket.
- One Postgres container for every checkout. Each worktree has its own
  database and bucket, copied from main's by `just api::worktree-db`, so
  one branch's migrations never reach another.
  `just api::worktree-db-reset` takes a fresh copy.
- `just worktree-remove <branch>` deletes the worktree's database,
  bucket, and builds. It deletes the branch once `main` or `origin/main`
  holds its work, squash merges included.

## Run

- Start at `localhost:4321`. Sign in leads to the app on 5173. The API
  answers `{"status":"ok"}` at `localhost:8000/healthz`.
- `just api::testdata <account>` seeds a local account and sets its
  billing state. Needs `CROSSTUNE_TESTDATA_ENABLED=true` in `api/.env`.
- Browsers reach RustFS through the dev server's `/storage` proxy. The
  RustFS console: `localhost:9001`, `crosstune` / `crosstune-local-secret`.
- The API's recipes, `just dev` included, put `scripts/media-tools.sh`
  first on `PATH`. It runs ffmpeg and ffprobe inside the API image's
  `media` stage, so local runs, CI, and production use one ffmpeg build.
- An API restart runs the orphan sweep: it deletes every local file with
  no user, recording, or scan row.
- `just dev-down` keeps the Postgres and RustFS volumes.
  `docker compose down -v` deletes them.

### Apple app

- The Debug build calls the API on 8000 and signs in against the Clerk
  development instance.
- Recordings need `just dev`. The local API signs recording URLs as
  `/storage/...`, which go through the web dev server's proxy on 5173.
- A device build reaches the Mac through Tailscale Serve:
  1. Run `just dev`, then `tailscale serve 5173`.
  2. In `web/.env`, add `.ts.net` to `LOCAL_ALLOWED_HOSTS`.
  3. Run `just apple::setup`. It writes the device's origins into
     `apple/Config/Local.xcconfig`, which git ignores and only Debug
     builds read. Its settings carry `[sdk=iphoneos*]`, so the Simulator
     and the Mac keep localhost.
- `just apple::run` installs one copy that every worktree shares, so the
  keychain trusts it once. It waits while another worktree holds the copy.
  `just apple::status` names the holder.
- `just apple::shots` needs the screen unlocked, and Screen Recording and
  Accessibility for the app that hosts Peekaboo's daemon, not the
  terminal. `peekaboo bridge status` names that app and shows its grants.

### Apple builds

- An `xcodebuild` that no recipe covers: from `apple/`, run
  `scripts/xcodebuild.sh`, which shares the Swift packages, with
  `-derivedDataPath .build/DerivedData`. Never a folder of its own.
  Nothing deletes a one-off folder, and each holds gigabytes.
- `just apple::prune-builds` deletes the builds of every checkout that no
  build tool uses. Run it when the disk is low.
- A script that uses a build after `xcodebuild` exits sources
  `scripts/in-use.sh`. Without it, a prune can delete the build under the
  script.

### Drive a running app

Peekaboo for the Mac app, Maestro for the iOS simulators. `peekaboo learn`
and `maestro --help` list their commands. Never take focus from the
developer: `CLAUDE.md`, Apple app.

- Peekaboo (v4): target the app with `--pid`, from
  `pgrep -f "Crosstune Dev.app"`.
  - Read: `peekaboo see --pid <pid>`. `--tree` gives the accessibility
    tree.
  - Act: `action`, `set-value`, or `menu`, with
    `--input-strategy actionOnly`.
  - Wait: `verify`.
  - Screenshot behind other windows:
    `peekaboo see --pid <pid> --no-elements --path <file>`.
- Maestro: `--udid`, from `xcrun simctl list devices booted`.

## Review shots

`just shots NAME...` captures the branch and its merge base with main on
each platform that the branch changed. It writes a page of the shots that
differ to `.cache/shots/review/`.

- A name is a `SampleScreen` case. A screen with no case cannot be
  captured, so a new Apple screen needs one.
- The base runs in `.worktrees/shots-base`, a detached checkout that the
  script owns and resets on each run. Never work in it.
- Base shots are cached by commit in the main checkout's
  `.cache/shots/base/`. The base's Apple builds are deleted when the run
  ends, so the first run after main moves builds the base from scratch.
- Two runs on one commit give the same pixels, or every review shows
  noise:
  - A capture writes a shot only once two screenshots in a row match.
  - Anything that moves on its own, such as a playing recording, stops at
    a fixed point before the shot.

## Test

`just test`: every unit and integration suite. `just e2e`: Playwright.

### Gate cache

Every lint and test recipe runs through
[gate-cache](https://github.com/natelandau/gate-cache). It records a pass
against the git tree of every file git does not ignore, committed or not.
A second run on the same tree skips. Hooks, people, and agents share the
passes, in every worktree. Off when `CI` is set.

- A pass on uncommitted work also covers its commit.
- `just gate status`: what passed and failed on the tree, with no run.
  `just gate status --name <gate>`: whether one gate would skip.
- `GATE_CACHE_DISABLE=1 just <recipe>` forces a run. After a change to an
  input that no gate is keyed on: `just gate clear`.
- A recipe run with arguments always runs and records nothing. A recipe
  that forwards arguments passes their count with `--argc "$#"` and
  appends them to the command, so the command is written once.
- A new lint or test recipe runs through `{{ gate }}` under a name that no
  other gate uses.
- A gate that reads an ignored file, such as a module's `.env`, names it
  with `--file`. A gate that depends on a tool no lockfile pins, such as
  Node, ffmpeg, or Xcode's Swift, names its version command with
  `--tool`. A hash of both joins the gate name.
- A gate never reads a service: gate-cache cannot see a service change.
  The one exception is `api-test`. Each run creates and migrates its own
  databases from the tree and drops them after.

### End-to-end suite

- `just e2e` starts Postgres, its own API on :8001, and its own preview
  server against its own `crosstune_e2e` database. It signs in against
  the shared Clerk development instance and spends its usage limits.
- Needs `CLERK_SECRET_KEY` and `E2E_CLERK_USER_EMAILS` in `web/.env`, and
  the same development key as `CROSSTUNE_CLERK_SECRET_KEY` in `api/.env`.
- One worker per address in `E2E_CLERK_USER_EMAILS`, each signed in as its
  own user, so workers never share data.
- A spec that deletes or changes the account makes its own user with
  `createThrowawayUser` and removes it with `removeClerkUser`
  (`web/e2e/helpers.ts`).
- The recording specs run only here.
- To keep the database after a failure: `just api::run-e2e`, then
  `just web::e2e` in a second terminal. `just api::e2e-db-reset` empties
  it.

### Web screenshots

- `*.visual.test.tsx` files compare elements with PNG baselines beside
  them. The baselines come from CI's Playwright image on `linux/amd64`.
- Run them only with `just web::test-visual`, in Docker. Never run the
  `visual` project natively: a Mac draws fonts differently, and every
  image fails.
- A deliberate design change fails them:
  1. Make the baselines again with `just web::test-visual --update`.
  2. Look at the changed images before you commit them. A failed run puts
     each diff in `web/.vitest/attachments`.
- A capture waits until no animation runs, so a cross-fade or a spinner
  never lands in a baseline.
- `just test` leaves out the `visual` project. CI runs it on one shard.

## CI

- `API`, `Web`, `Site`, `Analytics`, and `Scripts` start on every PR and
  skip the jobs for what the PR does not change, so they can be required
  checks. Each filter names only what that module's checks read.
- A module's inputs are listed once, in `AREAS` in
  `scripts/tests/test_change_filters.py`. Its tests fail when a
  workflow's `paths`, its `changes` regex, or the pre-push test hook
  differs from that list.
- `Repo` runs the repo-wide hooks (`just lint-repo`) on every PR, with no
  filter.
- Not required checks:
  - `Apple`: runs only when `apple/`, the contract, or the tracking plan
    changes.
  - `E2E`: a Clerk outage never blocks an unrelated merge.
- A workflow from a fork runs only after you approve it on the PR.
- A failed Playwright test runs once more. A test that passed only on the
  second run leaves the job green and uploads `playwright-report`.
- The `Web` workflow's browser tests run up to twice more. Its job summary
  lists every test that needed another run.
- The `Web` test shards run in Playwright's container image. Its tag
  follows the `playwright` version in `web/package.json`. Change both
  together. `just web::playwright-image` fails when they differ.
- An API test that uses RustFS skips locally when RustFS is down. In CI it
  always runs, and fails without RustFS.

## Recipes and tooling

- A recipe goes in its module's justfile, with a `[group(...)]` that
  matches its neighbors. A root aggregate calls every module.
- Operator commands that read or change accounts go in the `ops` module
  (`api/ops.just`), never in `api`.
- A recipe body is a few lines. Anything longer is a script that the
  recipe calls:
  - A decision worth a test, such as parsing, choosing, or comparing:
    Python in `scripts/` or `apple/scripts/`, tested in their `tests/`
    folders, with no dependency outside the root tooling project.
    `just scripts::lint` and `just scripts::test` cover both.
  - Commands in order, with waits, retries, and cleanup: a bash script.
- Developer tools (linters, hooks, release commands, and what the tooling
  scripts import) go in the root `pyproject.toml`. Run them with `uv run`
  from the root, or `uv run --project ..` from a module.
- `api/pyproject.toml` holds only what the API and its tests need, so the
  API image and its lockfile carry no tooling.

## Commit

- Conventional commits. Every `cz` command runs from the root, where
  `.cz.toml` is.
- A model change: `just api::makemigrations "message"`, read the file,
  then `just api::migrate`.
- An API change: `just contract` makes the OpenAPI file and every
  generated client and vocabulary copy again.
- A validated value or length:
  1. Edit `api/src/crosstune/vocabulary.py`.
  2. Write the migration for its check constraint or column.
  3. Run `just contract`.
  4. Give a new value its label in `web/src/constants.ts`.
- Squash merges only. The PR title and body become the commit message, so
  a breaking change needs `!` in the PR title and a `BREAKING CHANGE:`
  paragraph in the PR body. The footers of the branch commits are lost.

## Delivery

- A merge to `main` deploys development: Railway when `api/` changed,
  Workers Builds when `web/` changed. A development deploy waits for CI.
- A merge to `main` that changes `site/` deploys the site to production.
  The site has no development deploy and no part in a release. Copy about
  an unreleased feature waits until that release ships.
- A version tag deploys the API and the web client to production. The
  `Release` workflow moves the `production` branch to the tag, and both
  hosts deploy from it. Nothing else writes to `production`. The workflow
  is production's only gate.
- A PR from a branch of this repository that changes `api/` gets its own
  API (Railway `pr-<n>`), database (Neon branch), and recording prefix,
  through the `Preview` workflow.
  - Any other PR's preview uses the development API.
  - A fork or Dependabot PR gets no preview: its run has no Actions
    secrets.
  - Every push to the PR resets its Neon branch, and preview data is lost.
  - Closing the PR deletes its environment. If the cleanup fails, run
    `Preview` from the Actions tab with the PR number. The preview
    bucket's lifecycle rule deletes what remains.
- An idle Railway environment shows the API as sleeping within 10
  minutes. If it never does, something holds outbound traffic open: a
  connection, a timer, or telemetry. `railway logs --network` shows the
  connections.

## Dependencies

- `just update` upgrades the uv, pnpm, and Swift packages and the hook
  versions. Only Dependabot PRs move the Docker image tags in
  `api/Dockerfile` and `compose.yml` and the GitHub Actions versions. A
  full update: `just update`, plus those PRs.
- Dependabot runs monthly and skips a release until it is seven days old.
  - Decline one update in a grouped PR: comment
    `@dependabot ignore <dependency>`. Closing a grouped PR declines all
    of it.
  - Run it off schedule: **Insights**, **Dependency graph**,
    **Dependabot**, then **Check for updates** beside a manifest.
  - Build an open PR again against the newest releases:
    `@dependabot recreate`.
  - A change to `.github/dependabot.yml` closes every grouped PR that the
    old config made. Merge the open ones first.
- A pnpm version change in `web/package.json` or `site/package.json`,
  Dependabot's `packageManager` PRs included, changes `PNPM_VERSION` in
  that Worker's build variables in the same change. Node is the module's
  `.node-version`.

## Release

On `main`, with a clean tree:

```bash
git switch main && git pull
just bump
git push --follow-tags origin main
```

- `just bump` picks the increment from the commits, writes the version
  everywhere it is, updates `CHANGELOG.md`, commits, and tags
  `v<version>`. `just bump --dry-run` shows the plan.
- Bump on `main` only. A tag on a PR branch points at a commit that the
  squash merge never lands, and the workflow refuses it.
- The tag push runs `API`, `Web`, and `Apple` on the tagged commit, then
  force-pushes `production`. A failing `Apple` check or **Archive the Apple
  apps** job stops the whole release.
- After `production` moves, **Upload to TestFlight** uploads the archives,
  built as `<run number>.<attempt>`.
- A failed upload does not undo production.
  - Run **Archive the Apple apps** again, which raises the attempt. A
    second run of the upload alone sends the same build number, and App
    Store Connect refuses it.
  - From a Mac: `just apple::testflight <build number>`, higher than every
    uploaded build. Needs the Sentry variables in `apple/.env`, the
    PostHog token and `SENTRY_DSN` in `apple/Config/Secrets.xcconfig`, and
    `sentry-cli`.
- The App Store gets a release only when you submit its TestFlight build
  for review. The App Store version equals the build's
  `MARKETING_VERSION`. An App Store release cannot be rolled back. A fix
  is a new build, after its own review.
- A home-screen install keeps the icon it was installed with. A release
  that changes the icon says so.

### A change to a synced row's shape

The API and the web client deploy within minutes of each other, in either
order. App Store builds arrive days later, and old builds run until each
musician updates. The API refuses a push with an unknown or missing
required field, and that edit is lost. A shape change goes out in stages:

1. An API release that accepts both shapes.
2. The clients that send the new shape, through App Store review.
3. `CROSSTUNE_APPLE_MIN_VERSION` raised past every Apple build that sends
   the old shape (`architecture.md`, Supported client versions).
4. An API release that drops the old shape.

- A migration that renames or drops a table or column breaks the running
  API between the pre-deploy migration and the new API's healthcheck.
  Every pull fails in that window. A push fails when its rows, or their
  parents, are in the changed table. No edit is lost, but a transcode
  claimed in that window spends a retry.
- A value added to a validated vocabulary is recognized by the clients in
  one release and offered in a later one: on the web once the API that
  accepts it is live, on Apple once `CROSSTUNE_APPLE_MIN_VERSION` is past
  the first build that recognizes it.
- Local database changes: `architecture.md`, Sync.

### Rollback

- One host: deploy an earlier build again from its dashboard.
- The site: revert on `main`, or roll back on the `crosstune-site`
  Worker's Deployments tab.
- Both hosts: Actions tab, `Release` workflow, **Run workflow**, the older
  tag under **Use workflow from**. It also uploads that version to
  TestFlight with a new build number. App Store installs keep their build.
- Roll forward, never back, past:
  - An API release that accepts a new shape. The API would refuse pushes
    from App Store builds that send it, and those edits are lost.
  - A release that changed a local database. Every device deletes it and
    pulls again, and loses unsent edits and unuploaded files.
- A rollback across a migration fails the pre-deploy command. Roll
  forward, or downgrade the schema first.

## Smoke check

After a deploy, from the root, with no credentials:

```bash
just smoke https://api.<domain> https://my.<domain> https://<domain>
```

The `Smoke` workflow runs the same script. Blank inputs use the
`*_ORIGIN_PRODUCTION` Actions variables. For a pull request, give it the
PR's Railway hostname and preview URLs.

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
- A `duo-` prefix runs a capture on the iPhone Duo: an iPhone capture
  with the Duo closed, an iPad capture with it open. With no names, every
  `store-` capture also runs on the Duo.
- No simctl command folds a simulator. When a run needs the Duo folded
  the other way, it waits for a person to fold or unfold it in DeviceHub.
- XCUIScreen sees only the Duo's outer display. The script takes the
  open Duo's stills with `simctl io`, and the tests wait for each one.
- Order: `capture-test`, then `capture-mac`, then framing. `capture-test`
  empties the folder that the Mac stills go in. `capture-mac` needs the
  screen unlocked.
- Framing draws HTML in Google Chrome with the site's font, so it needs
  Chrome and `just setup`. The preview needs ffmpeg.
- The capture simulators are never signed in to an Apple Account, so no
  system alert covers a capture. Location is refused, so a recording
  never opens on the location note.
- The `Marketing` test plan turns off code coverage. With it on, the
  Swift compiler crashes on the tuner's `isolated deinit`.
