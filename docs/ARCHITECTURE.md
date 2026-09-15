# Crosstune architecture and hosting

This page describes the systems that run Crosstune, what each one does, and
how they depend on each other. It also records what each hosted service must
hold for the whole to work. The first half is the map. The second half is
the reference for every dashboard setting, because those settings live in
the hosts and nowhere in the code. For the product and the reasons behind
the stack, read `docs/PRODUCT.md`.

## The systems

Crosstune is two deployables and seven hosted services.

```
                 GitHub (source, CI)
                  |              |
       push under web/      push under api/, pull request events
                  |              |
                  v              v
   +-------------------+     +-------------------+      +-------------+       +-------------+
   | Cloudflare Worker |     | Railway           |      | Neon        |       | R2          |
   | web client assets |---->| API container     |<---->| Postgres    |       | audio bytes |
   | /v1 proxy, KV     |     | one env per PR    |      | branch/PR   |       |             |
   +-------------------+     +-------------------+      +-------------+       +-------------+
            ^                         |     ^                                         ^
   app shell, assets,                 |     | jwks.json, user.deleted webhook         |  presigned PUT, GET (browser)
   /v1 JSON with a Clerk JWT          |     v                                         |  sign, HEAD, copy, delete (API)
            |                         |  +-------------+
   +-------------------+              |  | Clerk       |
   | Browser           |              |  | sign-in     |
   | React app         |              |  +-------------+
   | IndexedDB, outbox |              |         ^
   | service worker    |              |         | sign-in UI, session, token
   +-------------------+              |         |
            |                         |         |
            +-------------------------+---------+
            |                         |
            v                         v
   +-------------------+     +-----------------------------+
   | Sentry            |     | YouTube, Spotify, Bandcamp, |
   | crosstune-web     |     | SoundCloud, Apple, TIDAL,   |
   | crosstune-api     |     | Internet Archive            |
   |                   |     | oEmbed, iTunes, Open Graph, |
   |                   |     | Archive metadata            |
   +-------------------+     +-----------------------------+
```

| System     | What it does                                                                                         | Needs                              |
| ---------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Web client | The app the musician uses. Reads and writes a local copy of the catalog.                             | Worker, Clerk, API                 |
| API        | Owns the schema, the sync protocol, ownership rules, and link metadata.                              | Neon, Clerk public keys, providers |
| Neon       | Stores every catalog. One database per environment.                                                  | Nothing                            |
| Clerk      | Signs users in and issues the tokens the API verifies.                                               | Cloudflare DNS for its hostnames   |
| Cloudflare | Builds and serves the web client, proxies `/v1` to the API, terminates HTTPS for the product domain. | GitHub, Railway                    |
| Railway    | Builds and runs the API container. Terminates HTTPS for the API domain.                              | GitHub, Neon                       |
| R2         | Stores recording audio. The browser uploads and downloads it directly. The API signs and manages it. | Cloudflare account                 |
| Sentry     | Receives errors from the web client and the API.                                                     | Nothing                            |
| GitHub     | Holds the source and runs the checks. The hosts deploy from it.                                      | Nothing                            |

Cloudflare also hosts the DNS zone for the product domain. The Worker's custom
domain, the API hostname, and the Clerk hostnames are all records in that
zone.

## The web client

The web client is a single-page React application. Workers Builds builds it
from `web/` with Vite and uploads the output as the static assets of a Worker
named `crosstune-web`. The Worker itself is two small files under
`web/worker/`: the fetch handler and the origin selection. It runs only
for `/v1/*` requests and proxies them to the API, keeping the path, query,
method, headers, and body and dropping the site's cookie. Every other path
is served from the assets without running code, and a path that matches no
file gets `index.html`, so a client route loads directly.

The Worker chooses the API from the request hostname. The custom domain goes
to the production API. A `workers.dev` preview hostname carries the branch
alias, and the Worker looks that alias up in a KV namespace to find the pull
request's own API. No entry, or a failed read, means the development API. So
the client never knows an API origin; it always calls `/v1` on its own origin.

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
and never fall back to the shell. The `_headers` file makes the assets layer
serve the service worker and the manifest with `no-cache`. A new build
therefore reaches an installed app on its next load. The same file marks the
hashed assets immutable for a year.

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

