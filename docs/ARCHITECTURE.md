# Crosstune architecture and hosting

This page describes the systems that run Crosstune, what each one does, and
how they depend on each other. It also records what each hosted service must
hold for the whole to work. The first half is the map. The second half is
the reference for every dashboard setting, because those settings live in
the hosts and nowhere in the code. For the product and the reasons behind
the stack, read `docs/PRODUCT.md`.

## The systems

Crosstune is two deployables and five hosted services.

```
                 GitHub (source, CI)
                  |              |
       push to main under web/   push to main under api/
                  |              |
                  v              v
   +-------------------+     +-------------------+      +-------------+
   | Cloudflare Pages  |     | Railway           |      | Neon        |
   | static web client |     | API container     |<---->| Postgres    |
   +-------------------+     +-------------------+      +-------------+
            |                  ^      |     ^
   app shell, assets           |      |     | jwks.json, user.deleted webhook
            v                  |      |     v
   +-------------------+       |      |  +-------------+
   | Browser           |-------+      |  | Clerk       |
   | React app         | JSON over    |  | sign-in     |
   | IndexedDB, outbox | HTTPS with   |  +-------------+
   | service worker    | a Clerk JWT  |         ^
   +-------------------+              |         | sign-in UI, session, token
            |                         |         |
            +-------------------------+---------+
            |                         |
            v                         v
   +-------------------+     +-----------------------------+
   | Sentry            |     | YouTube, Spotify, Bandcamp, |
   | crosstune-web     |     | SoundCloud, Apple           |
   | crosstune-api     |     | oEmbed, iTunes, Open Graph  |
   +-------------------+     +-----------------------------+
```

| System           | What it does                                                               | Needs                              |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| Web client       | The app the musician uses. Reads and writes a local copy of the catalog.   | Pages, Clerk, API                  |
| API              | Owns the schema, the sync protocol, ownership rules, and link metadata.    | Neon, Clerk public keys, providers |
| Neon             | Stores every catalog. One database per environment.                        | Nothing                            |
| Clerk            | Signs users in and issues the tokens the API verifies.                     | Cloudflare DNS for its hostnames   |
| Cloudflare Pages | Builds and serves the web client. Terminates HTTPS for the product domain. | GitHub                             |
| Railway          | Builds and runs the API container. Terminates HTTPS for the API domain.    | GitHub, Neon                       |
| Sentry           | Receives errors from the web client and the API.                           | Nothing                            |
| GitHub           | Holds the source and runs the checks. The hosts deploy from it.            | Nothing                            |

Cloudflare also hosts the DNS zone for the product domain. The Pages site,
the API hostname, and the Clerk hostnames are all records in that zone.

## The web client

The web client is a single-page React application. Pages builds it from
`web/` with Vite and serves the output as static files. There is no server
side rendering and no server code in the client.

The client keeps a full copy of the user's catalog in IndexedDB, through
Dexie. The screens read only that copy, through live queries. A user action
runs a command, and a command writes the row and appends a change to an
outbox in one IndexedDB transaction. Neither the screens nor the commands
call the API. Only the sync engine talks to the network.

The local database is named after the user, so two accounts on one phone
never share data. Sign-out deletes the database. Sign-out refuses to run
while the outbox holds unsent changes, so no edit is lost with it.

A service worker precaches the app shell, the scripts, the styles, the icons,
and the fonts. The router ships as one bundle, so an offline reload never
needs a chunk the shell did not load. Responses from the API are never cached
and never fall back to the shell. The `_headers` file makes Pages serve the
service worker and the manifest with `no-cache`. A new build therefore
reaches an installed app on its next load. The same file marks the hashed
assets immutable for a year.

The client sends every error the sync engine meets to the `crosstune-web`
Sentry project, once per failure streak. It also reports each change the
server refused, as a warning. The release tag is the `version` field in
`web/package.json`, and the same value travels to the API in the
`X-Client-Version` header.

## The API

The API is one FastAPI process in a Railway container, built from the
Dockerfile in `api/`. Railway rebuilds it on a push to `main` that changes a
file under `api/`. Railway's pre-deploy command runs the Alembic migrations
in a separate container from the same image before the new deployment
starts, so the schema is never older than the code that serves it. A failed
migration cancels the deploy and the previous deployment keeps serving. The
container itself only starts uvicorn, so a restart never touches the schema
and a second replica needs no change here.

