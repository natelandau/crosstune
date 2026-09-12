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

Run the web client (proxies `/v1` to the API on port 8000):

    just web::run

Run the web unit tests:

    just web::test

The web client needs a Clerk publishable key in `web/.env.local`; `just dev-setup`
creates the file from `web/.env.example`.

A production build reads the API origin from `VITE_API_URL` at build time, so set that
variable to the API origin in the Cloudflare Pages build environment. An empty value
means the API is on the same origin as the client, which is what the dev and preview
servers give you through their `/v1` proxy.

Run the end-to-end tests. They need the API on port 8000 (`just api::run`),
a Clerk development instance, and in `web/.env.local`: `VITE_CLERK_PUBLISHABLE_KEY`,
`CLERK_SECRET_KEY`, and `E2E_CLERK_USER_EMAIL` for a user that exists in that
instance. The API's `CROSSTUNE_CLERK_AUTHORIZED_PARTIES` must list
`http://localhost:4173`.

    just web::e2e