The API has no CORS configuration. Every browser client reaches it on the
client's own origin, through the Vite proxy locally and the Worker when
hosted, and a native client sends no `Origin` header. The token audience check
still lists the allowed client origins: the product origin in production, and
the local origins plus a regex for the `workers.dev` preview hostnames in
development and in every pull request environment.

## The database

Each environment has one Neon Postgres database, in the same AWS region as
the Railway service. The API holds its own connection pool and connects
directly, not through Neon's pooler. Alembic needs a direct connection, and a
pooled one adds nothing for a single replica. Neon suspends the compute when
the database is idle. The first request after a pause takes a few seconds,
and the pool's pre-ping reconnects on its own.

The schema uses no vendor extensions, so the host can change with a
connection string. Seven tables hold users, each user's settings, songs, each
user's relationship to a song, recording links, lists, and list items. Every
synced table carries `created_at`, `updated_at`, `deleted_at`, and
`server_seq`. Deletes are soft, and tombstones are kept forever, so a deletion
reaches every device.

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
with no key. Apple Music resolves through the public iTunes lookup, and the
Internet Archive through its public metadata API. Any other URL, Bandcamp and
TIDAL included, is fetched and read for Open Graph tags, capped at 512 KB. A
Bandcamp page also carries the numeric album or track id that its embedded
player needs, and the API stores that id as the link's provider ref. Each
request times out after five seconds. A failure yields a link with no title,
never an error.

Online, the client calls the resolve route as the user pastes, so the title
shows before the save. Offline, the client detects the provider from the URL
pattern, saves the link without a title, and pushes it later. During a push,
the API resolves every untitled link before the transaction opens. It
resolves eight at a time, with a 20 second budget for the whole batch. A link
the budget cuts off is stored untitled.

The web client builds each embed URL from the stored provider, provider ref,
and URL with no network call. One app-wide player docked above the navigation
holds at most one recording at its service's compact size. The player opens
only when the user taps Play on a recording, which loads it with autoplay
requested; opening a song never loads a player. A YouTube player is 200px
tall because YouTube requires at least 200 by 200 pixels. Every link also
opens the provider's app or site.

## Delivery

GitHub holds the source, and both hosts deploy from it. Every commit that
lands on `main` is deployed. There is no release branch, no promotion step,
and no batching.

- Railway builds the API service in the `production` and `development`
  environments on a push to `main` that touches a file under `api/`. A pull
  request environment follows its PR branch instead and rebuilds on every push
  to it.
- Workers Builds builds the web client on every push under `web/`. A push to
  `main` deploys production. A push to any other branch uploads a version
  under the branch's alias, at
  `https://<alias>-crosstune-web.<workers-subdomain>.workers.dev`, and Workers
  Builds comments the URL on the pull request.
- The `Development` workflow force-pushes every commit on `main` to the
  `development` branch. Workers Builds uploads that branch under the alias
  `development`, which has no KV entry. The result is one stable URL for the
  development environment,
  `https://development-crosstune-web.<workers-subdomain>.workers.dev`. The
  branch rebuilds only when a push changes a file under `web/`. Do not open a
  pull request from `development`, because the `Preview` workflow then gives
  the alias its own API and database.
- The `Preview` workflow gives each pull request its own API and database.
  When a PR opens, it creates a Neon branch `pr-<number>` from the development
  database, creates a Railway environment `pr-<number>` copied from
  `development` with that branch as its database and the PR branch as its
  source, reads the environment's generated hostname, and stores it in KV under
  the branch alias. On every push it resets the Neon branch to its parent, so
  each build migrates a clean copy of the development data and test data
  entered in the preview is lost. When the PR closes, it deletes all three.
  If a close event ever fails to clean up, the same workflow runs from the
  Actions tab with the PR number and branch name and deletes them.

GitHub Actions runs on every pull request and on every push to `main`. The
`API` workflow lints, type checks, tests against a real Postgres 18, and
verifies the committed OpenAPI contract. The `Web` workflow lints, type
checks, tests, builds, and verifies the generated client types. The hosts do
not wait for these workflows unless Railway's Wait for CI setting is on. The
`E2E` workflow runs the Playwright suite against a real Clerk development
instance on each pull request that changes `web/` or `api/`, and on demand.
It does not gate merges.

