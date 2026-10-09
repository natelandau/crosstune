# Crosstune architecture

Two deployables, the web client and the API, and the hosted services around
them. This page records where the boundaries sit, what is the source of
truth for each question, and how data moves. Deploys and releases are in
`operations.md`.

## Systems

| System     | Role                                                                                                             | Depends on                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Web client | React single-page app, served by a Cloudflare Worker. Reads and writes a local copy of the catalog.              | Worker, Clerk, API                     |
| Worker     | Serves the client's static assets. Proxies `/v1/*` to the environment's API, so the client is same-origin.       | GitHub, Railway                        |
| API        | FastAPI container on Railway. Owns the schema, sync, ownership, link metadata, and recording storage.            | Neon, Clerk public keys, R2, providers |
| Neon       | Postgres. One database per environment.                                                                          |                                        |
| Clerk      | Sign-in UI and session tokens. Webhook on account deletion.                                                      | Cloudflare DNS for its hostnames       |
| R2         | Recording audio. The browser moves bytes directly with presigned URLs. The API signs and manages.                |                                        |
| Sentry     | Errors from both deployables.                                                                                    |                                        |
| PostHog    | Usage analytics from the site and the Apple apps. The API deletes a person's data when their account is deleted. | Cloudflare DNS for its proxy host      |
| GitHub     | Source and CI. Both hosts deploy from it.                                                                        |                                        |

The apex `<domain>` is the static marketing and waitlist site, served by
its own Worker. It never calls the API. It sends page views to PostHog
through the proxy host. It reaches Clerk only when a visitor acts: the
waitlist form loads Clerk's Frontend API once the email field is focused.
It embeds no third-party players.

Cloudflare also hosts the DNS zone for the product domain.

## Boundaries

- Screens read only the local copy, through live queries: IndexedDB (Dexie)
  on the web, SQLite (GRDB) in the Apple app. They never call the API.
- A user action runs a command. A command writes the row and an outbox entry
  in one transaction.
- A local row keeps every server field the client does not know, and a push
  sends it back unchanged, so an older client never erases a newer field.
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
  else is a 401, 413, or 503 before the body is buffered.
- The API has no CORS. Browsers reach it same-origin, through the Vite proxy
  locally and the Worker when hosted. The Apple app calls the API origin
  directly, which CORS does not govern. A token's `azp` claim, when present,
  must match an allowed client origin.
- `web/src/platform/` owns the frame, the pointer, reduced motion,
  haptics, the wake lock, the audio session, and the back button. A
  Capacitor shell adds one file, its `BackAdapter`.
- Navigation is browser history, through React Router, never
  `window.location`. Each tab or sidebar destination's last location is
  kept for the browser session.
- Android's back walks one app-owned back stack before history. Every
  overlay and screen state, such as selection, registers on it while
  open, and the one back handler in `web/src/platform/` reads it.
  `design-web.md` gives the order. The browser's own back is history and
  needs no handler.
- The schema uses no Postgres extensions.
- Errors are problem-details documents (RFC 9457). An unhandled exception is
  a 500 with no detail and a Sentry report.

## Sources of truth