The API knows nothing about the web client. Its OpenAPI schema is the
contract, and the client's TypeScript types are generated from it. A CI job
regenerates the types and fails when the committed copy differs. A native
client later uses the same endpoints.

The API exposes six routes.

| Route                     | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `POST /v1/sync/push`      | Apply a batch of client changes.                              |
| `GET /v1/sync/pull`       | Return every row of the caller changed after a cursor.        |
| `POST /v1/links/resolve`  | Return provider, canonical URL, title, and artwork for a URL. |
| `GET /v1/me`              | Return the caller's profile. Creates the user on first call.  |
| `POST /v1/webhooks/clerk` | Receive account deletions from Clerk.                         |
| `GET /healthz`            | Answer Railway's health check.                                |

Every route under `/v1` except the webhook requires a Clerk bearer token. No
user ID appears in a URL or a body. The server sets ownership from the token
and scopes every query to the caller. Errors are problem-details documents
(RFC 9457). An unhandled exception becomes a 500 with no detail and a report
to the `crosstune-api` Sentry project. The release tag is the package version
that commitizen maintains.

The API writes JSON log lines to standard output. Railway's log explorer
indexes the fields. There is no separate log drain.

Cross-origin requests are allowed from the product origin in production, and
from the local origins plus the Pages preview hostnames in development. The
same two lists govern which token audiences the API accepts.

## The database

Each environment has one Neon Postgres database, in the same AWS region as
the Railway service. The API holds its own connection pool and connects
directly, not through Neon's pooler. Alembic needs a direct connection, and a
pooled one adds nothing for a single replica. Neon suspends the compute when
the database is idle. The first request after a pause takes a few seconds,
and the pool's pre-ping reconnects on its own.

The schema uses no vendor extensions, so the host can change with a
connection string. Six tables hold users, songs, each user's relationship to
a song, recording links, lists, and list items. Every synced table carries
`created_at`, `updated_at`, `deleted_at`, and `server_seq`. Deletes are soft,
and tombstones are kept forever, so a deletion reaches every device.

## Authentication

Clerk owns sign-in. The web client embeds Clerk's sign-in UI and keeps the
session in the browser. Before each request, the client asks Clerk for a
session token and sends it as a bearer token.

The API verifies the token without calling Clerk on the request path. It
fetches Clerk's public keys from the issuer's JWKS endpoint and caches them in
process. When a token names an unknown key, it refetches, at most once a
minute. A valid token is signed with RS256, names the expected issuer, and
carries `exp`, `iat`, and `sub`. The `azp` claim must match one of the
allowed origins, so a token minted for another site is refused. On the first
valid token from a Clerk user, the API inserts a user row.

Clerk calls the webhook route when a user deletes their account. The API
verifies the Svix signature and the timestamp, then hard-deletes the user
row. Foreign keys cascade to everything that user owned. Every other event
type is acknowledged and ignored.

Production uses Clerk's production instance on hostnames under the product
domain. Development, local development, and the end-to-end suite share one
Clerk development instance.

Offline, the client cannot reach Clerk. The client remembers the last signed
in user ID in local storage. When the browser is offline, or when Clerk fails
to load within five seconds, the app opens with that user's local database.
Reads and writes work. The sync engine reports offline, because it cannot get
a token, and resumes when Clerk loads again.

## Sync

The sync pair is the only way a client reads or writes catalog data. There
are no per-resource endpoints.

Push sends the outbox, up to 500 changes per batch, in order. Each change
names a table, a row ID, an operation, the row data, and the client's
`updated_at`. The server applies the batch in one transaction, parents before
children, and answers with one result per change.

- `applied`: the row is new, or the incoming timestamp is newer. An equal
  timestamp is a no-op that still reports `applied`, so a replayed batch is
  safe.
- `stale`: the stored row is newer. The response carries the server row, and
  the client overwrites its local copy.
- `invalid`: validation failed, or a referenced parent is missing or belongs
  to someone else. Only that change is refused. The client counts it and
  reports it to Sentry.

Every accepted write takes a fresh `server_seq` from one Postgres sequence.
A per-user advisory lock serializes concurrent pushes from one account, so
sequence numbers commit in order and a pull cursor never skips a row. A
delete of a song cascades to its user record, its links, and its list items.
A delete of a list cascades to its items. Client clocks decide conflicts.
The server sequence decides what to pull.