Rollback on either host is one click to redeploy an earlier build. A bad
commit is undone in minutes, and the outbox means a client outage loses no
edits.

One command sets both version numbers. `just bump` at the repository root
runs commitizen from `.cz.toml`, which updates the API package version, the
`version` field in `web/package.json`, and creates the git tag. Each value
becomes the Sentry release tag for its side. Tags trigger nothing.

## Environments

| Environment  | API                         | Database             | Clerk instance | Web client                                    |
| ------------ | --------------------------- | -------------------- | -------------- | --------------------------------------------- |
| Local        | uvicorn on port 8000        | Postgres in Docker   | Development    | Vite dev server, proxies `/v1`                |
| Development  | Railway, generated hostname | Neon development     | Development    | Worker preview at `development-crosstune-web` |
| Pull request | Railway `pr-<n>`, generated | Neon branch `pr-<n>` | Development    | Worker preview at `<alias>-crosstune-web`     |
| Production   | Railway, `api.<domain>`     | Neon production      | Production     | Worker on `<domain>`                          |

The development and production API services run the same commit. They differ
only in their variables. A pull request environment runs the PR branch with
the development variables and its own database. In every environment the
client reaches the API on its own origin.

Sentry receives events from both hosted environments in both projects. Each
event carries an environment tag of `production` or `development`, except
the API in a pull request environment, which tags its events `pr-<number>`
because `CROSSTUNE_ENVIRONMENT` is set per environment; the web preview
still tags `development`.

## When a system is unavailable

Each row describes what a musician sees when one system is down and the
others are up.

| Unavailable          | Effect                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Network on the phone | The installed app loads from the service worker. Reads and writes work. Sync resumes on reconnect.                               |
| Cloudflare           | An installed app loads from the service worker, but sync fails because `/v1` goes through the Worker. A first visit fails.       |
| Clerk                | A signed in app opens after a five second grace period with the remembered user. Sync waits. New sign-ins fail.                  |
| Railway API          | Reads and writes work. The outbox grows. The engine retries with backoff and the app bar shows the state.                        |
| R2                   | Recording and playback of audio already on the device keep working. Uploads wait and retry. A first download of that recording on another device fails until R2 returns. |
| Neon                 | The API returns 500s and Sentry receives them. The client behaves as if the API were down.                                       |
| A streaming provider | A pasted link is saved without a title. In-app playback of an existing link from that provider fails until the provider returns. |
| Sentry               | Nothing visible. Errors are dropped.                                                                                             |
| GitHub               | Nothing visible. Deploys and checks wait until it returns.                                                                       |

## Hosting reference

The sections below record what each host holds. None of it is in the code.
Railway's `railway.json` config files are deprecated, and a service created
after 2026-08-28 cannot use them, so the dashboards are the source of truth.
Values pass between hosts as follows.

| Value                                                       | Produced by    | Consumed by                          |
| ----------------------------------------------------------- | -------------- | ------------------------------------ |
| Neon production and development connection strings          | Neon           | Railway                              |
| Neon development project ID and database role               | Neon           | GitHub                               |
| `crosstune-api` and `crosstune-web` DSNs                    | Sentry         | Railway, Workers Builds              |
| Clerk development issuer, publishable key, and secret key   | Clerk          | Railway, Workers Builds, GitHub      |
| Clerk production issuer and publishable key                 | Clerk          | Railway, Workers Builds              |
| Clerk webhook signing secrets, one per instance             | Clerk          | Railway                              |
| Railway development hostname                                | Railway        | Clerk webhooks, `web/wrangler.jsonc` |
| Railway project, development environment, and service IDs   | Railway        | GitHub                               |
| `workers.dev` subdomain                                     | Cloudflare     | Railway development regex            |
| KV namespace ID                                             | Cloudflare     | `web/wrangler.jsonc`, GitHub         |
| Cloudflare account ID                                       | Cloudflare     | GitHub, Railway                      |
| R2 access key ID and secret access key, one pair per bucket | Cloudflare     | Railway                              |
| CNAME targets for `api.<domain>` and the Clerk hostnames    | Railway, Clerk | Cloudflare DNS                       |

