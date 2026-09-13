# Crosstune

A song catalog for old-time and bluegrass musicians. Read `docs/PRODUCT.md` for
what the product is and why it is shaped this way.

## Layout

- `api/` The FastAPI service. Python, managed by uv.
- `web/` The web client. TypeScript, managed by pnpm.

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
   of your Clerk instance. Leave `VITE_API_URL` empty, because the dev server
   proxies `/v1` to the API on the same origin.

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
of a user that exists in that instance. Start the stack with `just dev`, or the
API alone with `just api::run`, then run the suite in a second terminal. It
builds the web client and serves it on port 4173 itself.

    just web::e2e

### Commit and release

Commit messages follow the conventional commits format, and the commit-msg
hook rejects any that do not. Commitizen is configured in `.cz.toml` at the
repository root, so every `cz` command runs from the root, whichever side
the change touches. To write a commit interactively, run:

    just commit

To cut a release, run the bump recipe from the root. It reads the commits
since the last tag to choose the increment, writes the new version to the
API package, the web client, and `.cz.toml`, refreshes `api/uv.lock`,
updates `CHANGELOG.md`, commits, and tags. Each version becomes the Sentry
release tag for its side.

    just bump

Both recipes pass extra arguments through, so `just bump --dry-run` shows
what a release would do.

## Hosting

The API runs on Railway, the database on Neon, the web client on Cloudflare
Pages, sign-in on Clerk, and errors go to Sentry. `docs/ARCHITECTURE.md`
describes what each system does, how they depend on each other, every
setting and variable each host holds, and the smoke check to run after a
deploy.

A production build reads the API origin from `VITE_API_URL` at build time. The
hosted builds set it to the API origin. An empty value means the API is on the
same origin as the client, which only the dev and preview proxies provide.