Pull returns the caller's rows with `server_seq` above the saved cursor,
across every table, oldest first, 500 rows per page. A fresh install pulls
from zero. When a pulled row is also in the outbox with a newer local
timestamp, the client keeps the local row. The next push settles it.

The engine syncs at app start, when the browser comes back online, when the
tab becomes visible, and three seconds after the last local write. On
failure it retries with exponential backoff from one second to one minute.
It exposes one status value, which the app bar shows.

## Link resolution

A recording link is a URL on a streaming service. The API resolves a title
and artwork for it. YouTube, Spotify, and SoundCloud answer oEmbed requests
with no key. Apple Music resolves through the public iTunes lookup. Any other
URL, Bandcamp included, is fetched and read for Open Graph tags, capped at
512 KB. Each request times out after five seconds. A failure yields a link
with no title, never an error.

Online, the client calls the resolve route as the user pastes, so the title
shows before the save. Offline, the client detects the provider from the URL
pattern, saves the link without a title, and pushes it later. During a push,
the API resolves every untitled link before the transaction opens. It
resolves eight at a time, with a 20 second budget for the whole batch. A link
the budget cuts off is stored untitled.

YouTube links play inside the app through an embedded player on
`youtube-nocookie.com`. Other links open the provider's app or site.

## Delivery

GitHub holds the source, and both hosts deploy from it. Every commit that
lands on `main` is deployed. There is no release branch, no promotion step,
and no batching.

- Railway builds the API service in both of its environments on a push to
  `main` that touches a file under `api/`.
- Pages builds the production site on a push to `main` that touches a file
  under `web/`. It builds a preview site for every other branch, at a
  hostname derived from the branch name.

GitHub Actions runs on every pull request and on every push to `main`. The
`API` workflow lints, type checks, tests against a real Postgres 18, and
verifies the committed OpenAPI contract. The `Web` workflow lints, type
checks, tests, builds, and verifies the generated client types. The hosts do
not wait for these workflows unless Railway's Wait for CI setting is on. The
`E2E` workflow runs the Playwright suite on demand, against a real Clerk
development instance, and does not gate merges.

Rollback on either host is one click to redeploy an earlier build. A bad
commit is undone in minutes, and the outbox means a client outage loses no
edits.

Version numbers come from two places. `cz bump` in `api/` updates the API
package version and creates the git tag. The `version` field in
`web/package.json` is bumped by hand as part of the same release. Each value
becomes the Sentry release tag for its side. Tags trigger nothing.

## Environments

| Environment | API                         | Database           | Clerk instance | Web client                        |
| ----------- | --------------------------- | ------------------ | -------------- | --------------------------------- |
| Local       | uvicorn on port 8000        | Postgres in Docker | Development    | Vite dev server, proxies `/v1`    |
| Development | Railway, generated hostname | Neon development   | Development    | Pages preview sites               |
| Production  | Railway, `api.<domain>`     | Neon production    | Production     | Pages production site, `<domain>` |

The development and production API services run the same commit. They differ
only in their variables. Locally, the Vite dev server proxies `/v1` to the
API on the same origin, so no CORS is involved.

Sentry receives events from both hosted environments in both projects. Each
event carries an environment tag of `production` or `development`.

## When a system is unavailable

Each row describes what a musician sees when one system is down and the
others are up.

| Unavailable          | Effect                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Network on the phone | The installed app loads from the service worker. Reads and writes work. Sync resumes on reconnect.              |
| Cloudflare Pages     | An installed app loads from the service worker. A first visit fails.                                            |
| Clerk                | A signed in app opens after a five second grace period with the remembered user. Sync waits. New sign-ins fail. |
| Railway API          | Reads and writes work. The outbox grows. The engine retries with backoff and the app bar shows the state.       |
| Neon                 | The API returns 500s and Sentry receives them. The client behaves as if the API were down.                      |
| A streaming provider | A pasted link is saved without a title. Playback of an existing YouTube link fails until YouTube returns.       |
| Sentry               | Nothing visible. Errors are dropped.                                                                            |
| GitHub               | Nothing visible. Deploys and checks wait until it returns.                                                      |

## Hosting reference

The sections below record what each host holds. None of it is in the code.
Railway's `railway.json` config files are deprecated, and a service created
after 2026-08-28 cannot use them, so the dashboards are the source of truth.
Values pass between hosts as follows.