A rebuild from nothing works through the hosts in the order Neon, Sentry,
Clerk, Railway, Cloudflare, GitHub, then the smoke check. It returns to Clerk
for the webhooks once Railway has hostnames.

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
authentication, and audio storage is Cloudflare R2.

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

A pull request environment is a third kind, named `pr-<number>`. The `Preview`
workflow creates it with the Railway CLI, as a copy of `development`, on the
first run that finds it missing, then overrides two variables and one
setting: `CROSSTUNE_DATABASE_URL` is the Neon branch's direct connection
string, `CROSSTUNE_ENVIRONMENT` is `pr-<number>`, and the service's branch is
the PR branch. Railway generates a public domain for it, and the workflow
reads that domain back. The workflow deletes the environment when the PR
closes. The account token it uses must belong to an account without
two-factor authentication, because the CLI cannot answer the prompt and the
delete hangs.

Production variables:

| Variable                             | Value                                       |
| ------------------------------------ | ------------------------------------------- |
| `CROSSTUNE_ENVIRONMENT`              | `production`                                |
| `CROSSTUNE_DEBUG`                    | `false`                                     |
| `CROSSTUNE_DATABASE_URL`             | Neon production string, as printed          |
| `CROSSTUNE_CLERK_ISSUER`             | `https://clerk.<domain>`                    |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTIES` | `["https://<domain>"]`                      |
| `CROSSTUNE_CLERK_WEBHOOK_SECRET`     | Production endpoint signing secret          |
| `CROSSTUNE_SENTRY_DSN`               | `crosstune-api` DSN                         |
| `CROSSTUNE_R2_ACCOUNT_ID`            | Cloudflare account ID                       |
| `CROSSTUNE_R2_BUCKET`                | `crosstune-recordings`                      |
| `CROSSTUNE_R2_ACCESS_KEY_ID`         | Production bucket's API token access key ID |
| `CROSSTUNE_R2_SECRET_ACCESS_KEY`     | Production bucket's API token secret        |
| `CROSSTUNE_RECORDING_QUOTA_BYTES`    | Optional. Default `1073741824`              |
| `CROSSTUNE_RECORDING_MAX_FILE_BYTES` | Optional. Default `52428800`                |
| `CROSSTUNE_JOB_POLL_SECONDS`         | Optional. Default `3.0`                     |

Development variables:

| Variable                                 | Value                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `CROSSTUNE_ENVIRONMENT`                  | `development`                                                           |
| `CROSSTUNE_DEBUG`                        | `false`                                                                 |
| `CROSSTUNE_DATABASE_URL`                 | Neon development string, as printed                                     |
| `CROSSTUNE_CLERK_ISSUER`                 | `https://<slug>.clerk.accounts.dev`                                     |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTIES`     | `["http://localhost:5173","http://localhost:4173"]`                     |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTY_REGEX` | `^https://[a-z0-9-]+-crosstune-web\.<workers-subdomain>\.workers\.dev$` |
| `CROSSTUNE_CLERK_WEBHOOK_SECRET`         | Development endpoint signing secret                                     |
| `CROSSTUNE_SENTRY_DSN`                   | `crosstune-api` DSN                                                     |
| `CROSSTUNE_R2_ACCOUNT_ID`                | Cloudflare account ID                                                   |
| `CROSSTUNE_R2_BUCKET`                    | `crosstune-recordings-dev`                                              |
| `CROSSTUNE_R2_ACCESS_KEY_ID`             | Development bucket's API token access key ID                            |
| `CROSSTUNE_R2_SECRET_ACCESS_KEY`         | Development bucket's API token secret                                   |
| `CROSSTUNE_RECORDING_QUOTA_BYTES`        | Optional. Default `1073741824`                                          |
| `CROSSTUNE_RECORDING_MAX_FILE_BYTES`     | Optional. Default `52428800`                                            |
| `CROSSTUNE_JOB_POLL_SECONDS`             | Optional. Default `3.0`                                                 |

