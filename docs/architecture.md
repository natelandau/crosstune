# Crosstune architecture

This page describes the systems that run Crosstune, what each one does, and
how they depend on each other. It covers the web client, the API, the
database, sign-in, sync, link resolution, the environments, and what a
musician sees when one system is down. For the product and the reasons
behind the stack, read `product.md` and `decisions.md`. For the settings
each host holds, read `hosting.md`. For deploys, releases, and the smoke
check, read `operations.md`.

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
request's own API. No entry, or a failed read, means the development API. The
client calls `/v1` on its own origin unless `VITE_API_ORIGIN` is set at build
time, which a build that is not served beside the API needs.

The interface is built on `@ionic/react` with `@ionic/react-router` on
react-router 6. Ionic supplies the per-platform components, the page
transitions, the swipe-back gesture, and the per-tab navigation stacks.
Nothing in the client forces Ionic's visual mode. Apple mobile devices get
`ios`, and every other device gets `md`. `src/app.css` imports Ionic's
stylesheets, then Tailwind's theme, then Tailwind's utilities, each into its
own cascade layer. Tailwind supplies spacing and layout utilities only.

Three axes decide the chrome around a screen: Ionic's mode, the frame at a
viewport width of 768px, and the pointer. `src/platform/` is the only module
that reads any of them, and one source answers each. `design.md` records what
the axes and the tab-scoped routes mean on screen.

`IonReactRouter` holds an `IonSplitPane`, which holds the `IonTabs` that owns
the four navigation stacks. The `IonTabBar` is a child of `IonTabs` on both
frames. The wide frame hides it rather than unmounting it, because a stack
loses its pushed pages when its tab button leaves the tree. The sidebar is the
split pane's own menu, so it sits beside `IonTabs` and switches tabs through
that hidden bar.

One array in `src/app/routes.tsx` holds every route, and the same routes serve
both frames. Routes are tab-scoped, so each path belongs to exactly one stack.
The `/songs/:songId` redirect keeps a shared link working.

| Route                          | Screen                                 |
| ------------------------------ | -------------------------------------- |
| `/`                            | Redirects to `/catalog`.               |
| `/catalog`                     | Catalog.                               |
| `/catalog/:songId`             | A song, in the Catalog stack.          |
| `/lists`                       | Lists.                                 |
| `/lists/:listId`               | One list.                              |
| `/lists/:listId/songs/:songId` | A song, in the Lists stack.            |
| `/recordings`                  | Recordings.                            |
| `/recordings/:songId`          | A song, in the Recordings stack.       |
| `/settings`                    | Settings.                              |
| `/songs/:songId`               | Redirects to `/catalog/:songId`.       |

No overlay is a route. A modal or a sheet is presented over whatever is on
screen, and the URL does not change while it is open. The record screen, the
song form, the filter sheet, the bulk edit sheet, and the two pickers all work
this way.

`web/src/` is organized by layer. `app/` holds the shell, the routes, and the
theme. `platform/` answers every question about the device: the three axes,
reduced motion, and the two seams a native plugin replaces. `ui/` holds the
primitives that every screen composes. `features/` holds one folder per
domain, each with its own screens and logic. Below the interface, `db/`,
`sync/`, `commands/`, `api/`, and `auth/` hold the data layers. `design.md`
names the file that implements each screen pattern.

Three rules keep a later Capacitor build cheap. `src/platform/haptics.ts` and
`src/platform/statusBar.ts` are the only two modules that touch a device
capability. Each one uses a browser API, and a Capacitor plugin can replace
it. No code calls `history.go`, `window.location`, or a delta navigation,
because Ionic's per-tab stacks are not linear browser history. Ionic's router
is the one way to navigate, so the Android hardware back button pops the
current stack inside a WebView. The API origin comes from `src/config.ts`,
which a custom origin needs.

The client keeps a full copy of the user's catalog in IndexedDB, through
Dexie. The screens read only that copy, through live queries. A user action
runs a command, and a command writes the row and appends a change to an
outbox in one IndexedDB transaction. Neither the screens nor the commands
call the API. Only the sync engine talks to the network.

The local database is named after the user, so two accounts on one phone
never share data. Sign-out deletes the database. Sign-out refuses to run
while the outbox holds unsent changes, so no edit is lost with it.

A service worker precaches the app shell, the scripts, the styles, and the
icons. The build emits one bundle for the client's own code, and it holds
every route. Ionic's components load on demand from a set of small chunks
beside it. The precache holds all of them, so an offline reload never needs a
file the install did not store. Responses from the API are never cached and
never fall back to the shell. The `_headers` file makes the assets layer serve
the service worker and the manifest with `no-cache`. A new build therefore
reaches an installed app on its next load. The same file marks the hashed
assets immutable for a year.

The client sends every error the sync engine meets to the `crosstune-web`
Sentry project, once per failure streak. It also reports each change the
server refused, as a warning. The release tag is the `version` field in
`web/package.json`, and the same value travels to the API in the
`X-Client-Version` header.

## The API