| Value                                                     | Produced by    | Consumed by                   |
| --------------------------------------------------------- | -------------- | ----------------------------- |
| Neon production and development connection strings        | Neon           | Railway                       |
| `crosstune-api` and `crosstune-web` DSNs                  | Sentry         | Railway, Pages                |
| Clerk development issuer, publishable key, and secret key | Clerk          | Railway, Pages, GitHub        |
| Clerk production issuer and publishable key               | Clerk          | Railway, Pages                |
| Clerk webhook signing secrets, one per instance           | Clerk          | Railway                       |
| Railway development hostname                              | Railway        | Clerk webhooks, Pages preview |
| Pages subdomain (`<pages-subdomain>.pages.dev`)           | Pages          | Railway development regexes   |
| CNAME targets for `api.<domain>` and the Clerk hostnames  | Railway, Clerk | Cloudflare DNS                |

A rebuild from nothing works through the hosts in the order Neon, Sentry,
Clerk, Railway, Pages, GitHub, then the smoke check. It returns to Clerk for
the webhooks once Railway has hostnames.

### Neon

Two projects, `crosstune-production` and `crosstune-development`, both in
AWS US East (N. Virginia), the metro that matches Railway's US East region.
Each holds one database named `crosstune`. The API reads the database name
from the connection string, so any name works.

Railway receives each project's connection string with connection pooling
off. The hostname must not contain `-pooler`. The string goes in as Neon
prints it. The API rewrites `sslmode` to the form asyncpg accepts and drops
`channel_binding`.

Object storage, functions, the AI gateway, and Neon Auth are off. Clerk owns
authentication, and audio storage is planned for Cloudflare R2.

### Sentry

Two projects, `crosstune-api` on the Python FastAPI platform and
`crosstune-web` on the React platform. Only error monitoring is in use. The
API sets its trace sample rate to zero. The web client configures no replay,
tracing, logging, or metrics integration. The other Sentry products receive
nothing until the code changes.

The GitHub repository is connected for stack trace links, with the root
directory `api/` on the API project and `web/` on the web project. Suspect
commits stay empty, because nothing associates a release with commits, and
the web build emits no source maps.

### Clerk

One application with two instances. The development instance runs on
`https://<slug>.clerk.accounts.dev` with `pk_test_` and `sk_test_` keys. The
production instance is a clone of it with the home URL `https://<domain>`,
the issuer `https://clerk.<domain>`, and a `pk_live_` key. Its public keys
are at `https://clerk.<domain>/.well-known/jwks.json`.

The production instance needs five CNAME records in Cloudflare DNS, named
`clerk`, `accounts`, `clkmail`, `clk._domainkey`, and `clk2._domainkey`.
Each record has the proxy off, because Clerk's validation fails behind it.
Clerk issues certificates for those hostnames from the Home page of the
production instance, after every task on that page is done. Social sign-in
in production uses your own Google and Apple OAuth credentials, because a
production instance refuses Clerk's shared ones.

> **Note:** If certificate issuance hangs, look for CAA records on the domain
> that exclude Let's Encrypt or Google Trust Services.

Each instance has one webhook endpoint subscribed to `user.deleted` only.
The production endpoint is `https://api.<domain>/v1/webhooks/clerk`. The
development endpoint is the Railway development hostname with the same path.
Each endpoint's signing secret is `CROSSTUNE_CLERK_WEBHOOK_SECRET` in the
matching Railway environment.

### Railway

One project, `crosstune`, with one service, `api`, in the US East (Virginia)
region, with two environments, `production` and `development`. Both deploy
from `main`.

> **Note:** Creating a project from a GitHub repository starts a build from
> the repository root, which has no Dockerfile. That first build fails. The
> service needs its settings, not a new project.

| Service setting     | Value                                            |
| ------------------- | ------------------------------------------------ |
| Root directory      | `api`                                            |
| Branch              | `main`                                           |
| Watch paths         | `/api/**`                                        |
| Pre-deploy command  | `alembic upgrade head`                           |
| Healthcheck path    | `/healthz`                                       |
| Healthcheck timeout | 300 seconds, the default                         |
| Replicas            | 1, the default                                   |
| Restart policy      | On failure, ten retries, the default             |
| Wait for CI         | On, in both environments                         |
| Production domain   | `api.<domain>`, a CNAME in Cloudflare, proxy off |
| Development domain  | Generated by Railway                             |

Railway detects the Dockerfile in the root directory on its own and injects
`PORT`, which the container reads. Wait for CI holds a deploy until the
GitHub workflows for that commit pass. The pre-deploy command runs from the
image's working directory, where `alembic.ini` sits, with the service
variables, so it reaches the database the same way the API does.