A pull request environment inherits the development variables from the copy,
so it uses the `crosstune-recordings-dev` bucket too.

The regex writes the account's `workers.dev` subdomain literally. A subdomain
of `acme` gives `^https://[a-z0-9-]+-crosstune-web\.acme\.workers\.dev$`. It
admits every preview alias and every version preview of the Worker, and a PR
environment inherits it from the copy.

### Cloudflare Workers

One Worker, `crosstune-web`, connected to the GitHub repository through
Workers Builds with the production branch `main`. The configuration that
Cloudflare reads from the repository is `web/wrangler.jsonc`: the entry point
`worker/index.ts`, the assets directory `dist` with the single-page fallback
and `run_worker_first` limited to `/v1/*`, the custom domain route, the KV
binding `PREVIEW_API_ORIGINS`, and three runtime variables, `WORKER_NAME`,
`API_ORIGIN_PRODUCTION`, and `API_ORIGIN_DEVELOPMENT`. The product domain and
the Railway development hostname are literal in that file because the runtime
needs them and both are public in DNS already.

`workers_dev` is off and `preview_urls` is on. The bare
`crosstune-web.<workers-subdomain>.workers.dev` hostname serves nothing, and
every non-production version gets a preview URL. The deploy command for a
non-production branch passes `--preview-alias` with the slug that
`web/scripts/branch-slug.mjs` prints, so a branch has one stable URL across
pushes: `https://<alias>-crosstune-web.<workers-subdomain>.workers.dev`.
Cloudflare keeps the newest thousand aliases; nothing retires them.

| Build setting                        | Value                 |
| ------------------------------------ | --------------------- |
| Root directory                       | `web`                 |
| Build command                        | `pnpm build:hosted`   |
| Deploy command                       | `npx wrangler deploy` |
| Non-production branch deploy command | `pnpm deploy:preview` |
| Build watch paths                    | `web/*`               |
| Builds for non-production branches   | On                    |

Build variables, shared by every branch:

| Variable                            | Value               |
| ----------------------------------- | ------------------- |
| `CLERK_PUBLISHABLE_KEY_PRODUCTION`  | `pk_live_...`       |
| `CLERK_PUBLISHABLE_KEY_DEVELOPMENT` | `pk_test_...`       |
| `VITE_SENTRY_DSN`                   | `crosstune-web` DSN |
| `PNPM_VERSION`                      | `12.4.1`            |

`web/scripts/hosted-build.sh` picks the Clerk key and sets
`VITE_SENTRY_ENVIRONMENT` from the branch: `main` gets the production key and
`production`, every other branch the development key and `development`.
Workers Builds reads the Node version from `web/.node-version`. It ignores
the `packageManager` field, so `PNPM_VERSION` must match it; a stale value
fails the next build on the lockfile version.

The KV namespace `crosstune-preview-api` holds one key per preview alias whose
value is the pull request's API origin, `https://<railway hostname>`. The
`Preview` workflow writes and deletes the keys with `wrangler kv key`. The
Worker reads them at request time. A missing key means the development API.

On the Worker's Domains tab, the Worker URL rows carry two toggles. The
production `workers.dev` toggle is off and the preview toggle is on; a branch
upload never changes them, and previews return a 404 while the preview
toggle is off. The custom domain `<domain>` is attached on the same tab and
Cloudflare manages its DNS record and certificate. The Clerk production
instance is bound to that domain. `web/public/_headers` ships in the assets
directory and sets `X-Content-Type-Options`, `X-Frame-Options`, and
`Referrer-Policy` on every response, plus `no-cache` on the service worker and
the manifest.

The API token the workflow uses has one permission, Workers KV Storage Edit,
on this account only.

### Cloudflare R2

Two buckets, `crosstune-recordings` for production and
`crosstune-recordings-dev` for development, pull request environments, and
local work. The API signs upload and download URLs, and it does a HEAD
check, a copy, and a delete for cleanup. The browser sends the file straight
to R2 with the signed PUT and plays it back with the signed GET.

