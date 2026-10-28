# Crosstune architecture

The stack and what it rules out, where the boundaries sit, the source of
truth for each question, and the invariants both clients and the API hold.
How one feature works is in its code. Deploys and releases:
`operations.md`.

## Stack

| Part              | Choice                                                                                          | Never                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| iPhone, iPad, Mac | One native SwiftUI app                                                                          | Capacitor, which closes the iOS gaps only through native plugins                          |
| Android, browsers | The web client, an installable PWA. Android's store build is it in a Capacitor shell            | A native Android app: a third client and a third sync engine                              |
| API               | Python, FastAPI. Server audio work (transcode, trim, peaks) in Python                           | Speed or pitch on the server: both play on the device                                     |
| Web client        | React, Vite, React Router in data mode, React Aria Components, Motion, Tailwind `@theme` tokens | A component library (Ionic, daisyUI), or two component systems in one interface           |
| Apple local store | SQLite through GRDB                                                                             | SwiftData or SQLiteData: the sync rules need exact control of transactions and migrations |
| Web local store   | IndexedDB through Dexie                                                                         |                                                                                           |
| Sign-in           | Clerk. Its dashboard sets the sign-in methods                                                   | Magic links, self-hosted auth                                                             |
| Database          | Postgres on Neon, no extensions                                                                 | A vendor extension: the host changes with a connection string                             |
| Audio and images  | Cloudflare R2, Standard storage. RustFS in Docker locally                                       | A hosted bucket for local work                                                            |
| Hosts             | API on Railway. Web client and site on Cloudflare Workers                                       |                                                                                           |

- The web on iOS cannot receive a shared link, play reliably with the
  screen locked, keep its local data, or control recording quality. That
  is why Apple gets a native app and Android does not.
- Two UI stacks and two sync engines, TypeScript and Swift, that behave the
  same. A behavior change to one engine is made in both.
- Tailwind supplies tokens, spacing, and layout, never components.
- The API and its database sleep when idle, in every environment. Nothing
  holds a connection open or runs on a timer that keeps the host awake. A
  job runner never polls on a fixed interval.
- A null `owner_user_id` and `merged_into_id` on tunes are the hooks for
  a shared catalog (`product.md`, Constraints). Keep them.
- The apex domain is a static site that never calls the API or Clerk. The
  app is at `my.<domain>`. Never one URL split by session: the service
  worker serves the app shell at `/` offline.

## Boundaries

- Screens read only the local copy, through live queries. They never call
  the API.
- A user action runs a command. A command writes the row and an outbox
  entry in one transaction.
- A local row keeps every server field the client does not know, and a
  push sends it back unchanged, so an older client never erases a newer
  field.
- Only the sync engine talks to the network. Files are the one exception:
  they move over presigned R2 URLs in a transfer pass of their own, so a
  large upload never blocks a sync.
- The API knows nothing about its clients. Its OpenAPI schema,
  `api/openapi.json`, is the contract. Both clients' types and their
  copies of every validated value and length are generated from it, and
  CI fails when a committed copy drifts.
- Every validated list and field length is written once, in
  `api/src/crosstune/vocabulary.py`. Never a database table of
  vocabularies. Display labels stay in each client, typed against the
  generated unions, so a new server value fails the build until it has a
  label.
- Apple styles, tokens, and controls with no feature knowledge live in
  `CrosstuneDesign`. `CrosstuneUI` depends on it, never the reverse, so
  the compiler rejects a style that reaches into a screen. A type that
  needs a feature's type, string, or sample data stays in `CrosstuneUI`.
- `CrosstuneAudio` holds the audio engine, playback, input, the tuner,
  and MusicKit, and depends on no store, command, or database module.
  Audio code that needs the store, a command, or a recording's row goes
  in `CrosstuneRecording`.
- The Swift generator reads a normalized copy of the contract, with enums
  and closed objects loosened, so an installed app decodes rows from a
  newer API.
- Every `/v1` route except a webhook requires a Clerk bearer token. No user
  ID appears in a URL or a body. The server sets ownership from the token
  and scopes every query to the caller.
- A request body is read only after its token verifies, and never past a
  size limit.
- The API has no CORS. Browsers reach it same-origin, through the Vite
  proxy locally and the Worker when hosted.
- Errors are problem-details documents (RFC 9457). An unhandled exception
  is a 500 with no detail and a Sentry report.
- `web/src/platform/` owns the frame, the pointer, reduced motion, haptics,
  the wake lock, the audio session, and the back button. A Capacitor shell
  adds one file, its `BackAdapter`.
- Web navigation is browser history, through React Router, never
  `window.location`. Never per-tab stacks apart from history: the
  browser's back and the app's back would disagree.
