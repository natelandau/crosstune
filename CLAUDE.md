# Crosstune

Rules for every session in this repository. Procedures for one kind of
task live in the pages under "Read by task".

## Read by task

| Task                                                                                 | Read                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Any design or implementation work                                                    | `docs/product.md`                                              |
| The stack, the API, the client's data layers, sync, sign-in, links, or recordings    | `docs/architecture.md`                                         |
| A screen, row, form, gesture, or label, on any platform                              | `docs/design.md`                                               |
| A Mac screen, row, control, or window                                                | `docs/design.md`, then `docs/design-macos.md`                  |
| An iPhone screen, or an iPad screen in a compact window                              | `docs/design.md`, then `docs/design-ios.md`                    |
| An iPad screen at regular width                                                      | `docs/design.md`, `docs/design-ios.md`, `docs/design-ipad.md`  |
| A web screen, row, control, or sheet                                                 | `docs/design.md`, then `docs/design-web.md`                    |
| A new or changed design rule                                                         | `docs/design.md`, "Writing these pages": which page it goes in |
| Setup, worktrees, recipes, Apple builds, a running app, tests, releases, deploys, CI | `docs/operations.md`                                           |
| Analytics events                                                                     | `docs/analytics.md`                                            |
| The site, `site/`                                                                    | `site/CLAUDE.md`                                               |

## Public repository

Everything committed is public: code, docs, comments, commit messages,
and pull requests. Never commit:

- Feature specs, plans, or design records.
- Host settings, credentials, or account details.
- A command an operator runs against production, such as a grant of a
  comp or a trial.
- Anything else that is not for the public.

## Documentation

Docs are guidance for a future session that builds something new: the
rules every new screen or module must follow. Never a record of what was
decided or built. The code is the source of truth. A doc holds only what
the code cannot say.

- `docs/README.md` says what each page holds and never holds. Read it
  before you write to a page.
- A doc holds guardrails, constraints, boundaries, sources of truth, and
  rules every screen or module obeys. "Every list filters by every facet
  of its items", not "the catalog filters by key".
- A line stays only if all four are true. Framework gotchas are the one
  exception, in a section of their own.
    1. It binds screens or modules not built yet. A decision for one
       feature or screen fails.
    2. A future change can break it.
    3. No code, token, test, or lint enforces it.
    4. Breaking it is likely and costly.
- A line that says what a shared component or helper does fails test 3:
  the component enforces it. Name a shared control only to say that a
  screen must use it.
- Never in a doc:
    - A log of decisions or changes, or what was tried. Why a line changed
      goes in the commit message.
    - What a screen or module does.
    - Anything about one release. That goes in the pull request.
    - A value: a size, a width, a duration.
    - How the platforms differ in behavior. The code holds that.
- What holds now, in the present tense.
- Written for agents: fragments, bullets, and tables in plain words. A
  reason only when it stops a future change from undoing the rule.
- A change that makes a line false fixes the line in the same change.

## Naming

- `violin`, never `fiddle`. Tune, never song. In the schema, the API, and
  every label. The reasons: the glossary in `docs/product.md`.
- Every name in code and docs is the standard term that a developer new
  to the project knows: a button is a button, a toolbar is a toolbar. No
  coined term. The glossary's terms are the only project vocabulary.
- No metaphor, colloquialism, idiom, or slang in code, comments, docs, or
  user-facing copy, unless the owner asks for it. "Is disabled", not
  "stands down". "Recording", not "take".

## Worktrees

- All work in a worktree, never in the main checkout.
- Create: `just worktree <branch>`. Never `git worktree add`.
- Remove: `just worktree-remove <branch>`. Never `git worktree remove`.
  It refuses a worktree with uncommitted changes. Never pass `--force` to
  git instead.
- Never `just dev-setup` in a worktree. It points the git hooks that every
  checkout shares at that worktree's venv, and removing the worktree
  breaks them.
- What the recipes do, and a worktree made another way:
  `docs/operations.md`, Worktrees.

## Task runner

