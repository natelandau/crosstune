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

Docs are for a future session with none of this session's context. The
code is the source of truth. A doc holds only what the code cannot say.

- `docs/README.md` says what each page holds and never holds. Read it
  before you write to a page.
- A doc holds guardrails, constraints, boundaries, sources of truth, and
  rules every screen or module obeys. "Every list filters by every facet
  of its items", not "the catalog filters by key".
- A rule is a behavior every screen shares, so the app is consistent for
  its users. A decision for one feature or screen is not a rule: cut it.
- A line stays only if all three are true. Framework gotchas are the one
  exception, in a section of their own.
  1. It binds screens or modules not built yet.
  2. A future change can break it.
  3. No code, token, test, or lint enforces it.
- Record a rule only when breaking it is likely and costly.
- Never in a doc:
  - A log of decisions or changes, or what was tried.
  - What a screen or module does.
  - Anything about one release. That goes in the pull request.
  - A value: a size, a width, a duration.
  - How the platforms differ in behavior. The code holds that.
- What holds now, in the present tense. Why it changed goes in the commit
  message.
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
- A lint or test recipe skips a gate that passed on the same tree. Run the
  recipe again. Never decide yourself that it can be skipped.
- Web code, while you iterate: from `web/`, `pnpm exec eslint <files>`
  and `pnpm exec prettier --check <files>` on the changed files. Before a
  commit: `just web::lint` once.
- A new recipe, script, or developer tool: `docs/operations.md`, Recipes
  and tooling.

## Dev server and end-to-end tests

- `just dev` runs Postgres, migrations, the API, the web client, and the
  site. Each worktree has its own database and bucket.
- `just test` never runs Playwright. `just e2e` does. It needs no
  `just dev` and can run beside it. It spends the usage limits of the
  shared Clerk development instance, and needs the Clerk keys in
  `web/.env`.
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

- A new color role, a changed color value, a new allowlist entry on a
  color test, or a lower contrast threshold needs the owner's approval
  first.
- A ref that mirrors the latest render's value is `useLatest` from
  `web/src/ui/useLatest.ts`, named `…Ref`. Never a hand-written ref plus
  effect.
- A user-facing string that more than one file needs, tests included, is
  an exported constant beside the component that shows it. Every other
  file imports it, so a wording change is one edit.
- A commit to internal tooling, such as the screenshot captures, the
  marketing shell, or a recipe, is `build`, never `feat`. The changelog
  lists only what users see.

## Tests

Every module: `api/`, `web/`, `site/`, and `apple/`. A test earns its
place when it catches a bug that no other test catches, at the cheapest
layer that can see that bug.

| The bug is in                                                       | Test it with                                     |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| Logic: parsing, sorting, filtering, formatting, a rule over data    | A unit test of the function                      |
| Wiring: logic reaching a screen or route, real input, focus, layout | One integration, browser, or UI test per feature |
| A flow across the API boundary                                      | An end-to-end test                               |

- Logic that only a UI test reaches moves into a function with its own
  unit test. The UI test keeps one case that shows the screen uses it.
- One rule, one test. Before you add a test, search for a test of the
  same rule and add a case to it.
- Variants of one rule are one table: `it.each`,
  `@pytest.mark.parametrize`, `@Test(arguments:)`.
- A test asserts behavior and contracts:
  - What a person sees and can do.
  - What is stored or sent.
  - Accessibility: touch targets, focus, contrast, reduced motion, text
    size.
  - The token and shared-control rules.
- Never a test of a value a designer picks: a color, radius, size,
  weight, spacing, duration, or class name. Screenshots and review check
  how things look.
- Never a test that restates code: a constant's value, a copy string, a
  call order that a mock records when the order is not the behavior, or
  what the type checker already rejects.
- A refactor that changes no behavior changes no test. A test that fails
  on a refactor checks the implementation: rewrite it against the public
  surface.
- A change that removes a behavior removes its tests.
- A cleanup deletes a test only when another test checks the same rule,
  or when the test checks a design value. The evidence: mutation testing
  or per-test coverage. A smaller test count is never the goal.

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
  branch, and not before a pull request. `just web::stress 5 <files>`
  shuffles those files five times. With no files: every test file that
  the branch added or changed since `main`.
- Never raise a timeout or add a retry to make a test pass. CI reruns a
  failed browser test, and the job summary lists every test that needed a
  rerun. A listed test is a bug to fix.
