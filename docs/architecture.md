# Crosstune architecture

Two deployables, the web client and the API, and the hosted services around
them. This page records where the boundaries sit, what is the source of
truth for each question, and how data moves. The settings each host holds
are in `hosting.md`. Deploys and releases are in `operations.md`.

## Systems

| System     | Role                                                                                                       | Depends on                             |
| ---------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Web client | React single-page app, served by a Cloudflare Worker. Reads and writes a local copy of the catalog.        | Worker, Clerk, API                     |
| Worker     | Serves the client's static assets. Proxies `/v1/*` to the environment's API, so the client is same-origin. | GitHub, Railway                        |
| API        | FastAPI container on Railway. Owns the schema, sync, ownership, link metadata, and recording storage.      | Neon, Clerk public keys, R2, providers |
| Neon       | Postgres. One database per environment.                                                                    |                                        |
| Clerk      | Sign-in UI and session tokens. Webhook on account deletion.                                                | Cloudflare DNS for its hostnames       |
| R2         | Recording audio. The browser moves bytes directly with presigned URLs. The API signs and manages.          |                                        |
| Sentry     | Errors from both deployables.                                                                              |                                        |
| GitHub     | Source and CI. Both hosts deploy from it.                                                                  |                                        |

Cloudflare also hosts the DNS zone for the product domain.

## Boundaries

- Screens read only the local IndexedDB copy (Dexie), through live queries.
  They never call the API.
- A user action runs a command. A command writes the row and an outbox entry
  in one IndexedDB transaction.
- Only the sync engine talks to the network. Recording files are the one
  exception: they move over presigned R2 URLs in a transfer pass of their
  own.
- The API knows nothing about its clients. Its OpenAPI schema,
  `api/openapi.json`, is the contract. The web client's TypeScript types,
  its copies of every value and length limit the API validates, and the
  Apple app's Swift client are generated from it, and CI fails when a
  committed copy drifts.
- The Swift generator reads a normalized copy of the contract. Nullable
  fields become the form it supports, and string enums and closed objects
  are loosened, so an installed app decodes rows from a newer API.
- Every `/v1` route except the Clerk webhook requires a Clerk bearer token.
  No user ID appears in a URL or a body. The server sets ownership from the
  token and scopes every query to the caller.
- A request body is read only after its token verifies, and never past a
  size limit: 32 MiB for `/v1` routes, 64 KiB for the webhook. Anything
  else is a 401 or a 413 before the body is buffered.
- The API has no CORS. Browsers reach it same-origin, through the Vite proxy
  locally and the Worker when hosted. The Apple app calls the API origin
  directly, which CORS does not govern. A token's `azp` claim, when present,
  must match an allowed client origin.
- `web/src/platform/` is the only client module that reads the device: mode,
  frame, pointer, reduced motion, haptics, status bar, wake lock. A Capacitor
  plugin replaces one file.
- Navigation goes only through Ionic's router, never `history` or
  `window.location`. Ionic's per-tab stacks are not linear browser history.
- The schema uses no Postgres extensions.
- Errors are problem-details documents (RFC 9457). An unhandled exception is
  a 500 with no detail and a Sentry report.

## Sources of truth

| Question                 | Answer                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which write wins         | The client's `updated_at`. Last write wins, per row.                                                                                                                                                 |
| What to pull next        | `server_seq`, one Postgres sequence. Every writer that bumps it, push and the job runner alike, holds a per-user advisory lock so numbers commit in order and a cursor never skips a row.            |
| Who owns a row           | The token.                                                                                                                                                                                           |
| Is a row deleted         | `deleted_at`. Deletes are soft and tombstones are kept forever, so a deletion reaches every device.                                                                                                  |
| Which tables sync        | User settings, tunes, user-tune, recording links, recordings, lists, list items. Server-only, never synced: users, upload slots, transcode jobs.                                                     |
| Which local database     | One per user, named after the user, so two accounts on one phone never share data. Sign-out deletes it, and refuses while the outbox holds unsent changes. A shape change starts it over (see Pull). |
| Which version is running | The `version` in `web/package.json` and the API package version. Each is its side's Sentry release tag. The client sends its own in `X-Client-Version`.                                              |
| Host settings            | The host dashboards, recorded in `hosting.md`.                                                                                                                                                       |

## Sync

Push:

