# Crosstune decisions

Choices that bind future work, with the alternatives rejected, so nobody
reopens one without new information. Add a new entry at the end.

## Native Swift for Apple, React and Ionic for Android and the web

- iOS and macOS get one native SwiftUI app. The web client, installable as
  a PWA, serves Android and every browser. Android reaches the Play Store
  as the web client in a Capacitor shell.
- On iOS the web falls short on the core loop: Safari cannot receive a
  shared link, playback with the screen locked is unreliable, WebKit can
  evict local data, and MediaRecorder gives no control of recording
  quality. On Android the web client covers these, so a native Android
  app adds little.
- SwiftUI builds iOS and macOS from one codebase.
- Capacitor on every platform was rejected: it closes the iOS gaps only
  through native plugins, and gives no native feel, macOS app, widgets, or
  Siri.
- A native Kotlin app was rejected: a third client and a second sync engine
  rewrite for little gain over the web client.
- The cost: two UI stacks and two sync engines, TypeScript and Swift, that
  must behave the same way.
- The API is the boundary. The Swift client uses the same endpoints and
  generates its types from the OpenAPI schema.

## Paste any link, search where an API allows it

- Users paste a streaming URL and the API resolves its metadata. Paste
  accepts every provider. The Music services setting limits only search.
- Find recordings lists results from Apple Music, TIDAL, and the Internet
  Archive inside the app. Apple Music and TIDAL use the app's own
  credentials, so no user signs in to a music service.
- YouTube, Spotify, Bandcamp, SoundCloud, and Slippery-Hill get a row that
  opens the service's own search page:
  - YouTube: the Data API quota allows about 100 searches a day for the
    whole project.
  - Spotify: a new app in Development Mode allows 5 users and needs the
    owner's Premium subscription. Wider access needs a registered business
    with 250,000 monthly active users.
  - SoundCloud: API access is granted case by case and needs an Artist Pro
    account.
  - Bandcamp: no public API.
  - Slippery-Hill: no API, its search page sits behind a Cloudflare
    challenge for non-browser clients, and `robots.txt` disallows
    `/tune-search`.
- Apple Music search uses the Apple Music API with a developer token. iTunes
  Search was rejected: it allows about 20 calls a minute per IP address, and
  every search leaves from the API's one address.
- The API decides which services answer inside the app and builds every
  search page URL. A service that gains or loses an API changes one adapter
  and no client.
- A result is linked only on a tap. Traditional tunes usually sit inside sets, so
  automatic matches are unreliable.
- Matching one recording across services was rejected: Odesli (song.link)
  closed its keyless API and stopped issuing keys.

## Per-user catalog, shared catalog designed in

- Every tune is owned by its creator and invisible to others.
- The schema separates the tune from the user-tune relationship, so a shared
  canonical catalog can be added by a merge step.
- A shared catalog at launch brings deduplication, naming variants, and
  permissions that nobody needs yet.

## Python and FastAPI

- Server-side audio work (transcoding, trimming, waveform peaks, and a
  planned melody transcription) lives in Python. Speed and pitch play on
  the device, so they need no server.
- FastAPI emits OpenAPI, which generates the client's TypeScript types.
- Litestar was rejected for its smaller ecosystem. Nothing depends on the
  choice.
- Outbound HTTP uses `httpx2`, not `httpx`.

## TypeScript, React, and Vite

- A server-rendered Python client cannot work offline and shares nothing
  with a native client.
- Flutter renders to a canvas, which harms text selection, links, and
  accessibility.
- React Native from day one compromises the web output and doubles the
  learning load.
- React over Svelte: larger ecosystem, and both native paths stay open.

## Ionic React for the interface

- The app must read as native on iOS and Android and as a well-made web app
  on a desktop. Ionic supplies per-platform components, page transitions,
  swipe back, and per-tab stacks, and Capacitor is built around it.
- At 768px wide and 600px tall a sidebar replaces the tab bar, so a wide
  screen never shows a phone app in a browser.
- daisyUI was rejected: its screens read as a website (site header, centered
  column on a phone, outlined buttons, flat rows, no transitions).
- A mixed interface was rejected: half Ionic and half daisyUI reads worse
  than either.
- Tailwind supplies spacing and layout utilities only, never components.

## Ionic's router, not TanStack Router

- Page transitions, swipe back, per-tab stacks, and `IonTabs` work only with
  `@ionic/react-router` on react-router 6.
- TanStack's file-based routes and typed navigation are the price.
- Ionic's stacks are not linear browser history, so no code touches
  `history` or `window.location`.

## Hosting

- API in a container on Railway.
- Postgres on Neon. It suspends idle compute, bills by usage, and offers
  point-in-time recovery and branching. Railway Postgres was rejected (a
  container with a volume and snapshot backups only). Supabase was rejected
  (its value is a bundle of auth, storage, and client SDKs that an API-first
  design does not use, and its free tier pauses idle projects).
- The API and its database sleep when idle, in every environment. Cost
  outweighs the first request's latency, and the local-first clients render
  from their own store while the API wakes. An always-on production was
  rejected: it pays for idle compute, and it would be the one environment
  that behaves differently from what is tested. A job runner that polls on
  a fixed interval was rejected: any timer keeps the host awake.