- Nothing the tuner hears leaves the device. Logic written in both
  clients (the pitch detector) tests against one shared fixture in
  `fixtures/`.

## Sources of truth

| Question                 | Answer                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which write wins         | The client's `updated_at`. Last write wins, per row. Never per-field merges.                                                                                                                                   |
| What to pull next        | `server_seq`, one Postgres sequence. Every writer that bumps it holds the per-user advisory lock (`lock_user`) through commit, so numbers commit in order. A pull holds it shared. A cursor never skips a row. |
| Who owns a row           | The token.                                                                                                                                                                                                     |
| Is a row deleted         | `deleted_at`. Deletes are soft and tombstones are kept forever, so a deletion reaches every device. A delete clears the row's content.                                                                         |
| History                  | Plays, practice sessions, scan views, and status changes: insert-only, on their own route and cursor (`GET /v1/sync/events`), out of the main pull.                                                            |
| Which local database     | One per user, so two accounts on one device never share data. Sign-out deletes it, and refuses while unsent changes (other than history) or unuploaded files remain.                                           |
| What an account can add  | Its grants, on the server (Entitlements).                                                                                                                                                                      |
| Which version is running | Each side's package or bundle version, which is also its Sentry release. Clients send theirs in `X-Client-Version` and `X-Client-Platform`.                                                                    |
| Host settings            | The host dashboards. Configuration says how each deployable reads them.                                                                                                                                        |

## Sync

- The client pushes the outbox in order. The API applies a batch in one
  transaction, parents before children, with one result per change:
  - `applied`: new, or a newer timestamp. An equal timestamp is a no-op
    that reports `applied`, so a replay is safe. The client stamps each
    write to a row at least 1 ms past the last.
  - `stale`: the stored row is newer. The response carries it and the
    client overwrites its copy.
  - `invalid`: only that change is refused. The client drops it and
    reports to Sentry.
- A row with an unknown field, or missing a required one, is `invalid`. A
  missing optional field takes its default, so an upsert from a client
  that predates the field resets it. A field the server must protect from
  older clients keeps its stored value when a push omits it
  (`tuner_a4_hz`, `place_id`, `place_origin`). `operations.md` says how to
  release a shape change.
- History rows are accepted against a soft-deleted parent, so a device
  that played something another device deleted still lands its history.
- A server-side write to a synced row (a job, a sweep, a relink) bumps
  `server_seq`, leaves `updated_at` alone, and holds `lock_user` through
  commit. A job that calls out to a service does so outside any
  transaction, then writes only if the row is unchanged.
- A request route passes `wait_seconds` to `lock_user` and answers 429
  when the wait runs out, and a sync route also counts against the
  account's requests in flight. A waiting request holds a pooled
  connection, so an unbounded wait lets one account hold them all. A
  route that takes the billing lock bounds that wait too. Only jobs, ops
  commands, and webhooks, which no user can send at will, wait without a
  bound.
- The job runner claims jobs in turns across accounts: each account's
  oldest job, then each one's next. A sync push can queue hundreds of
  jobs, so oldest-first across everyone lets one account delay all others.
- A local shape change migrates in place and keeps every row, unsent edit,
  and unuploaded file. A migration that adds a field or a table only the
  server can fill resets the pull cursor. Unsent edits still win.
- A client that finds a local database written by a newer client deletes
  it and pulls from zero.
- A pulled row that is in the outbox with a newer local timestamp keeps the
  local row. The next push settles it.
- The Apple app's sync loops check before every request that they have not
  been stopped, so an engine stopped during sign-out never sends one
  account's request with the next account's token.

## Supported client versions

- `CROSSTUNE_APPLE_MIN_VERSION` is the lowest Apple version the API serves.
  A request below it gets 426 `urn:crosstune:update-required`, and the app
  runs as if offline until updated. The web is always current and has no
  floor.
- The API keeps each account's last-seen version per platform, so a floor
  change is decided from who still runs what.
- API changes are expand, then contract: add the new shape and keep the old
  one working. Remove the old shape only once the floor has passed every
  build that uses it.

## Entitlements

- Grants are the source of truth and never leave the server. Kinds
  `premium` and `storage_addon`, sources `trial`, `apple`, `stripe`, `comp`.
  Premium while any Premium grant has no expiry or expires after now.
- RevenueCat is the source for paid grants. Every path re-reads the account
  from RevenueCat and never trusts a webhook payload.
- A paid grant is keyed by RevenueCat's subscription ID. Never the store
  identifier: it changes with each Apple transaction and each Stripe plan
  change, so a renewal would become a second grant.
- A sandbox `apple` grant counts on every API, since TestFlight and App
  Review buy with sandbox money. A sandbox `stripe` grant counts only where
  the API is configured to accept it.