| Bucket setting  | Value                                     |
| --------------- | ----------------------------------------- |
| API token scope | Object Read & Write, on that bucket alone |
| CORS methods    | `GET`, `PUT`, `HEAD`                      |
| CORS headers    | Allowed: `Content-Type`. Exposed: `ETag`. |
| CORS max age    | 3600 seconds                              |

Each bucket has its own token. Railway holds a token's access key ID and
secret in `CROSSTUNE_R2_ACCESS_KEY_ID` and `CROSSTUNE_R2_SECRET_ACCESS_KEY`,
next to `CROSSTUNE_R2_ACCOUNT_ID` and `CROSSTUNE_R2_BUCKET`. The Railway
variable tables above list both environments.

The production bucket's CORS policy allows only the production web origin.

```json
[
  {
    "AllowedOrigins": ["https://<domain>"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The development bucket's CORS policy allows the local Vite server, the
stable development preview, and every pull request preview.

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:4173",
      "https://development-crosstune-web.<workers-subdomain>.workers.dev",
      "https://*-crosstune-web.<workers-subdomain>.workers.dev"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The Cloudflare account has a billing notification for R2 usage.

### Cloudflare zone

The zone for `<domain>` holds the DNS records for the Worker, the API, and
Clerk.
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

| Variable                     | Value                                         |
| ---------------------------- | --------------------------------------------- |
| `PRODUCTION_API_ORIGIN`      | `https://api.<domain>`                        |
| `PRODUCTION_WEB_ORIGIN`      | `https://<domain>`                            |
| `CLERK_ISSUER`               | The development issuer                        |
| `NEON_PROJECT_ID`            | The `crosstune-development` project ID        |
| `NEON_DATABASE_ROLE`         | The role in the development connection string |
| `RAILWAY_PROJECT_ID`         | The `crosstune` project ID                    |
| `RAILWAY_DEV_ENVIRONMENT_ID` | The `development` environment ID              |
| `RAILWAY_API_SERVICE_ID`     | The `api` service ID                          |
| `CLOUDFLARE_ACCOUNT_ID`      | The account ID                                |
| `CLOUDFLARE_KV_NAMESPACE_ID` | The `crosstune-preview-api` namespace ID      |

Actions secrets:

| Secret                       | Used by   | Value                                                       |
| ---------------------------- | --------- | ----------------------------------------------------------- |
| `CLERK_SECRET_KEY`           | `E2E`     | The development instance's `sk_test_...` key                |
| `VITE_CLERK_PUBLISHABLE_KEY` | `E2E`     | The development instance's `pk_test_...` key                |
| `E2E_CLERK_USER_EMAIL`       | `E2E`     | The email of a user that exists in the development instance |
| `NEON_API_KEY`               | `Preview` | A Neon API key                                              |
| `RAILWAY_API_TOKEN`          | `Preview` | A Railway account token, not a project token                |
| `CLOUDFLARE_API_TOKEN`       | `Preview` | The KV-only token described under Cloudflare Workers        |

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
problem-details body. The web origin proxies `/v1/me` to the API and
returns its 401 problem document. The web origin serves the app shell, a
manifest that names Crosstune, the service worker, and the app shell again
for a client-side route.

For a pull request, point it at the PR's Railway hostname and its preview URL.

```bash
just smoke https://<railway-dev-domain> https://<alias>-crosstune-web.<workers-subdomain>.workers.dev
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
web client. Railway skips the deploy when nothing under `api/` changed.
Workers Builds skips the deploy when nothing under `web/` changed.

To cut a version, run `just bump` at the repository root. It updates the
API version and the `version` field in `web/package.json` in one commit,
then tags it, so both Sentry release tags change together.

When you bump pnpm in the `packageManager` field of `web/package.json`,
update `PNPM_VERSION` in the Worker's build variables in the same change. A
Node bump is one edit to `web/.node-version`.

The `E2E` workflow runs on pull requests that change `web/` or `api/`, and
from the Actions tab on demand. It signs in through the live Clerk
development instance. Its job is not a required status check in the `main`
ruleset. As a required check, an outage or a rate limit at Clerk can block
unrelated merges. A new push to the same pull request cancels the run in progress, so
fewer sign-ins count against the instance's usage limits.