[just](https://just.systems), a root justfile plus one module per folder.

- From the root: `just api::test`, `just web::lint`. Inside `api/`,
  `web/`, `site/`, or `apple/`: `just test` runs that module's recipe.
  `just --list` shows every recipe.
- No other task runner. No tool through `uvx`.
- Spell check: `just typos [paths]`.
- Always run the lint or test recipe, never skip it on your own judgment.
  The recipe itself skips a gate that passed on the same files. A skipped
  gate passed: never run its tool another way to confirm it.
- Before you add or change a gate: run `just gate --skill`.
- A gate skips when nothing under its `--path` list changed, so a missing
  path hides a real failure. A change that makes a gate read a tracked
  path outside that list adds the path in the same change. Not sure: add
  it. Details: `docs/operations.md`, Gate cache.
- Web code, while you iterate: from `web/`, `pnpm exec eslint <files>`
  and `pnpm exec prettier --check <files>` on the changed files. Before a
  commit: `just web::lint` once.
- A new recipe, script, or developer tool: `docs/operations.md`, Recipes
  and tooling.

## Dev server and end-to-end tests

- `just dev` runs Postgres, migrations, the API, the web client, and the
  site. Each worktree has its own database and bucket.
- `just test` never runs Playwright. `just e2e` does. It spends the
  usage limits of the shared Clerk development instance: run it once,
  when a change to code its specs cover is finished, never while
  iterating. Setup: `docs/operations.md`, End-to-end suite.
- A renamed label, heading, or group name: check `web/e2e/`. Those specs
  find elements by accessible name, and only `just e2e` catches a rename.

## Apple app

- The `apple` module needs Xcode. Xcode 27 has no Simulator.app. Its
  simulators run in DeviceHub: `open -a DeviceHub`.
- Build only with the `apple` recipes. An `xcodebuild` that no recipe
  covers: `docs/operations.md`, Apple builds.
- Run the Mac app only with `just apple::run [app args]`, as a background
  command. Always end with `just apple::done`, also after a failed check.
  Never launch a build from DerivedData.
- Drive a running app with Peekaboo (Mac) or Maestro (iOS simulators).
  Commands: `docs/operations.md`, Drive a running app.
- The developer works on the same Mac:
    - Never bring the app forward.
    - Never send synthetic mouse or keyboard events.
    - Never pass `--foreground` to Peekaboo. Never use `peekaboo agent`.
- Maestro: always pass `--udid`. Several simulators run at once.

## Conventions

- Before adding, removing, or merging a color role, changing a color
  value, adding an allowlist entry to a color test, or lowering a
  contrast threshold: ask the owner.
- A ref that mirrors the latest render's value is `useLatest` from
  `web/src/ui/useLatest.ts`, named `<name>Ref`. Never a hand-written ref plus
  effect.
- A commit to internal tooling, such as the screenshot captures, the
  marketing shell, or a recipe, is `build`, never `feat`. The changelog
  lists only what users see.

## Web tests

Browser tests share a slow CI runner. A race that a fast Mac never loses
fails there at random.

- An assertion on anything still settling retries:
  `expect.element(locator)` or `expect.poll(() => value)`. This covers
  focus, DOM order, visibility, engine and store state, and mock call
  counts.
- A plain `expect` only for a value that cannot change any more: a pure
  function's result, or a mock call's arguments after a poll saw the call.
- `expect.poll` stops after 1 s by default. To wait for an element to
  appear: `expect.element`, which waits for the full test timeout.
- Under fake timers:
    - A poll advances the clock by its interval on each miss, so it can
      fire a timer the test holds. Poll with `pollStill` and `elementStill`
      from `web/src/test/stillPoll.ts`.
    - A browser action such as `fill` or `click` advances the clock while it
      runs. Type with `fillStill` from the same file. Another action that
      must not move the clock gets a still helper there.
- Behavior driven by elapsed time or animation frames takes its clock or
  frame source as an input, or the test uses fake timers. No assertion
  depends on how many frames a runner draws.
- A test passes alone and in any order.
    - It awaits every write it starts.
    - It leaves no timer, listener, overlay, or module-level state.
    - A test database comes from `openTestDb()`, which deletes it after the
      tree unmounts. Never delete it in an `afterEach`, which runs while the
      tree is still mounted.
- A stress recipe, such as `just web::stress`, runs only to reproduce or
  fix a flaky test. Never as a routine step: not per commit, task, or
  branch, and not before a pull request. Arguments: `just --usage web::stress`.
- Never raise a timeout or add a retry to make a test pass. CI reruns a
  failed browser test, and the job summary lists every test that needed a
  rerun. A listed test is a bug to fix.