- The Apple app identifies its RevenueCat customer by the Clerk user ID and
  never logs out: logging out mints an anonymous customer, and a purchase
  made there never reaches the account.
- A step that moves money commits before the next step runs, so a retry
  never pays or refunds twice. Money steps run under a per-user billing
  lock (a session-level advisory lock on its own connection), held across
  those commits.
- The entitlements row is the grants' resolved copy: server-written,
  read-only to clients. It changes only when a grant is written, never
  when one expires or a deadline passes. A client judges expiry against its
  own clock, plus 7 days when `auto_renews`, so an offline device neither
  keeps a trial forever nor loses a renewal it has not pulled.
- A one-time notice is a timestamp the server sets once, never a settings
  field, so an older device cannot reset it.
- Only additions are refused. Edits and deletes always go through. A
  refused new row (`premium required`) stays on the client, with its file
  and outbox entry, and pushes again once the account is Premium.

## Accounts and sign-in

- The API verifies Clerk tokens offline against the issuer's cached JWKS.
  Only session tokens pass. A failed JWKS fetch for an uncached key is a
  503, never a 401, so a Clerk outage never signs anyone out.
- A browser token must carry an allowed `azp`. Native tokens carry none.
  The API reads only the `Authorization` header, never a cookie.
- Offline, or when Clerk fails to load in 5 seconds, the client opens the
  last user's local database. The Apple app's Clerk restores its user from
  cache, so a loaded Clerk does not mean online.
- Account deletion has two idempotent paths, `DELETE /v1/me` and Clerk's
  webhook. Foreign keys cascade. `deleted_accounts` denylists the Clerk
  ID, so a still-valid token never recreates the row and its client wipes
  its local data.
- The Apple app's welcome screen calls Clerk's Apple and Google sign-up
  directly, so neither method can be turned off in Clerk's dashboard
  without a release that removes its button.
- Clerk never revokes Sign in with Apple. The API does, from a fresh
  authorization code the client sends with `DELETE /v1/me`.
- Deletion queues PostHog deletes repeated over a week, since PostHog
  deletes only events it already has. A third-party cleanup failure never
  blocks a deletion.
- `users.country` holds a country, never an IP address. No route returns
  it.
- A daily pass claims its due time in `scheduled_runs` with one upsert, so
  one process runs it. A pass that sends warnings before it deletes does
  nothing when it cannot send.

## Links and playback

- Every outbound fetch passes the address policy: public addresses only,
  http and https only, every redirect hop checked, the connection made to
  the checked address.
- An import never downloads a media URL a client sent. It reads the source
  page again and downloads only from that source's host.
- A failed link resolve yields an untitled link, never an error.
- In-app search only where an API allows it: Apple Music, TIDAL, and the
  Internet Archive, on the app's own credentials. YouTube, Spotify,
  Bandcamp, SoundCloud, and Slippery-Hill only open the service's search
  page: their APIs refuse a multi-user app, or there is none. Never iTunes
  Search (one per-IP limit for every user). No cross-service matching:
  Odesli closed its keyless API.
- The API builds every search-page URL and decides which services search
  in the app. A service that gains or loses an API changes one adapter and
  no client.
- All users share one credential per service. A 429 holds that service
  until its `Retry-After`.
- A result is linked only on a tap, through the paste path. Never automatic
  matches: traditional tunes sit inside sets.
- Full Apple Music tracks play only on Apple, through MusicKit's
  `ApplicationMusicPlayer`. Never `SystemMusicPlayer`: it replaces the
  Music app's queue and plays after Crosstune closes. Never MusicKit JS on
  the web: a second sign-in and a new script origin in the CSP. Nothing
  about MusicKit reaches the API.
- A list plays only sources the app's own engine controls. Never an embed:
  it cannot report a track's end and stops when an iPhone locks.
- MusicKit answers remote commands, next, and previous itself. The app
  empties its queue when the player closes or a recording starts, and on
  iOS makes the audio session mixable before a song, or MusicKit
  interrupts it.

## Files

- Upload: an upload slot (quota reserved, PUT signed), a PUT to R2, then a
  confirm. Each slot signs its own key and its declared size, and confirm
  copies the object to where the server reads it, so a reused URL writes
  where nothing reads.
- ffprobe and ffmpeg read uploads only as local files, through the
  demuxers of the allowed types, with no environment but `PATH`, and under
  `prlimit` on Linux. The API process is non-dumpable.
- A signed download URL carries the revision it covers. A client records
  that revision against the file and seeks by the file's own start offset,
  never the row's, so a file from before a later trim still plays.
- A new file version gets a new revisioned key. The old object is deleted
  only after the commit that stops pointing at it.
- Recording originals are kept only so a transcode or trim can be redone.
  Never serve one or build a feature on one.
