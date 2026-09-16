# Crosstune

## Documentation

`docs/README.md` indexes every page and says which question each one
answers. Read these pages by task:

- `docs/product.md` before any design or implementation work. It records
  what the product is, the first release scope, and the constraints that
  hold for every release.
- `docs/decisions.md` before you propose a different stack, host, or
  design. It records why each one was chosen and what was rejected.
- `docs/architecture.md` when the work touches the API, the web client,
  sync, sign-in, or link resolution.
- `docs/design.md` before you build or change a screen, a row, a form, a
  gesture, or a label in the web client. It records the patterns every
  screen follows and the component that implements each one.
- `docs/hosting.md` and `docs/operations.md` only when the work touches
  deployment, CI, or a hosting setting. The first lists what each host
  holds. The second covers deploys, releases, and the smoke check.

## Naming

The glossary in `docs/product.md` sets the naming rules and the reasons:
`violin`, never `fiddle`, and song, never tune, in the schema, the API, and
every label.

## Task runner

The repo uses [just](https://just.systems) in a root-plus-module layout. The
root `justfile` declares `mod api` and `mod web`; each module's recipes live in
`api/justfile` and `web/justfile` next to the code they act on. Root recipes
aggregate across modules (`just test` runs `api::test` and `web::test`).
`just --list` shows everything.

- From the repo root, address a module recipe as `just api::test`, `just web::lint`,
  `just api::migrate`.
- From inside `api/` or `web/`, `just test` resolves to that module directly.
- `just dev` starts Postgres via Docker, applies migrations, then runs the API and
  web client together under honcho using `Procfile.dev`. honcho is an API dev
  dependency. Ctrl-C stops both servers; Postgres keeps running until `just dev-down`.
  If either process crashes, honcho stops the other.
- Postgres data lives in the `crosstune_postgres-data` Docker volume, and the compose
  project name is fixed to `crosstune`, so every checkout and worktree shares one
  database. `just dev` from a worktree reuses the running container.
- New API recipes go in `api/justfile`, new web recipes in `web/justfile`. A
  root aggregate recipe should call both `api::<name>` and `web::<name>`.
- Tag recipes with `[group('api')]`, `[group('web')]`, or `[group('all')]` so
  `just --list` reads in blocks.
- Spell check with `just typos [paths]` (for example `just typos docs`). typos
  is a pinned API dev dependency; never run it, or any other tool, through `uvx`.
- Do not add duty or any other task runner.

## Icons

Every icon in the web client comes from `lucide-react`. Import the named
component (`import { X } from 'lucide-react'`), size it with a Tailwind
`size-*` class, and mark it `aria-hidden` inside a control that already has
an accessible name. Never draw an inline SVG, never use a text character such
as `×`, `✕`, or `+` as an icon, and do not add a second icon set.