- The client sends the outbox in order, up to 500 changes per batch. A
  change names a table, a row ID, an operation, the row data, and the
  client's `updated_at`.
- The API resolves untitled links first, then applies the batch in one
  transaction, parents before children, and returns one result per change.
- `applied`: the row is new or the incoming timestamp is newer. An equal
  timestamp is a no-op that still reports `applied`, so a replay is safe.
  The client stamps each write to a row at least one millisecond past the
  last, so two different writes never share a timestamp.
- `stale`: the stored row is newer. The response carries it and the client
  overwrites its copy.
- `invalid`: validation failed, or a parent is missing or belongs to someone
  else. Only that change is refused. The client drops it and reports to
  Sentry. A recording link whose URL names a scheme other than http or https
  is invalid. A URL with no scheme is accepted, as the paste sheet accepts it.
- A tune delete cascades to its user record, links, and list items. A list
  delete cascades to its items.
- A row carrying an unknown field, or missing a required one, is
  `invalid`. A missing optional field takes its default, so an upsert from
  a client that predates the field resets it. A new client against an old
  API fails on the unknown field. `operations.md` says how to release a
  schema change.

Pull:

- Rows with `server_seq` above the cursor, every table, oldest first, 500
  per page. A fresh install pulls from zero.
- A local database shape change starts the local database over. It clears
  every synced store, the outbox, and unuploaded recording files and
  chunks, and resets the pull cursor. Other meta, such as filters, stays.
  The next pull fetches every row again. Unsent edits and unuploaded
  recordings on that device are lost.
- A client that finds a local database written by a newer client, as after
  a web rollback, deletes the whole database and pulls from zero. It loses
  what a start-over loses and also the meta a start-over keeps, such as
  catalog filters and keep offline.
- Where `indexedDB.databases()` is missing, as in Firefox before 126, the
  client cannot see the newer version and opens that database as it is.
- A pulled row that is also in the outbox with a newer local timestamp keeps
  the local row. The next push settles it.

Triggers: app start, back online, tab visible, Clerk loading after an
offline sign-in, and 3 seconds after the last local write. Failure backs
off from 1 second to 60 seconds. The engine exposes one status value.

## Sign-in

- Clerk's UI runs in the client. Before each request the client asks Clerk
  for a session token and sends it as a bearer token.
- The API verifies without calling Clerk: it caches the issuer's JWKS and
  refetches on an unknown key at most once a minute. A valid token is RS256,
  names the issuer, and carries `exp`, `iat`, `sub`, and `sid`. The `sid`
  claim limits it to session tokens: a JWT template token from the same
  instance has none.
- Clerk sets `azp` from the browser's `Origin`. A browser token must carry
  an allowed `azp`. A native SDK sends no `Origin`, so the Apple app's
  tokens carry no `azp`, and the API accepts a session token without one.
  The API reads only the `Authorization` header, never a cookie, so the
  claim guards nothing a missing value could expose.
- The first valid token from a Clerk user inserts a user row.
- Account deletion: Clerk's webhook (Svix-signed) hard-deletes the user row
  and foreign keys cascade. Bucket files are removed after the response, and
  an hourly sweep deletes any user prefix whose row is gone.
- Offline: the client remembers the last user ID in local storage. With no
  connection, or when Clerk fails to load within 5 seconds, the app opens on
  that user's local database. Sync reports offline until Clerk loads, then
  runs at once.
- Production uses Clerk's production instance. Development, local work, and
  the end-to-end suite share one development instance.

## Links

- Online, the client calls the resolve route as the user pastes, so the
  title shows before the save. Offline, it detects the provider from the URL,
  saves the link untitled, and the API resolves it during the next push, 8
  at a time within a 20 second budget. Stragglers stay untitled.
- Resolvers: oEmbed for YouTube, Spotify, and SoundCloud. The iTunes lookup
  for Apple Music. The metadata API for the Internet Archive. Any other URL,
  Bandcamp and TIDAL included, is fetched and read for Open Graph tags,
  capped at 512 KB. A JSON answer over 256 KB is refused. Each request times
  out after 5 seconds. A failure yields an untitled link, never an error.
- Each user may make 30 link fetches a minute, counted in the API process.
  The resolve route and the push resolution share the count. Past it the
  resolve route answers with a 429 and `Retry-After`, which the client
  treats as any failed resolve, and a push stores the link untitled.