Production variables:

| Variable                             | Value                              |
| ------------------------------------ | ---------------------------------- |
| `CROSSTUNE_ENVIRONMENT`              | `production`                       |
| `CROSSTUNE_DEBUG`                    | `false`                            |
| `CROSSTUNE_DATABASE_URL`             | Neon production string, as printed |
| `CROSSTUNE_CLERK_ISSUER`             | `https://clerk.<domain>`           |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTIES` | `["https://<domain>"]`             |
| `CROSSTUNE_CORS_ORIGINS`             | `["https://<domain>"]`             |
| `CROSSTUNE_CLERK_WEBHOOK_SECRET`     | Production endpoint signing secret |
| `CROSSTUNE_SENTRY_DSN`               | `crosstune-api` DSN                |

Development variables:

| Variable                                 | Value                                                 |
| ---------------------------------------- | ----------------------------------------------------- |
| `CROSSTUNE_ENVIRONMENT`                  | `development`                                         |
| `CROSSTUNE_DEBUG`                        | `false`                                               |
| `CROSSTUNE_DATABASE_URL`                 | Neon development string, as printed                   |
| `CROSSTUNE_CLERK_ISSUER`                 | `https://<slug>.clerk.accounts.dev`                   |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTIES`     | `["http://localhost:5173","http://localhost:4173"]`   |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTY_REGEX` | `^https://[a-z0-9-]+\.<pages-subdomain>\.pages\.dev$` |
| `CROSSTUNE_CORS_ORIGINS`                 | `["http://localhost:5173","http://localhost:4173"]`   |
| `CROSSTUNE_CORS_ORIGIN_REGEX`            | `^https://[a-z0-9-]+\.<pages-subdomain>\.pages\.dev$` |
| `CROSSTUNE_CLERK_WEBHOOK_SECRET`         | Development endpoint signing secret                   |
| `CROSSTUNE_SENTRY_DSN`                   | `crosstune-api` DSN                                   |

The two regex values write the Pages subdomain literally, hyphen included.
A subdomain of `crosstune-1dw` gives
`^https://[a-z0-9-]+\.crosstune-1dw\.pages\.dev$`.

### Cloudflare Pages

One Pages project, `crosstune`, connected to the GitHub repository with the
production branch `main`. Project names are unique across Cloudflare, so the
subdomain carries a suffix when the name is taken, such as `crosstune-1dw`.
Every preview deployment lives at `<branch>.<pages-subdomain>.pages.dev`.

> **Note:** The dashboard's Create application page opens on Workers, and its
> Import a repository button creates a Worker. The Pages flow is behind the
> link labeled "Need to use the legacy Pages workflow?". Cloudflare calls
> Pages legacy and steers new projects toward Workers. The preview hostnames,
> the `_headers` file, and the single-page fallback all rely on Pages, so a
> move to Workers is a design change and sits on the backlog.

| Build setting          | Value        |
| ---------------------- | ------------ |
| Framework preset       | None         |
| Build command          | `pnpm build` |
| Build output directory | `dist`       |
| Root directory         | `web`        |
| Build watch paths      | `web/*`      |

Pages reads the Node version from `web/.node-version`, the same file the
GitHub workflows read, so Node needs no variable. Pages ignores the
`packageManager` field and cannot read a pnpm 12 lockfile with its default
pnpm, so `PNPM_VERSION` is set in both environments. A stale value fails the
next build on the lockfile version and leaves the previous deployment
serving.

Production variables:

| Variable                     | Value                  |
| ---------------------------- | ---------------------- |
| `VITE_API_URL`               | `https://api.<domain>` |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...`          |
| `VITE_SENTRY_DSN`            | `crosstune-web` DSN    |
| `VITE_SENTRY_ENVIRONMENT`    | `production`           |
| `PNPM_VERSION`               | `12.4.1`               |

Preview variables:

| Variable                     | Value                          |
| ---------------------------- | ------------------------------ |
| `VITE_API_URL`               | `https://<railway-dev-domain>` |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_...`                  |
| `VITE_SENTRY_DSN`            | `crosstune-web` DSN            |
| `VITE_SENTRY_ENVIRONMENT`    | `development`                  |
| `PNPM_VERSION`               | `12.4.1`                       |

A saved variable applies to builds that start after it. Pages has no build
button, so a change takes effect on a retry of the most recent deployment
or on the next push.

