# Crosstune

A song catalog for folk musicians. Read `docs/product.md` for what the
product is and `docs/decisions.md` for why it is shaped this way.
`docs/README.md` indexes every page under `docs/`.

## Layout

- `api/` The FastAPI service. Python, managed by uv.
- `web/` The web client. TypeScript, managed by pnpm.
- `brand/` The identity sources: the CT mark as hand-written SVG, in both
  colorways. The web client's icons are generated from it.

## Local development

On a developer machine, the API runs on port 8000, the web client on port
5173, and Postgres in Docker on port 5432. Tasks run through
[just](https://just.systems) from anywhere in the repository. `just --list`
shows them all. Each deployable has its own module, such as `just api::test`,
and the unprefixed recipes run every module.

### Prerequisites

Install these tools before you start.

| Tool                                          | Version        | Notes                                                                                       |
| --------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| [uv](https://docs.astral.sh/uv/)              | any            | Installs Python 3.13 and the API's dependencies. Git hooks come from the same dependencies. |
| [Node.js](https://nodejs.org/)                | 22.12 or newer | Runs the web toolchain.                                                                     |
| [pnpm](https://pnpm.io/)                      | 12.4.1         | The version is pinned in `web/package.json`. `corepack enable` installs it from that pin.   |
| [just](https://just.systems)                  | any            | The task runner.                                                                            |
| [Docker](https://docs.docker.com/get-docker/) | any            | Runs Postgres 18 for development and for the API tests. Docker must be running.             |
| [ffmpeg](https://ffmpeg.org/)                 | any            | Transcodes uploaded recordings. Without it the API tests that use real audio are skipped.   |

You also need a [Clerk](https://clerk.com) development instance, which is free.
From its dashboard, copy the Frontend API URL, which looks like
`https://<slug>.clerk.accounts.dev`, and the publishable key, which starts with
`pk_test_`. Enable email magic link sign-in on the instance.

### Set up

Complete these steps once.

1. Start Docker.
2. From the repository root, run the setup recipe:

   ```
   just dev-setup
   ```

   This installs the Python and JavaScript dependencies, installs Chromium for
   the end-to-end tests, installs the git hooks, creates `api/.env` and
   `web/.env` from their `.env.example` files, and starts Postgres.

3. In `api/.env`, set `CROSSTUNE_CLERK_ISSUER` to the Frontend API URL of your
   Clerk instance. Leave the other values as they are.
4. In `web/.env`, set `VITE_CLERK_PUBLISHABLE_KEY` to the publishable key
   of your Clerk instance. The dev server proxies `/v1` to the API on the
   same origin, so there is no API URL to set.

You do not create the database tables by hand. `just dev` applies the
migrations every time it starts.

### Run

Start the whole stack with one command. It starts Postgres, applies pending
migrations, then runs the API and the web client in the foreground with
prefixed logs. Ctrl-C stops the API and the web client. Postgres keeps
running until you run `just dev-down`.

    just dev

Open http://localhost:5173 and sign in with an email address. Clerk sends the
magic link to that address.

Make sure that the API answers. The response is `{"status":"ok"}`.

    curl http://localhost:8000/healthz

To run one side alone, use its own recipe. The API reloads when a file under
`api/src` changes.

    just api::run
    just web::run

To serve a production build on port 4173 with the same `/v1` proxy, run
`just web::preview`.

### Test

Run the API tests. They start their own Postgres 18 container, so Docker must
be running.

    just api::test

Run the web unit tests.

    just web::test

Run every linter, or every test suite, across both modules.

    just lint
    just test

The end-to-end tests sign in through your Clerk instance. Before you run them,
set two more values in `web/.env`: `CLERK_SECRET_KEY`, the instance's
secret key that starts with `sk_test_`, and `E2E_CLERK_USER_EMAIL`, the address
of a user that exists in that instance.

The suite owns its own database, `crosstune_e2e`, beside the development
database in the Postgres server that `compose.yml` starts. Start Postgres with
`docker compose up -d`, not with `just dev`: that recipe also binds an API to
the development database, and the suite refuses to run against one. Start the
API on the e2e database, then run the suite in a second terminal. It builds the
web client and serves it on port 4173 itself.

    docker compose up -d
    just api::run-e2e
    just web::e2e

The first recipe creates the database if it is absent and migrates it. The
suite leaves its fixtures behind, so the database grows with every run. To
drop it, recreate it empty, and migrate it again, run:

    just api::e2e-db-reset

### Commit and release

Commit messages follow the conventional commits format, and the commit-msg
hook rejects any that do not. Commitizen is configured in `.cz.toml` at the
repository root, so every `cz` command runs from the root, whichever side
the change touches. To write a commit interactively, run:

    just commit

To cut a release, run the bump recipe from the root. It reads the commits
since the last tag to choose the increment, writes the new version to the
API package, the web client, and `.cz.toml`, refreshes `api/uv.lock` and
the OpenAPI contract, updates `CHANGELOG.md`, commits, and tags. Each
version becomes the Sentry release tag for its side.

    just bump
    git push --follow-tags origin main

The tag push starts the `Release` workflow, which runs the checks on the
tagged commit and then deploys both hosts. Nothing reaches production
until that push. `docs/operations.md` covers the full sequence and the
rollback.

Both recipes pass extra arguments through, so `just bump --dry-run` shows
what a release would do.

## Hosting

The API runs on Railway, the database on Neon, the web client on a Cloudflare
Worker, sign-in on Clerk, and errors go to Sentry. `docs/architecture.md`
describes what each system does and how they depend on each other.
`docs/hosting.md` lists every setting and variable each host holds, and
`docs/operations.md` covers deploys and the smoke check to run after one.

The client always calls `/v1` on its own origin. Locally the Vite dev server
proxies it to the API on port 8000. When hosted, the Worker proxies it to the
API for that environment, and every pull request gets its own API and database
behind its preview URL. `docs/architecture.md` describes the flow.