- Every outbound fetch passes an address policy: the host must resolve only
  to public addresses, only http and https are fetched, every redirect hop
  is checked, and the connection goes to the checked address while the Host
  header and TLS name keep the original.
- Playback: the client builds each embed URL from the stored provider,
  provider ref, and URL with no network call. One dock above the navigation
  holds at most one item.

## Recordings

- Capture and playback happen on the device. A new recording plays at once.
- Upload: the client asks the API for an upload slot (quota reserved, PUT
  signed), PUTs the file to R2, then confirms. The API queues a transcode,
  and an in-process job runner produces the playback file. Retry reruns a
  failed transcode.
- The PUT signature covers the declared size, so the bucket refuses a file
  of any other length. A slot expired for more than an hour without a
  confirmation is released, and the runner deletes whatever its PUT left.
- ffprobe and ffmpeg read an upload only as a local file, only through the
  demuxers of the audio types an upload may declare, and run with no
  environment but `PATH`.
- Download: the API signs a GET for a ready recording. Other devices fetch on
  play, or ahead of time when the setting to download all recordings is on.
- Each database owns one storage space and holds credentials for no other,
  because the sweep and the purge delete whatever their own database does
  not know.
- A row stores a logical key. A `pr-<n>` API adds its own prefix when it
  reads or writes the bucket, so the same key never collides across pull
  requests.

## Delivery paths

- Workers Builds builds `web/` with Vite and uploads the output as the
  Worker's static assets. The Worker's code runs only for `/v1/*` and
  proxies it, keeping path, query, method, headers, and body and dropping
  the site's cookie. Any other path is served from assets, and an unknown
  path gets `index.html`.
- The Worker picks the API by hostname. The custom domain goes to
  production. A `workers.dev` preview hostname's alias is looked up in KV for
  a pull request's own API. No entry means the development API.
- A service worker precaches the shell, scripts, styles, and icons, so an
  offline reload needs nothing the install did not store. API responses are
  never cached. The service worker and manifest are served `no-cache`, so a
  new build reaches an installed app on its next load.
- The API is one container built from `api/Dockerfile`. Railway's
  pre-deploy command runs the Alembic migrations before the new deployment
  starts, and a failed migration cancels the deploy. The container itself
  only starts uvicorn.
- The API writes JSON log lines to standard output. Railway indexes them.

## Environments

| Environment  | API                         | Database             | Clerk instance | Web client                                | Recordings                                                                                        |
| ------------ | --------------------------- | -------------------- | -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local        | uvicorn on port 8000        | Postgres in Docker   | Development    | Vite dev server, proxies `/v1`            | RustFS bucket `crosstune-local`                                                                   |
| Development  | Railway, generated hostname | Neon development     | Development    | Worker preview at `main-crosstune-web`    | R2 bucket `crosstune-recordings-dev`                                                              |
| Pull request | Railway `pr-<n>`, generated | Neon branch `pr-<n>` | Development    | Worker preview at `<alias>-crosstune-web` | R2 bucket `crosstune-recordings-preview`, prefix `pr-<n>/`, seeded from development on every push |
| Production   | Railway, `api.<domain>`     | Neon production      | Production     | Worker on `<domain>`                      | R2 bucket `crosstune-recordings`                                                                  |

Development runs the head of `main`. Production runs the commit the last
version tag promoted. A pull request environment runs the PR branch with the
development variables and its own database. Sentry events carry an
`environment` tag of `production`, `development`, or `pr-<n>` for a PR's
API.

## When a system is unavailable

| Down                 | Effect                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Phone network        | The installed app loads from the service worker. Reads and writes work. Sync resumes later.        |
| Cloudflare           | An installed app loads, but sync fails because `/v1` goes through the Worker. A first visit fails. |
| Clerk                | A remembered user is admitted after 5 seconds. Sync waits. New sign-ins fail.                      |
| API on Railway       | Reads and writes work. The outbox grows and the engine retries with backoff.                       |
| R2                   | Audio already on the device works. Uploads wait and retry. A first download elsewhere fails.       |
| Neon                 | The API returns 500s. The client behaves as if the API were down.                                  |
| A streaming provider | New links save untitled. Embeds from that provider fail.                                           |
| Sentry or GitHub     | Nothing visible. Errors are dropped, or deploys and checks wait.                                   |
