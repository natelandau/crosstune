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
  `just api::test`, `just web::lint`. Inside `api/` or `web/`, `just test`
  resolves to that module. `just --list` shows everything.
- `just dev` runs Postgres, migrations, the API, and the web client
  together. Every checkout and worktree shares one Postgres container and
  database.
- `just test` never runs Playwright. `just e2e` does, beside `just dev`,
  against its own `crosstune_e2e` database. It signs in against the shared
  Clerk development instance and spends its usage limits, and needs the
  Clerk keys in `web/.env`.
- A renamed label, heading, or group name needs `web/e2e/` checked. Those
  specs query by accessible name and only `just e2e` catches a rename.
- New recipes go in `api/justfile` or `web/justfile`, tagged with a
  `[group(...)]` that matches their neighbors. A root aggregate calls both
  modules.
- Spell check with `just typos [paths]`. Never run typos or any other tool
  through `uvx`. Do not add another task runner.

## Conventions

- Every icon is a `lucide-react` named import, sized with a Tailwind
  `size-*` class and `aria-hidden` inside a control that has an accessible
  name. No inline SVG icons, no text characters as icons, no second icon
  set. `web/src/ui/Mark.tsx` is the one inline SVG and is not an icon.
- Outbound HTTP in the API uses `httpx2`, never `httpx`.
- A user-facing string that more than one file needs, tests included, is an
  exported constant beside the component that shows it; never retype it.
  The rule and its reason are in `docs/design.md`.
