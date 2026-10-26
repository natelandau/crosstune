# Crosstune

## Documentation

Docs exist for a future session that has none of today's context. The
code is the source of truth. A doc holds only what the code cannot say and
that session needs.

- Keep: guardrails, constraints, boundaries, sources of truth, and patterns
  every screen or module follows. "Every list filters by every facet of its
  items", not "the catalog filters by key".
- Less is more. Record a rule only when breaking it is likely and costly.
  Leave the rest to the agent's judgment.
- Never: a log of decisions or changes, what was tried, what a screen or
  module does, anything about one release (that goes in the pull
  request), or a line that restates code or config.
- State what holds now. Why it changed belongs in the commit message.
- Written for agents, not people: fragments, bullets, and tables in plain
  words. A reason only when it stops a future change from undoing the rule.
- When a change makes a line false, fix the line in the same change.
- `docs/README.md` says what each page holds and never holds. Check it
  before you write to a page.

Read, by task:

- Design or implementation work: `docs/product.md`.
- The stack, the API, the client's data layers, sync, sign-in, links, or
  recordings:
  `docs/architecture.md`.
- A screen, row, form, gesture, or label: `docs/design.md`.
- A Mac screen, row, control, or window: `docs/design.md`, then
  `docs/design-macos.md`.
- An iPhone screen, or an iPad in a compact window: `docs/design.md`, then
  `docs/design-ios.md`.
- An iPad screen at regular width: `docs/design.md`, `docs/design-ios.md`,
  then `docs/design-ipad.md`.
- A web screen, row, control, or sheet: `docs/design.md`, then
  `docs/design-web.md`.
- Before you add or change a design rule: "Writing these pages" in
  `docs/design.md` says which page it goes in.
- Setup, tests, releases, deployment, or CI: `docs/operations.md`.
- Analytics events: `docs/analytics.md`.

The repository is public, and so is everything committed: docs, comments,
commit messages, and pull requests. Feature specs, plans, design records,
host settings, credentials, account details, and anything else that should
not be public never go in it. Neither do the commands an operator runs
against production, such as granting a comp or a trial.

## Naming

- `violin`, never `fiddle`, and tune, never song, in the schema, the API,
  and every label. The glossary in `docs/product.md` has the reasons.
- Self-documenting names. Every name in code and docs says what the thing
  is, in the standard term a developer new to the project already knows:
  a button is a button, a toolbar is a toolbar. No metaphor, and no coined
  term that needs a glossary. The glossary's terms are the only project
  vocabulary.

## Task runner