- A partial date is stored as UTC midnight at the start of its period and
  always shown in UTC, so a year never slips a day west of UTC.
- A local delete of anything with files runs inside
  `CrosstuneStore.writeDroppingFiles` on Apple, which removes files only
  after the write commits.
- Each database owns one storage space and holds credentials for no other:
  the sweep and the purge delete whatever their database does not know. A
  `pr-<n>` API adds its own prefix. Older scans keep `notation/` keys, so
  sweeps look under both prefixes.
- Location: a recording gets the device's location only when the user allows
  it. Place search hints only with the account's country, never the user's
  location. The Maps key never reaches the browser.

## Delivery

- The Worker's code runs only for `/v1/*` and proxies it, dropping the
  site's cookie. Every other path is a static asset, with `index.html` for
  an unknown one. It picks the API by hostname: production, a pull
  request's API through KV, else development.
- A service worker precaches the shell, so an offline reload needs nothing
  more. API responses are never cached. The service worker and manifest are
  `no-cache`, so a new build reaches an installed app on its next load.
- Railway's pre-deploy command runs the migrations, and a failed one
  cancels the deploy.

## Environments

| Environment  | API                         | Database                                    | Clerk instance | Web client                               | Recordings                                                                                        |
| ------------ | --------------------------- | ------------------------------------------- | -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local        | uvicorn on port 8000        | Postgres in Docker, a database per worktree | Development    | Vite dev server, proxies `/v1`           | RustFS bucket `crosstune-local`, `crosstune-wt-<name>` in a worktree                              |
| Development  | Railway, generated hostname | Neon development                            | Development    | Worker Preview at `main-crosstune-web`   | R2 bucket `crosstune-recordings-dev`                                                              |
| Pull request | Railway `pr-<n>`, generated | Neon branch `pr-<n>`                        | Development    | Worker Preview at `<name>-crosstune-web` | R2 bucket `crosstune-recordings-preview`, prefix `pr-<n>/`, seeded from development on every push |
| Production   | Railway, `api.<domain>`     | Neon production                             | Production     | Worker on `my.<domain>`                  | R2 bucket `crosstune-recordings`                                                                  |

Development runs the head of `main`. Production runs the commit the last
version tag promoted.

## Configuration

| Deployable     | Reads                                                      | From                                                                                             |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| API            | `CROSSTUNE_*` environment variables, via pydantic-settings | Railway service variables. Locally `api/.env`. Names and defaults: `api/src/crosstune/config.py` |
| Web client     | `VITE_*` variables at build time                           | Workers Builds variables through `web/scripts/hosted-build.sh`. Locally `web/.env`               |
| Worker         | `vars` and the KV binding                                  | `web/wrangler.jsonc`, in the repository                                                          |
| Site           | `PUBLIC_POSTHOG_TOKEN` at build time                       | Workers Builds variables through `site/scripts/hosted-build.sh`. Locally `site/.env`             |
| GitHub Actions | `vars.*` and `secrets.*`                                   | Repository settings                                                                              |

- Every name the code reads is in `api/.env.example`, `web/.env.example`,
  or `site/.env.example` with its explanation, names only a host sets
  included.
- `LOCAL_`, in the API `CROSSTUNE_LOCAL_`, marks a name only local work and
  the end-to-end suite set. `E2E_` marks an end-to-end credential.
- `STORAGE_` names a setting of any S3-compatible store. `R2_` names a
  value only R2 has.
- An environment qualifier comes last and is spelled out: `_PRODUCTION`,
  `_DEVELOPMENT`, `_PREVIEW`.
- A GitHub variable or secret that feeds one app variable takes that
  variable's name.
- Hosted values live in the host dashboards, never in the repository.

## When a system is unavailable

| Down                 | Effect                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Phone network        | The installed app loads from the service worker. Reads and writes work. Sync resumes later.        |
| Cloudflare           | An installed app loads, but sync fails because `/v1` goes through the Worker. A first visit fails. |
| Clerk                | A remembered user is admitted after 5 seconds. Sync waits. New sign-ins fail.                      |
| API                  | Reads and writes work. The outbox grows and the engine retries with backoff.                       |
| API asleep           | The first request boots it. Clients retry a 502 or 504 for about 15 s before treating it as down.  |
| R2                   | Audio already on the device works. Uploads wait and retry. A first download elsewhere fails.       |
| Neon                 | The API returns 500s. The client behaves as if the API were down.                                  |
| A streaming provider | New links save untitled. Embeds fail. Its search group offers only its own search page.            |
| Apple Maps           | Place jobs wait and retry. Web place search and maps fail quietly.                                 |
| Sentry or GitHub     | Nothing visible. Errors are dropped, or deploys and checks wait.                                   |
