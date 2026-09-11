# Crosstune

A song catalog for old-time and bluegrass musicians. Read `PRODUCT.md` for
what the product is and why it is shaped this way.

## Layout

- `api/` The FastAPI service. Python, managed by uv.
- `web/` The web client. TypeScript, managed by pnpm.

## Local development

Tasks run through [just](https://just.systems) from anywhere in the
repository. `just --list` shows them all; each deployable has its own module
(`just api::test`), and the unprefixed recipes run every module.

Install dependencies, git hooks, and a local `.env` copied from
`.env.example`, and start Postgres:

    just dev-setup

Run the API:

    just api::run

Run the API tests (Docker must be running):

    just api::test