- Web client on a Cloudflare Worker with static assets. The Worker proxies
  `/v1`, so the client is always same-origin and the API needs no CORS.
  Cloudflare labels Pages legacy, and only a Worker runs code in front of
  assets.
- Audio on Cloudflare R2, because it charges no egress and streaming is all
  egress.
- Every R2 object stays in Standard storage. Infrequent Access has no free
  tier and bills operations rounded up to the next million, so one object
  copied into it costs more per month than Standard storage of everything.
  It cannot pay off until the originals pass roughly two terabytes.
- Local recordings live on RustFS in Docker. Local work must never reach a
  hosted bucket, because the sweep would delete hosted audio it does not
  know about. MinIO was rejected: its community edition is archived.
  SeaweedFS was rejected: it runs more than a local stand-in needs.
- One preview bucket holds a prefix per pull request, seeded by copying
  from development. A bucket per pull request was rejected: it needs an
  admin token and its own CORS policy per bucket. A read-through fallback
  to the development bucket was rejected: it adds a second storage path in
  the app, and puts a development credential in every pull request
  environment.

## Clerk for sign-in

- An emailed one-time code, Google, and Apple. Apple is required by the
  App Store when any other social login is offered.
- The code over a magic link: it works when the email is read on another
  device, and a native app needs no Universal Links for it.
- No passwords: they add a reset flow and a credential to protect, and save
  only one code per device. Passkeys come later as the direct sign-in.
- The API verifies Clerk JWTs offline against the issuer's JWKS.
- Self-hosted auth was rejected: password reset, deliverability, and social
  login are too much for a solo developer.

## Offline edits with last-write-wins sync

- The client caches the full catalog and queues offline writes in an outbox.
- On reconnect it replays the queue. Conflicts resolve by the newest client
  timestamp, per row.
- Recording audio moves over presigned storage URLs in its own transfer
  pass, so a large upload never blocks a sync.
- A sync engine with per-field merges was rejected as more than the product
  needs. `architecture.md` describes the protocol.

## Validated values live in the API and reach the client through the contract

- Every list the server checks, and every field length, is written once in
  `api/src/crosstune/vocabulary.py`. The models, the row schemas, and the
  OpenAPI document derive from it, and the client's copies are generated.
- A database table of vocabularies was rejected. Every value has code
  behind it on at least one side, the client is offline first and would
  still need a synced copy, and the lists hold three to nine values.
- Display labels stay in the client, typed against the generated unions, so
  a new server value fails the client build until it has a label.
- The check constraints stay. A value change is one edit plus a migration,
  which is also where existing rows are reshaped when a value is retired.

## Full Apple Music playback on Apple only

- The Apple app plays Apple Music links in full through MusicKit for
  subscribers. The web client plays the Apple Music embed for everyone.
- MusicKit on Apple platforms uses the Apple Account signed in on the
  device. Nothing about it reaches the Crosstune API.
- MusicKit JS on the web was rejected. It needs a second sign-in flow and a
  new script origin in the Content-Security-Policy.
- `SystemMusicPlayer` was rejected. It replaces the Music app's own queue
  and keeps playing after Crosstune closes.

## Playlist mode on Apple only, for recordings and Apple Music songs

- A list plays as a playlist only in the Apple app. It plays recordings and
  full Apple Music tracks, and skips a tune with neither.
- Embeds stop when an iPhone locks, so a list cannot play through them
  without a musician touching the phone. Next, previous, and the end of a
  track need an engine the app controls.
- A list row still plays any link from its own play button, embeds included.

## GRDB for the Apple app's local store

- The Apple app keeps each user's catalog in SQLite through GRDB.
- The store is a cache of server rows beside an outbox. It needs a unique
  index per queued row, an ordered queue, one transaction across a row and
  its change, JSON columns, and a whole-file delete on sign-out. GRDB gives
  each directly, and `ValueObservation` feeds SwiftUI.
- SwiftData was rejected: it manages transactions, change propagation
  between contexts, and schema migration for the app, and the sync rules
  need exact control of each.
- SQLiteData was rejected: it adds a macro query language, Point-Free's
  dependency stack, and CloudKit sync, which the app does not use.

## A static site at the apex, the app at `my.`

- `<domain>` serves a static Astro site in `site/`, with its own Worker,
  pipeline, and preview aliases. The web client is at `my.<domain>`. A
  visitor who types the address sees what Crosstune is and can join the
  waitlist. A player signs in at `my.`.
- `my.` shares Clerk's home domain, so a session carries across. "my
  Crosstune" reads naturally.
- One URL split by session was rejected: the installed service worker
  serves the app shell at `/` offline, so the Worker and the app would both
  steer between site and app on the most fragile path.
- `app.<domain>` and `<domain>/app` were rejected: the word twice. A path
  base was rejected too, since it runs through the Ionic router, the
  service worker scope, and the PWA start URL.
- The app at the apex with marketing elsewhere was rejected: the address
  people share would land on a sign-in form.
- Astro over plain HTML (shared header and footer copied across pages) and
  over a second Vite entry in `web/` (it couples the site's deploys and
  caching to the app, which the split exists to avoid).
- The waitlist is Clerk's Waitlist mode, not a form of our own. Approval
  and the invitation email are in Clerk, which already owns sign-up.