- [just](https://just.systems), root plus modules. From the root:
  `just api::test`, `just web::lint`. Inside `api/`, `web/`, `site/`, or `apple/`,
  `just test` resolves to that module. `just --list` shows everything.
  The `apple` module needs Xcode. Xcode 27 has no Simulator.app; its
  simulators run in DeviceHub (`open -a DeviceHub`).
- Run the Mac app only with `just apple::run [app args]`, started as a
  background command, and always end with `just apple::done`, even after a
  failed check. Every worktree shares one installed copy, so the keychain
  trusts it once; `run` waits while another worktree holds it, and
  `just apple::status` shows who. Never launch a build from DerivedData.
- Build the Apple app with the `apple` recipes. An `xcodebuild` no recipe
  covers runs from `apple/` with `-derivedDataPath .build/DerivedData`, never a folder of
  its own: nothing deletes a one-off folder, and each holds gigabytes.
- To see or drive a running app, use Peekaboo for the Mac app and
  Maestro for the iOS simulators. Run `peekaboo learn` and
  `maestro --help` for their commands. Peekaboo: target the app with
  `--app Crosstune`, pass `--input-strategy actionOnly`, never pass
  `--foreground`, and never use `peekaboo agent`. Maestro: always pass
  `--udid` (from `xcrun simctl list devices booted`), since several
  simulators run at once.
- `run` opens the app in the background. Capture it with
  `screencapture -o -l<windowID>`, which works behind other windows. Never
  bring the app forward or send synthetic mouse or keyboard events: the
  developer is working on the same Mac.
- `just dev` runs Postgres, migrations, the API, the web client, and the
  site together. Every checkout and worktree shares one Postgres container,
  but each worktree gets its own database and bucket, copied from main's by
  `just api::worktree-db`, so one branch's migrations never reach another.
  `just api::worktree-db reset` takes a fresh copy.
- Do all work in a worktree, never in the main checkout.
- Create a worktree with `just worktree <branch>`, never `git worktree add`.
  It adds `.worktrees/<branch>`, copies every module's `.env`,
  `apple/Config/Secrets.xcconfig`, and `apple/Config/Local.xcconfig` from
  the main checkout, runs
  `just setup` so `just e2e` works there, and makes the worktree's
  database and bucket. In a worktree made any other way, run
  `just worktree-env`, then `just setup`; `just dev` makes the database
  and bucket. Never run
  `just dev-setup` in a worktree: it points the git hooks every checkout
  shares at that worktree's venv, and removing the worktree breaks them.
- Remove a worktree with `just worktree-remove <branch>`, never
  `git worktree remove`. It also deletes the branch once main or
  origin/main holds its work, squash merges included, and the
  worktree's database and bucket, and its Xcode DerivedData. It refuses a
  worktree with uncommitted changes; never pass `--force` to git instead.
- `just test` never runs Playwright. `just e2e` does. It starts Postgres,
  its own API on :8001, and its own preview server against its own
  `crosstune_e2e` database. It does not need `just dev`, and it can run
  while `just dev` is running. It signs in against the shared
  Clerk development instance and spends its usage limits, and needs the
  Clerk keys in `web/.env`.
- A renamed label, heading, or group name needs `web/e2e/` checked. Those
  specs query by accessible name and only `just e2e` catches a rename.
- The site draws the app's screens as HTML demos in `site/src/demos/`.
  The demos do not follow the app, so an app change never needs a demo
  redrawn. Read `site/CLAUDE.md` before changing the site.
- New recipes go in `api/justfile`, `web/justfile`, `site/justfile`, or
  `apple/justfile`,
  tagged with a `[group(...)]` that matches their neighbors. A root
  aggregate calls every module.
- Lint and test recipes skip a gate that already passed on the same
  tree. Run the recipe again rather than judging whether it needs to run.
  A pass on uncommitted work also covers its commit. `just gate status`
  lists what passed and failed on the tree without running,
  `GATE_CACHE_DISABLE=1 just <recipe>` forces a run, and `just gate clear`
  follows a change to an input no gate is keyed on.
- A new lint or test recipe runs through `{{ gate }}` under a name no other
  gate uses, following "Gate cache" in `docs/operations.md`.
- While iterating on web code, run `pnpm exec eslint <files>` and
  `pnpm exec prettier --check <files>` from `web/` on the files you
  changed. `just web::lint` checks the whole module, so run it once before
  you commit.
- Spell check with `just typos [paths]`. Never run typos or any other tool
  through `uvx`. Do not add another task runner.

## Conventions

- Every icon is a `lucide-react` named import, sized with a Tailwind
  `size-*` class and `aria-hidden` inside a control that has an accessible
  name. No text characters as icons, no second icon set. A hand-drawn
  glyph is only for the brand mark (`web/src/ui/Mark.tsx`) or for a
  control's shape that animates between states, which a static icon
  cannot: the checkbox mark and the status ring are inline SVG strokes,
  and play, pause, and stop are one CSS shape that morphs
  (`TransportMark`).
  The site uses the same icons from `lucide`; `site/CLAUDE.md` says how.
- Outbound HTTP in the API uses `httpx2`, never `httpx`.
- A ref that mirrors the latest render's value is `useLatest` from
  `web/src/ui/useLatest.ts`, named `…Ref`, never a hand-written ref plus
  effect.
- A user-facing string that more than one file needs, tests included, is an
  exported constant beside the component that shows it. Every other file
  imports it, so a wording change is one edit.
- Every sheet, dialog, alert, and file picker in
  `apple/CrosstuneKit/Sources/CrosstuneUI` claims the shell while it shows:
  a sheet's root view carries `.shellSheet()` or `.partHeightSheet()`; a
  dialog, alert, or file picker has no root view of its own, so the view
  presenting it carries `.coversShell(_:)` on the line before; a view that
  asks for a sheet ahead of its showing holds the menus with
  `.coversShellMenus(_:)`. A test in
  `CrosstuneUITests` enforces each, so the record control and the shell's
  menu commands stand down behind every presentation.
- Every view in `CrosstuneUI` that shows user content carries
  `.contentMask()`, so replay could never show it if it is ever enabled. A test in
  `CrosstuneUITests` enforces it; a view handed its text is masked by hand
  and listed in that test.
- A new analytics event goes in `analytics/tracking-plan.json` before code
  sends it, following `docs/analytics.md`. A model receives the
  `AnalyticsClient` as an init parameter, a view reads it from the
  environment. On the web, a component reads the client with
  `useAnalytics()`, code outside React takes it as an argument, and nothing
  in `web/src/commands/` sends.
- A change to what the Apple app collects, or a new SDK in it, updates
  `PrivacyInfo.xcprivacy` in the same change, so it and the App Store
  label stay in step.

## Web tests

Browser tests share a slow CI runner, so a race a fast Mac never loses
fails there at random. Every web test follows these rules:

- An assertion on anything still settling retries: `expect.element(locator)`
  or `expect.poll(() => value)`. That covers focus, DOM order, visibility,
  engine and store state, and mock call counts. A plain `expect` reads only
  a value that can no longer change, such as a pure function's result or a
  mock call's arguments once a poll has seen the call.
- `expect.poll` gives up after 1 s by default. To wait for an element to
  appear, use `expect.element`, which waits the full test timeout.
- Under fake timers, a poll advances the clock by its interval on each
  miss, so it can fire a timer the test means to hold. There, poll with
  `pollStill` and `elementStill` from `web/src/test/stillPoll.ts`.
- Behavior driven by elapsed time or animation frames takes its clock or
  frame source as an input, or the test uses fake timers. No assertion
  depends on how many frames a runner renders.
- A test passes alone and in any order. It awaits every write it starts and
  leaves no timer, listener, overlay, or module-level state for the next
  test. A test database comes from `openTestDb()`, which deletes it after
  the tree unmounts; never delete it in an `afterEach`, which runs while
  the tree is still mounted.
- A stress recipe, such as `just web::stress`, runs only to reproduce or
  fix a flaky test. Never as a routine step: not per commit, per task, or
  branch, and not before a pull request. `just web::stress 5 <files>`
  shuffles those files five times. With no files, it takes every test file
  the branch added or changed since `main`.
- Never raise a timeout or add a retry to make a test pass. CI retries a
  failed browser test so one race doesn't fail the run, and the job summary
  lists every test that needed a retry. A listed test is a bug to fix.