The API is one FastAPI process in a Railway container, built from the
Dockerfile in `api/`. Railway rebuilds it on a push to the environment's
branch that changes a file under `api/`: `production` for production, which
moves only on a version tag, and `main` for development. Railway's
pre-deploy command runs the Alembic migrations
in a separate container from the same image before the new deployment
starts, so the schema is never older than the code that serves it. A failed
migration cancels the deploy and the previous deployment keeps serving. The
container itself only starts uvicorn, so a restart never touches the schema
and a second replica needs no change here.

The API knows nothing about the web client. Its OpenAPI schema is the
contract, and the client's TypeScript types are generated from it. A CI job
regenerates the types and fails when the committed copy differs. A native
client later uses the same endpoints.

The API exposes these routes.

| Route                                  | Purpose                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /v1/sync/push`                   | Apply a batch of client changes.                                             |
| `GET /v1/sync/pull`                    | Return every row of the caller changed after a cursor.                       |
| `POST /v1/links/resolve`               | Return provider, canonical URL, title, and artwork for a URL.                |
| `GET /v1/me`                           | Return the caller's profile and storage use. Creates the user on first call. |
| `POST /v1/recordings/{id}/upload-slot` | Reserve quota for a recording and sign a PUT for its file.                   |
| `POST /v1/recordings/{id}/uploaded`    | Confirm the PUT landed and queue the transcode.                              |
| `POST /v1/recordings/{id}/retry`       | Run the transcode of a failed recording again.                               |
| `GET /v1/recordings/{id}/download`     | Sign a GET for the playback file of a ready recording.                       |
| `POST /v1/webhooks/clerk`              | Receive account deletions from Clerk.                                        |
| `GET /healthz`                         | Answer Railway's health check.                                               |

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
connection string. The synced tables hold each user's settings, songs, each
user's relationship to a song, recording links, recordings, lists, and list
items. Every synced table carries `created_at`, `updated_at`, `deleted_at`,
and `server_seq`. Deletes are soft, and tombstones are kept forever, so a
deletion reaches every device. Three tables are server-owned and never sync:
users, upload slots, and transcode jobs.

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

The user's files in the bucket are removed after the webhook has answered,
so a slow or unavailable bucket never delays or undoes the deletion. The job
runner also sweeps the bucket once an hour and deletes every user prefix
whose user row is gone, which makes the file removal certain even when that
first attempt fails.

Production uses Clerk's production instance on hostnames under the product
domain. Development, local development, and the end-to-end suite share one
Clerk development instance.

Offline, the client cannot reach Clerk. The client remembers the last signed
in user ID in local storage. When the browser is offline, or when Clerk fails
to load within five seconds, the app opens with that user's local database.
Reads and writes work. The sync engine reports offline, because it cannot get
a token, and resumes when Clerk loads again.

## Sync

The sync pair is the only way a client reads or writes catalog data. The one
set of per-resource endpoints is for recording files, which move through
presigned URLs rather than as rows.

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
requested. Opening a song never loads a player. A YouTube player is 200px
tall because YouTube requires at least 200 by 200 pixels. Every link also
opens the provider's app or site.

## Environments

| Environment  | API                         | Database             | Clerk instance | Web client                                    |
| ------------ | --------------------------- | -------------------- | -------------- | --------------------------------------------- |
| Local        | uvicorn on port 8000        | Postgres in Docker   | Development    | Vite dev server, proxies `/v1`                |
| Development  | Railway, generated hostname | Neon development     | Development    | Worker preview at `main-crosstune-web`        |
| Pull request | Railway `pr-<n>`, generated | Neon branch `pr-<n>` | Development    | Worker preview at `<alias>-crosstune-web`     |
| Production   | Railway, `api.<domain>`     | Neon production      | Production     | Worker on `<domain>`                          |

The development API service runs the head of `main`. The production service
runs the commit that the last version tag promoted, so the two differ between
releases. They otherwise differ only in their variables. A pull request
environment runs the PR branch with
the development variables and its own database. In every environment the
client reaches the API on its own origin.

Sentry receives events from both hosted environments in both projects. Each
event carries an environment tag of `production` or `development`, except
the API in a pull request environment, which tags its events `pr-<number>`
because `CROSSTUNE_ENVIRONMENT` is set per environment. The web preview
still tags `development`.

## When a system is unavailable

Each row describes what a musician sees when one system is down and the
others are up.

| Unavailable          | Effect                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Network on the phone | The installed app loads from the service worker. Reads and writes work. Sync resumes on reconnect.                                                                       |
| Cloudflare           | An installed app loads from the service worker, but sync fails because `/v1` goes through the Worker. A first visit fails.                                               |
| Clerk                | A signed in app opens after a five second grace period with the remembered user. Sync waits. New sign-ins fail.                                                          |
| Railway API          | Reads and writes work. The outbox grows. The engine retries with backoff and the app bar shows the state.                                                                |
| R2                   | Recording and playback of audio already on the device keep working. Uploads wait and retry. A first download of that recording on another device fails until R2 returns. |
| Neon                 | The API returns 500s and Sentry receives them. The client behaves as if the API were down.                                                                               |
| A streaming provider | A pasted link is saved without a title. In-app playback of an existing link from that provider fails until the provider returns.                                         |
| Sentry               | Nothing visible. Errors are dropped.                                                                                                                                     |
| GitHub               | Nothing visible. Deploys and checks wait until it returns.                                                                                                               |
