# Crosstune

## Documentation

Read `docs/README.md` first. It maps each task to a page and says what each
page holds and never holds. Check that contract before you write to a page.
The code is the source of truth for everything except `docs/architecture.md`
and `docs/hosting.md`.

- Design or implementation work: `docs/product.md`, then `docs/decisions.md`
  before you propose a different stack, host, or approach.
- The API, the client's data layers, sync, sign-in, links, or recordings:
  `docs/architecture.md`.
- A screen, row, form, gesture, or label: `docs/design.md`.
- Deployment, CI, or a host setting: `docs/hosting.md` and
  `docs/operations.md`.

Feature specs, plans, and design records go in the vault, never under
`docs/`.

## Naming

`violin`, never `fiddle`, and tune, never song, in the schema, the API, and
every label. The glossary in `docs/product.md` has the reasons.

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
- Create a worktree with `just worktree <branch>`, never `git worktree add`.
  It adds `.worktrees/<branch>`, copies every module's `.env` from the main
  checkout, runs `just setup` so `just e2e` works there, and makes the
  worktree's database and bucket. In a worktree made any other way, run `just worktree-env`, then
  `just setup`; `just dev` makes the database and bucket. Never run
  `just dev-setup` in a worktree: it points the git hooks every checkout
  shares at that worktree's venv, and removing the worktree breaks them.
- `just test` never runs Playwright. `just e2e` does, beside `just dev`,
  against its own `crosstune_e2e` database. It signs in against the shared
  Clerk development instance and spends its usage limits, and needs the
  Clerk keys in `web/.env`.
- A renamed label, heading, or group name needs `web/e2e/` checked. Those
  specs query by accessible name and only `just e2e` catches a rename.
- New recipes go in `api/justfile`, `web/justfile`, `site/justfile`, or
  `apple/justfile`,
  tagged with a `[group(...)]` that matches their neighbors. A root
  aggregate calls every module.
- Spell check with `just typos [paths]`. Never run typos or any other tool
  through `uvx`. Do not add another task runner.

## Conventions

- Every icon is a `lucide-react` named import, sized with a Tailwind
  `size-*` class and `aria-hidden` inside a control that has an accessible
  name. No inline SVG icons, no text characters as icons, no second icon
  set. `web/src/ui/Mark.tsx` is the one inline SVG and is not an icon.
- Outbound HTTP in the API uses `httpx2`, never `httpx`.
- A ref that mirrors the latest render's value is `useLatest` from
  `web/src/ui/useLatest.ts`, named `…Ref`, never a hand-written ref plus
  effect.
- A user-facing string that more than one file needs, tests included, is an
  exported constant beside the component that shows it; never retype it.
  The rule and its reason are in `docs/design.md`.
- Every sheet, dialog, alert, and file picker in
  `apple/CrosstuneKit/Sources/CrosstuneUI` claims the shell while it shows:
  a sheet's root view carries `.shellSheet()` or `.partHeightSheet()`; a
  dialog, alert, or file picker has no root view of its own, so the view
  presenting it carries `.coversShell(_:)` on the line before. A test in
  `CrosstuneUITests` enforces both, so the record dome hides and the shell's
  menu commands stand down behind every presentation.

## Web tests

Browser tests share a slow CI runner, so a race a fast Mac never loses
fails there at random. Every web test follows these rules:

- An assertion on anything still settling retries: `expect.element(locator)`
  or `expect.poll(() => value)`. That covers focus, DOM order, visibility,
  engine and store state, and mock call counts. A plain `expect` reads only
  a value that can no longer change, such as a pure function's result or a
  mock call's arguments once a poll has seen the call.
- Never wait a fixed time for something to happen. A fixed wait proves only
  that something did not happen, after a poll has seen the thing that did.
- Behavior driven by elapsed time or animation frames takes its clock or
  frame source as an input, or the test uses fake timers. No assertion
  depends on how many frames a runner renders.
- A test passes alone and in any order. It awaits every write it starts and
  leaves no timer, listener, overlay, or module-level state for the next
  test. A test database comes from `openTestDb()`, which deletes it after
  the tree unmounts; never delete it in an `afterEach`, which runs while
  the tree is still mounted. Before committing a new or changed test file,
  run `just web::stress 5 <file>`, which shuffles the tests on each run.
- Never raise a timeout or add a retry to make a test pass. CI retries a
  failed browser test so one race doesn't fail the run, and the job summary
  lists every test that needed a retry. A listed test is a bug to fix.