| Question                 | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which write wins         | The client's `updated_at`. Last write wins, per row.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| What to pull next        | `server_seq`, one Postgres sequence. Every writer that bumps it, push and the job runner alike, holds a per-user advisory lock so numbers commit in order, and a pull holds it shared so no write lands between its reads. A cursor never skips a row.                                                                                                                                                                                                                  |
| Who owns a row           | The token.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Is a row deleted         | `deleted_at`. Deletes are soft and tombstones are kept forever, so a deletion reaches every device.                                                                                                                                                                                                                                                                                                                                                                     |
| Which tables sync        | User settings, tunes, user-tune, recording links, recordings, scans, recording loops (a labeled range on a recording's source timeline, a child of the recording), lists, list items. Four history tables, kept out of the main pull: plays, practice sessions, and scan views, which clients push once and never edit, and status changes, which the server writes when a user tune's status changes. Server-only, never synced: users, upload slots, background jobs. |
| Which local database     | One per user, named after the user, so two accounts on one phone never share data: an IndexedDB database on the web, a folder holding the SQLite file, audio, and scan images in the Apple app. Sign-out deletes it, and refuses while the outbox holds unsent changes other than history events (plays, practice sessions, and scan views), or while a scan is unuploaded, each with its own message. A shape change starts it over (see Pull).                        |
| Which version is running | The `version` in `web/package.json` and the API package version. Each is its side's Sentry release tag. The client sends its own in `X-Client-Version`.                                                                                                                                                                                                                                                                                                                 |
| Host settings            | The host dashboards. Configuration says how each deployable reads them.                                                                                                                                                                                                                                                                                                                                                                                                 |

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
- Plays, practice sessions, and scan views are insert-only: a replayed insert is a no-op
  and an edit or delete is `invalid`. They are accepted against a
  soft-deleted recording, link, list, or tune, so a device that played
  or viewed something another device deleted still lands its history. A parent that
  never existed or belongs to someone else is `invalid`.
- A tune delete cascades to its user record, links, and list items. A list
  delete cascades to its items.
- A row carrying an unknown field, or missing a required one, is
  `invalid`. A missing optional field takes its default, so an upsert from
  a client that predates the field resets it. A new client against an old
  API fails on the unknown field. `operations.md` says how to release a
  schema change.
- A user has one settings row. Every client derives its ID as a UUIDv5 of
  the Clerk user ID under one shared namespace, so two devices that create
  it offline write the same row. A second row for the same user breaks the
  unique `user_id` and is `invalid`.
- A tune record's play pin names a recording or link with no foreign key,
  and push never checks it as a parent. Clients ignore a pin whose row is
  missing, deleted, or filed under another tune.

Pull:

- Rows with `server_seq` above the cursor, every table but the history
  tables, oldest first, 500 per page. A fresh install pulls from zero.
- History rows come from `GET /v1/sync/events`, which pages like the main
  pull on a cursor of its own: plays, practice sessions, scan views, and
  status changes above it, oldest first. The client runs it only when a
  screen needs history: the stats page, or the catalog sorted by Last
  played. Event rows never schedule a sync, and sign-out's
  unsent-changes check ignores them.
- A local database shape change migrates the device's database in place.
  It keeps every row, every unsent edit, and every recording the server
  does not have yet, with its audio. A migration that adds a field only
  the server can fill resets the pull cursor, so the next pull fetches
  every row again and unsent edits win as usual.
- A web database from before version 6 starts over instead: it clears
  every synced store, the outbox, and unuploaded recording files and
  chunks, and resets the pull cursor. Other meta, such as filters, stays.
- A client that finds a local database written by a newer client, as after
  a web rollback or an older TestFlight build, deletes the whole database
  and pulls from zero. It loses unsent edits, unuploaded recordings and
  scans, and local preferences such as catalog filters and keep offline.
- Where `indexedDB.databases()` is missing, as in Firefox before 126, the
  client cannot see the newer version and opens that database as it is.
- A pulled row that is also in the outbox with a newer local timestamp keeps
  the local row. The next push settles it.

Triggers: app start, back online, tab visible, Clerk loading after an
offline sign-in, and 3 seconds after the last local write. Failure backs
off from 1 second to 60 seconds. The engine exposes one status value.

The Apple app ports this engine on two serialized loops: one runs push,
pull, and the storage figures; a second runs recording uploads then
downloads, and runs again after every sync loop run. Both loops check
before every request that they have not been stopped. An engine stopped
to close one account's store during sign-out therefore never sends that
account's request with the next account's token. The Apple app uses the
same triggers. A return to the foreground stands in for a visible tab.

## Sign-in

- Clerk's UI runs in the client. Before each request the client asks Clerk
  for a session token and sends it as a bearer token.
- The API verifies without calling Clerk: it caches the issuer's JWKS and
  refetches on an unknown key at most once a minute. A valid token is RS256,
  names the issuer, and carries `exp`, `iat`, `sub`, and `sid`. The `sid`
  claim limits it to session tokens: a JWT template token from the same
  instance has none. A pending session (`sts` of `pending`) is refused.
- When the JWKS fetch fails and the token's key is not cached, the API
  answers 503, not 401, so a client never asks the user to sign in again
  over an outage at Clerk.
- Clerk sets `azp` from the browser's `Origin`. A browser token must carry
  an allowed `azp`. A native SDK sends no `Origin`, so the Apple app's
  tokens carry no `azp`, and the API accepts a session token without one.
  The API reads only the `Authorization` header, never a cookie, so the
  claim guards nothing a missing value could expose.
- The first valid token from a Clerk user inserts a user row.
- Account deletion has two paths to the same row delete: `DELETE /v1/me`,
  one transaction that deletes the user row then calls Clerk to delete the
  account (a Clerk failure rolls the transaction back); and Clerk's webhook
  (Svix-signed), the only path for a deletion made from the Clerk
  dashboard. Both paths are idempotent. Foreign keys cascade to every table
  the user owns.
- The webhook's `user.deleted` event also queues four deletes of the
  person's PostHog data for the job runner, in the same transaction: one
  now, then after 10 minutes, 1 day, and 7 days. PostHog deletes only
  events it already has, so the later passes catch events a client sent
  just before and events an offline device uploads once it is back. A
  failure or a `deletion_errors` answer is retried. A PostHog failure
  never blocks the account deletion.
- `deleted_accounts` denylists the Clerk id so a token still valid after
  deletion can never recreate the row. The API answers that token with a
  401 of type `urn:crosstune:account-deleted`, and a client that receives
  it wipes its local data as if it had made the delete itself.
- Bucket files are removed after the response, and a sweep every 12 hours
  deletes any user prefix whose row is gone. A deleted row still exists in
  Neon's point-in-time recovery history until that window ends.
- Offline: the client remembers the last user ID in local storage. With no
  connection, or when Clerk fails to load within 5 seconds, the app opens on
  that user's local database. Sync reports offline until Clerk loads, then
  runs at once.
- The Apple app's Clerk restores its user from its cache with no network,
  so a loaded Clerk does not mean online. The app is offline when the
  device has no network path or Clerk has not loaded.
- Production uses Clerk's production instance. Development, local work, and
  the end-to-end suite share one development instance.

## Links

- Online, the client calls the resolve route as the user pastes, so the
  title shows before the save. Offline, it detects the provider from the URL,
  saves the link untitled, and the API resolves it during the next push, 8
  at a time within a 20 second budget. Stragglers stay untitled.
- Resolvers: oEmbed for YouTube, Spotify, and SoundCloud. The iTunes lookup
  for Apple Music. The metadata API for the Internet Archive. Slippery-Hill
  has no API and no Open Graph tags, so the API fetches the tune page under
  the same cap and address policy and reads its Tune Title, Artist, and
  audio file. A pasted file URL is not fetched and stays untitled. Any other
  URL, Bandcamp and TIDAL included, is fetched and read for Open Graph tags,
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
- Search: the client calls `GET /v1/links/search` with the query, the one
  service the musician picked, and the device's region. It offers the
  services in its local settings because a changed setting can be unsynced.
  The client never builds a service's search URL: for a service it does not
  search in the app, the route answers `search_only` with the `search_url`
  at once, with no upstream call. A region that is
  not two letters, such as `419`, is sent as `US`.
- Adapters for Apple Music, TIDAL, and the Internet Archive answer inline,
  up to 10 results each. Apple Music and TIDAL need the app's credentials,
  which `api/.env.example` names. A service with no adapter, or with unset credentials,
  answers `search_only`. Slippery-Hill always does: its search page sits
  behind a Cloudflare challenge for non-browser clients, and its
  `robots.txt` disallows `/tune-search`.
- The adapters run at once, each within the 5 second link timeout. A
  failure, a timeout, or a refused credential makes that group
  `unavailable`, never a failed request. Every group carries a `search_url`
  to the service's own search page, so each failure leaves a way on.
- Every user's search shares one credential per service. When Apple Music
  or TIDAL answers 429, the API stops calling it until its `Retry-After`
  passes, 60 seconds when it gives none and never more than 5 minutes, and
  the group answers `unavailable` until then. The hold lives in the API
  process.
- Each result URL passes the same provider detection and normalization as
  a paste. Link saves it through the paste path with no resolve call, so a
  linked result and a pasted URL store the same row.
- Each user may make 20 searches a minute, counted apart from link fetches.
  Past it the route answers 429 with `Retry-After`, and the sheet shows the
  wait. Offline, the client refuses a search without a request.
- Playback: the client builds each embed URL from the stored provider,
  provider ref, and URL with no network call. One dock above the navigation
  holds at most one item. A Slippery-Hill link with a file ref builds an
  `audio` embed, a plain `<audio>` element on the site's file URL, because
  the site forbids framing its pages. A link with no ref opens the page.
- The Apple app plays the same embed in a `WKWebView` that loads a local
  HTML page holding one iframe pointed at that URL, or an `<audio>` element
  for an `audio` embed, so nothing here reaches the network either.
  Playback is refused while a take is recording.
- The Apple app plays an Apple Music song or album link through MusicKit's
  `ApplicationMusicPlayer` when three conditions hold. The device allows
  Apple Music access, the account subscribes, and the catalog has the track
  in the account's storefront. Otherwise the link plays in its embed.
- MusicKit uses the Apple Account signed in on the device. The device asks
  for access on the first Apple Music play. Access never syncs, and nothing
  reaches the Crosstune API.
- If finding and starting the track takes more than 10 seconds, the link
  falls back to its embed. Time spent on the access prompt does not count.
- Closing the player, or starting a take, empties the MusicKit queue.
  MusicKit answers the system's remote commands itself, and an empty queue
  gives them nothing to start.
- A playlist plays a list's tunes one after another, never an embed. The
  Apple app plays recordings and Apple Music songs. The app, not the
  engine, owns the order, repeat, and shuffle, and each tune's source is
  chosen when its turn comes.
- The web client plays only recordings, the same way. Its queue lives in
  `ListPlaybackProvider`, which resolves each tune to a recording when its
  turn comes, from what the list holds then. A tune deleted, or archived
  and hidden, meanwhile is skipped. Anything else that plays, or the player
  closing, detaches the queue. Shuffle and repeat persist per device in
  `localStorage`. The queue never persists.
- Both Apple engines report one of three ends: the track finished, or the
  system asked for the next or the previous tune. A recording registers
  next and previous in place of the 15 second skips while a playlist holds
  it.
- MusicKit answers next and previous itself, so a playlist song loads
  between two copies of itself. A move to a copy is paused before it is
  heard and reported as next or previous. The app selects the middle entry
  after `prepareToPlay()`, and reads its ID once it plays, since the queue
  reads back empty until then.
- A late play from MusicKit after the app has let go of a song, such as the
  entry a previous moved to, is paused when it arrives. On iOS the next tune
  waits for that play to settle, because starting first lets MusicKit
  interrupt the new audio session, and a backgrounded app cannot take it back.
- On iOS, while a playlist plays, the app holds its audio session active, so
  it stays up between a recording and a song. Before a song, the app makes
  the session mixable with `.mixWithOthers`, so MusicKit's own session plays
  beside it. A recording sets it back to long-form playback. The session is
  released when the playlist ends or the player closes.

## Recordings

- Capture and playback happen on the device. A new recording plays at once.
- The Apple app captures with `AVAudioEngine` to a raw AAC stream in ADTS
  framing, written as it records: every packet carries its own header, so a
  capture cut off by a crash or a kill still plays up to its last complete
  packet. On stop, an AAC passthrough export copies the stream into an
  `.m4a` file with no re-encoding, and the raw stream is deleted. A capture
  left unfinished by a crash or a kill is finished the same way when the
  user's store next opens. One whose audio cannot be read stays in place
  until the user deletes it, since sign-out refuses while it remains. A
  capture stops itself at 95% of the server's per-file maximum
  (`storage.max_file_bytes`) and keeps what it recorded, so the finished
  file can still upload.
- Upload: the client asks the API for an upload slot (quota reserved, PUT
  signed), PUTs the file to R2, then confirms. The API queues a transcode,
  and an in-process job runner produces the playback file and its waveform
  peaks. Retry reruns a failed transcode. The playback file keeps the
  upload's channel count, mono or stereo, and anything with more than two
  channels is mixed down to stereo. An encode follows the source's bit rate,
  held between a floor and the passthrough ceiling. The floor doubles for
  stereo, and the ceiling is the passthrough limit for the channel count.
- Provenance: a recording has an `origin`, `own` or the import source, and
  an `origin_url`, set only for an import. Both are fixed when the row is
  first saved, and a later push never changes them.
- Dates: `added_at` is set once, when the row is created. `recorded_at` is
  null when unknown and comes with `recorded_precision`: `year`, `month`,
  `day`, or `time`. A partial date is stored as UTC midnight at the start of
  its period and is always shown in UTC, so a year never slips a day in a
  west-of-UTC zone. Only `time` shows in local time. The API refuses a
  mismatched pair, a partial date off its period's start, and a partial
  date more than a day ahead.
- Import: the client saves a Slippery-Hill link's audio by creating a
  recording with source `import`, which works offline. On push the API
  checks that the address is importable and queues an import job, or fails
  the row with "Can't import from this address." Retry fetches an import
  again when its file never arrived, and re-runs the transcode for one whose
  file did.
- The import job reads the tune page again to find the file, and never
  trusts a media URL from the client. It downloads over https from
  `www.slippery-hill.com` only. Each redirect hop is checked for scheme,
  host, and port, and passes the address policy.
- The download streams to a temporary file under the per-file cap
  (`recording_max_file_bytes`) and a time limit for the whole download. The
  job uploads the file outside the user lock. Under the lock it checks the
  quota and hands the recording to the existing transcode.
- When the import's date is still unknown, the job sets its year from the
  Slippery-Hill page. It never overwrites a date the user set.
- A 404 or 410 on the file fails the import at once. A network failure
  retries, then ends as "Couldn't reach Slippery-Hill".
- The PUT signature covers the declared size, so the bucket refuses a file
  of any other length. A slot expired for more than an hour without a
  confirmation is released, and the runner deletes whatever its PUT left.
- Scans move the same way: an upload slot, a PUT to R2, then a confirm.
  One quota (`storage_quota_bytes`) covers recordings and scans. A scan's
  image goes under the user's `scans/` key prefix. An image stored under
  the older `notation/` prefix keeps its key, and purges and orphan
  sweeps look under both.
- ffprobe and ffmpeg read an upload only as a local file, only through the
  demuxers of the audio types an upload may declare, and run with no
  environment but `PATH`. On Linux they run under `prlimit` limits on
  address space, CPU time, and file size, so a hostile file fails its job
  rather than the API, and the API process is marked non-dumpable so a
  tool cannot read its credentials through `/proc`.
- Download: the API signs a GET for a ready recording's playback file, and
  another for its peaks file. Each carries the revision the signature
  covers, read from the same row as the key. A client records that
  revision against the downloaded file, never the row's own, so a race with
  a later trim never mislabels it. Other devices fetch on play, or ahead of
  time when the setting to download all recordings is on. A fetch ahead of
  time that fails waits out the same backoff as an upload before the next
  pass retries it. The wait lives in memory, so a reload or relaunch
  retries at once, and a play always fetches.
- A client seeks within the audio file it holds by that file's own start
  offset, recorded when the file was downloaded, not by the recording's
  current offset, so a file downloaded before a later trim still plays the
  range it actually holds.
- The Apple app excludes a downloaded recording's file from the device
  backup; a captured file is not excluded, since it is the only copy until
  it uploads.
- A data export reads only the local store and the audio and scan image
  files the device holds. It never fetches either.
- The original upload is a backup. It is never modified, no endpoint serves
  it, and it never counts against a user's quota. A trim cuts from it.
- A saved trim is clamped on push to the recording's current playback
  range, and to at least 1000 ms. At most one trim job is queued per
  recording at a time; a trim saved while one runs is queued once it
  finishes.
- Loops sit on the source timeline, so a trim does not move them. A trim
  push, and any job that writes a trim or a measured length, re-clamps each
  loop to the new range and tombstones any loop left outside it. Deleting a
  recording tombstones its loops, and a loop pushed for a deleted recording
  is stored deleted rather than refused. Loop selection is device state
  and never syncs.
- Loops of one recording never overlap. Spans are half-open. A push that
  overlaps a live loop cuts the pushed loop to the largest free stretch of
  its span, or stores it deleted when that stretch is under 500 ms. An
  exclusion constraint in the database enforces the rule.
- The trim job cuts the kept range from the original, never from the
  current playback file. It uploads a new revisioned playback file and a
  new revisioned peaks file, and deletes the superseded objects only once
  the commit that stops pointing at them has landed. A failed trim leaves
  the old files in place, and the recording keeps playing them.
- The re-encode job re-cuts a recording's current range from its original
  when that would raise the playback file's bit rate. It never touches the
  peaks file, and drops its cut if the row changed while it ran.
- The peaks file holds one linear peak-amplitude byte per 20 ms window,
  prefixed by a version byte and a big-endian points-per-second value (50).
  A client records its own peaks locally while capturing, until the
  server's file is ready to fetch.
- A local delete drops its audio and scan files through
  `CrosstuneStore.writeDroppingFiles`. Deleting a recording, a tune, or
  several tunes, and Remove downloaded audio, each run inside it. When the
  write transaction commits, any audio or scan file no longer named by
  a row is removed. A failed write keeps both the file and the row. The
  transfer pass uses the same method for a recording tombstoned elsewhere.
- After launch recovery, the Apple app deletes every audio and scan
  file that was in the folder when the store opened and that no row names,
  such as one a crash left behind. A capture file, and the finished file
  of a row still capturing, always stay. An imported file never takes a
  capture's name.
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
  production. A `workers.dev` Preview hostname's name is looked up in KV for
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

| Environment  | API                         | Database                                    | Clerk instance | Web client                                | Recordings                                                                                        |
| ------------ | --------------------------- | ------------------------------------------- | -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local        | uvicorn on port 8000        | Postgres in Docker, a database per worktree | Development    | Vite dev server, proxies `/v1`            | RustFS bucket `crosstune-local`, `crosstune-wt-<name>` in a worktree                              |
| Development  | Railway, generated hostname | Neon development                            | Development    | Worker Preview at `main-crosstune-web`    | R2 bucket `crosstune-recordings-dev`                                                              |
| Pull request | Railway `pr-<n>`, generated | Neon branch `pr-<n>`                        | Development    | Worker Preview at `<name>-crosstune-web`  | R2 bucket `crosstune-recordings-preview`, prefix `pr-<n>/`, seeded from development on every push |
| Production   | Railway, `api.<domain>`     | Neon production                             | Production     | Worker on `my.<domain>`                   | R2 bucket `crosstune-recordings`                                                                  |

Development runs the head of `main`. Production runs the commit the last
version tag promoted. A pull request environment runs the PR branch with the
development variables and its own database. Sentry events carry an
`environment` tag of `production`, `development`, or `pr-<n>` for a PR's
API.

## Configuration

| Deployable     | Reads                                                                   | From                                                                                             |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| API            | `CROSSTUNE_*` environment variables, via pydantic-settings              | Railway service variables. Locally `api/.env`. Names and defaults: `api/src/crosstune/config.py` |
| Web client     | `VITE_*` variables at build time                                        | Workers Builds variables through `web/scripts/hosted-build.sh`. Locally `web/.env`               |
| Worker         | `vars` and the KV binding                                               | `web/wrangler.jsonc`, in the repository                                                          |
| Site           | `PUBLIC_CLERK_PUBLISHABLE_KEY` and `PUBLIC_POSTHOG_TOKEN` at build time | Workers Builds variables through `site/scripts/hosted-build.sh`. Locally `site/.env`             |
| GitHub Actions | `vars.*` and `secrets.*`                                                | Repository settings                                                                              |

- Every name the code reads is in `api/.env.example`, `web/.env.example`,
  or `site/.env.example` with its explanation, names only a host sets
  included.
- `LOCAL_`, in the API `CROSSTUNE_LOCAL_`, marks a name that only local work
  and the end-to-end suite set. `E2E_` marks an end-to-end credential.
- `STORAGE_` names a setting of any S3-compatible store. `R2_` names only a
  value that exists on R2 alone.
- An environment qualifier comes last and is spelled out: `_PRODUCTION`,
  `_DEVELOPMENT`, `_PREVIEW`.
- A GitHub variable or secret that feeds one app variable has that
  variable's name.
- The hosted values live in the host dashboards. The maintainer keeps the
  record of them outside this repository.

## When a system is unavailable

| Down                 | Effect                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Phone network        | The installed app loads from the service worker. Reads and writes work. Sync resumes later.        |
| Cloudflare           | An installed app loads, but sync fails because `/v1` goes through the Worker. A first visit fails. |
| Clerk                | A remembered user is admitted after 5 seconds. Sync waits. New sign-ins fail.                      |
| API on Railway       | Reads and writes work. The outbox grows and the engine retries with backoff.                       |
| API asleep           | The first request boots it. Clients retry a 502 or 504 for about 15 s before treating it as down.  |
| R2                   | Audio already on the device works. Uploads wait and retry. A first download elsewhere fails.       |
| Neon                 | The API returns 500s. The client behaves as if the API were down.                                  |
| A streaming provider | New links save untitled. Embeds fail. Its search group offers only its own search page.            |
| Sentry or GitHub     | Nothing visible. Errors are dropped, or deploys and checks wait.                                   |