The custom domain `<domain>` is attached to the Pages project, and Cloudflare
creates its DNS record. The Clerk production instance is bound to that
domain. `web/public/_headers` sets `X-Content-Type-Options`,
`X-Frame-Options`, and `Referrer-Policy` on every response. The project has
no `404.html`, so Pages serves `index.html` for any path that matches no
file, which is what lets a client-side route load directly.

### Cloudflare zone

The zone for `<domain>` holds the DNS records for Pages, the API, and Clerk.
Every record that Railway or Clerk validates has the proxy off. Under
SSL/TLS, Always Use HTTPS is on and the encryption mode is Full (strict).
HTTP Strict Transport Security is on with these settings: a max age of six
months, applied to subdomains, preload off, and the no-sniff header on. The
`_headers` file cannot set HSTS, which is why it is a zone setting.

Cloudflare injects the HSTS header only on proxied hostnames, which here is
the apex alone. Browsers apply the subdomain rule from the apex visit, so
`api.<domain>` and the Clerk hostnames inherit the policy. A subdomain that
later drops HTTPS is unreachable until the max age expires.

### GitHub

Actions variables:

| Variable                | Value                  |
| ----------------------- | ---------------------- |
| `PRODUCTION_API_ORIGIN` | `https://api.<domain>` |
| `PRODUCTION_WEB_ORIGIN` | `https://<domain>`     |
| `CLERK_ISSUER`          | The development issuer |

Actions secrets, used only by the `E2E` workflow:

| Secret                       | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| `CLERK_SECRET_KEY`           | The development instance's `sk_test_...` key                |
| `VITE_CLERK_PUBLISHABLE_KEY` | The development instance's `pk_test_...` key                |
| `E2E_CLERK_USER_EMAIL`       | The email of a user that exists in the development instance |

The repository allows only squash merges, with the pull request title and
body as the commit message, and deletes head branches after merge. A branch
ruleset named `main` requires a pull request, the five workflow jobs as
status checks, and linear history. It blocks force pushes and deletion.
GitHub enforces rulesets on private repositories only on paid plans. On the
free plan the ruleset exists and does nothing, and not pushing to `main` is a
matter of habit.

> **Note:** Before enforcement is turned on, remove the `paths` filter from
> the `pull_request` trigger in both workflows. A required check that never
> starts blocks the merge.

## Smoke check

After a deploy, run the smoke check from the repository root. It needs no
credentials.

```bash
just smoke https://api.<domain> https://<domain>
```

The **Smoke** workflow in the Actions tab runs the same script. A blank input
uses the `PRODUCTION_API_ORIGIN` and `PRODUCTION_WEB_ORIGIN` variables.

The script proves seven things. The API answers `{"status":"ok"}` at
`/healthz`. It refuses an anonymous call to `/v1/me` with a 401 and a
problem-details body. It grants CORS to the web origin on a preflight. The
web origin serves the app shell, a manifest that names Crosstune, the service
worker, and the app shell again for a client-side route.

For the development environment, point it at the Railway development
hostname and a preview site.

```bash
just smoke https://<railway-dev-domain> https://<branch>.<pages-subdomain>.pages.dev
```

The manual test on a phone covers what the script cannot.

1. Open `https://<domain>` and sign in.
2. Add a tune and paste a YouTube link.
3. Install the app to the home screen.
4. Turn on airplane mode and edit the tune.
5. Turn off airplane mode.
6. Make sure that the edit synced. Settings shows the last sync time.

## Releasing

A merge to `main` deploys the API in both environments and the production
web client. Railway skips the deploy when nothing under `api/` changed. Pages
skips the deploy when nothing under `web/` changed.

To cut a version, run `cz bump` in `api/`, which updates the API version and
tags the commit. Bump the `version` field in `web/package.json` by hand in
the same change, so the web Sentry release tag changes too.

When you bump pnpm in the `packageManager` field of `web/package.json`,
update `PNPM_VERSION` in both Pages environments in the same change. A Node
bump is one edit to `web/.node-version`.

The `E2E` workflow runs from the Actions tab on demand. It signs in through
the live Clerk development instance. If it gated pull requests, an outage or
a rate limit there could block unrelated merges. Once the suite has run
green from a manual dispatch, promote it to a pull request check. Add this
to the `on:` block in `.github/workflows/e2e.yml`:

```yaml
pull_request:
    paths: ["web/**", "api/**"]
```
