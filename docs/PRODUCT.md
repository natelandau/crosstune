# Crosstune product brief

Crosstune is a song catalog for old-time and bluegrass musicians. A musician
keeps a list of the tunes they know and the tunes they want to learn. From any
tune, the musician can reach a recording of it in two taps, with or without a
network connection.

This document records what the product is, who it is for, what the first
release contains, and the decisions that shape the architecture. Read it before
you design or build any part of the system.

## The problem

Old-time and bluegrass musicians learn most of their repertoire by ear, from
other musicians at jam sessions and from recordings. The tools they use today do
not fit that workflow.

- Recordings made at a jam land in a general-purpose app such as Apple Voice
  Memos. They mix with every other recording on the phone, and they are hard to
  search or share.
- Musicians keep hand-written lists of the songs they know, often sorted by key,
  and separate lists of songs they want to learn.
- To learn a song, a musician wants their own recording of it next to streaming
  versions from YouTube, Spotify, or Apple Music. Those live in different apps.
- At a jam or a performance, a musician needs the list of songs they know and a
  fast reminder of how each one goes. That reminder can be the first bars of a
  recording, a chord chart, or a few bars of notation.

No single application covers these needs.

## Who it is for

The first users are old-time and bluegrass players who attend jams and want a
better tool than paper. Crosstune is a community product. It is free at launch.
Paid access comes later, so the data model and the account model must support
billing without a rewrite.

## The core loop

1. Add a tune to your catalog, with its key, tuning, and other attributes.
2. Mark it as known, learning, or want to learn.
3. Paste one or more links to recordings of it.
4. At the jam, open the catalog filtered by key, tap the tune, and hear it.

Everything else in the product supports this loop.

## First release scope

The first release is a responsive web application that a musician can install
on a phone home screen. It contains these features.

- Accounts. Sign in with an email magic link, Google, or Apple. Each catalog is
  private to its owner.
- Song catalog. Create, edit, and archive songs.
- Song attributes. Title, alternate titles, key, mode, violin tuning, banjo
  tuning, genre, feel, time signature, crooked, part structure, has lyrics,
  learned from, date learned, and freeform notes. Time signature is a fixed
  set of values that the web client defaults to 4/4. All other attributes
  except the title are optional.
- Status. Every song is known, learning, or want to learn.
- Named lists. A user creates ordered lists such as "Tuesday jam" or "Square
  dance set". A song can be in many lists.
- Linked recordings. A user pastes a URL from YouTube, Spotify, Apple Music,
  TIDAL, Bandcamp, SoundCloud, the Internet Archive, or any other site.
  Crosstune resolves the title and artwork and stores the link. A song can have
  many links, each with an optional label.
- Playback. Links from YouTube, Spotify, Apple Music, TIDAL, Bandcamp,
  SoundCloud, and the Internet Archive play inside the app, in one player
  docked above the navigation that stays loaded while the user browses.
  Streaming services play a preview unless the listener is signed in to the
  service. Every link also opens the streaming app or website.
- Browse. The home screen is the catalog filtered by status, key, mode, violin
  tuning, banjo tuning, and genre, with a text search. Filters persist between
  visits. The search text lasts only while the app is open, and it clears when
  the user starts a new song. A filter appears only when the catalog has values
  for it.
- Instruments. A user records in settings which instruments they play. A
  tuning field appears only for those instruments, or for a song that already
  carries a value. A tuning filter appears only for those instruments. A new
  account starts as violin only until a later onboarding flow asks the
  question.
- Offline. The full catalog is cached on the device. Reads and writes work
  without a connection. Writes sync when the connection returns.
- Recordings. A user records with the phone's microphone or uploads an audio
  file. A recording attaches to a song or waits unfiled in the Recordings tab.
  It plays at once on the device that made it and uploads in the background.
  It reaches the user's other devices when someone plays it, or ahead of time
  on any device where Keep recordings offline is turned on in Settings. A free
  account stores 1 GB of recordings.

These features are out of the first release. Each has a place in the data model
and no code.

- Search of streaming catalogs from inside the app
- A shared song catalog across users
- Sharing between users
- Sheet music and chord charts
- Billing

The first release succeeds when the founder uses it at a jam instead of a paper
list, and three other players ask for an account.

## Product constraints

These constraints hold for every release.

- Phone first. The jam-night screen is the primary screen. It must work with one
  hand, in poor light, in under two taps.
- Offline. Jams happen in barns, basements, and festival campgrounds with no
  signal. The catalog must be readable and editable without a connection.
- Native apps later. Audio recording works in the installed web app. Native
  apps come later for app store distribution and background audio. The
  backend and the API must not depend on the web client in any way.
- Private now, shared later. Each user owns their catalog. The schema separates
  the song from the user's relationship to the song, so a shared catalog can be
  added later by a merge step and not by a rewrite.
- Musical facets live on the song. Key, mode, tuning, and part structure are
  attributes of the tune. The user's record of a song holds only the
  relationship: status, where and when it was learned, and notes. When the
  shared catalog arrives, a player who uses a different key or tuning than the
  canonical entry gets optional override fields on their record.
- Vanilla Postgres. The schema uses no vendor-specific extensions, so the
  database host can change with a connection string.

## Decisions

Each decision below was weighed against alternatives. The reason is recorded so
that a later reader does not reopen a settled question without new information.

### Song list before recording

The song list with links to existing recordings ships first. Audio recording
ships second. The list is a data and integration problem that the web handles
well. Recording depends on microphone, wake lock, and storage behavior that
only a real phone can confirm.

### Responsive web application first, native apps second

The first client is a responsive web application, installable as a PWA. Audio
recording ships in the responsive web application, proven in the installed
home-screen app on iOS. Native apps follow for app store distribution. The
API is the boundary between the backend and every client, so a native client
plugs in without backend changes.

### Paste a link, no in-app search

A user pastes a URL from a streaming service. Crosstune resolves metadata from
the link and stores it. In-app search of Spotify, Apple Music, and YouTube needs
developer API keys, quotas, and terms of service, and it adds nothing to the data
model. It can be added later.

### Per-user catalog, shared catalog designed in

Every song is owned by the user who created it and is invisible to other users.
The schema separates the song entity from the user-song entity, so a shared
canonical catalog can be added later. A shared catalog at launch brings
deduplication, naming variants, and edit permissions, none of which the first
release needs.

### Status and filters plus named lists

The default views are the catalog filtered by status and attributes. Named lists
exist for setlists and other ad hoc groupings. A named list is a join table and
adds little cost.

### Python backend with FastAPI

The backend is Python. The founder is a Python developer with FastAPI and
Litestar experience. Every planned audio feature, such as pitch correction,
tempo change, and melody transcription, lives in the Python audio and machine
learning ecosystem. FastAPI emits an OpenAPI schema, and a generator turns that
schema into TypeScript types for the client. FastAPI was chosen over Litestar for
its larger ecosystem. Nothing in the architecture depends on that choice.

### TypeScript web client with React and Vite

The web client is a single-page application written in TypeScript with React.
A server-rendered Python client was rejected for two reasons. It cannot work
offline, and it shares nothing with a future native client. Flutter was rejected
because its web output renders to a canvas, which harms text selection, links,
and accessibility. React Native from day one was rejected because its web output
is a compromise and the learning load is too high at once. React was chosen over
Svelte for its larger ecosystem and because it keeps both native paths open.

### Capacitor as the planned native path

The path to the app stores wraps the web client with Capacitor, with a
native plugin for background audio. One client codebase serves the web and
both app stores. React Native remains a fallback if a WebView proves
limiting.

### Hosting

- The API runs in a container on Railway.
- The database is Postgres on Neon. Neon suspends compute when idle, bills by
  usage with no monthly minimum, and offers point-in-time recovery and database
  branching on paid plans. Railway Postgres was rejected because it is a
  container with a volume, with snapshot backups and no point-in-time recovery.
  Supabase was rejected because its value is in its bundle of auth, storage, and
  client SDKs, which does not fit an API-first design, and its free tier pauses
  idle projects.
- The Neon database and the Railway container must be in the same region.
- The web client is served by a Cloudflare Worker with static assets. The
  Worker also proxies API calls, so the client is always same-origin and the
  API needs no CORS. Cloudflare labels Pages legacy, and only a Worker can run
  code in front of the assets.
- Audio storage is Cloudflare R2, because it charges no egress and streaming
  recordings is all egress.

### Authentication with Clerk

Users sign in through Clerk with email magic links, Google, and Apple. The API
verifies Clerk JSON Web Tokens. Apple sign-in is required by the App Store when
any other social login is offered. Self-hosted auth was rejected because it puts
password reset, email deliverability, and social login on a solo developer.

### Offline edits with last-write-wins sync

The client caches the full catalog and queues writes made offline. On reconnect,
the client replays the queue. Conflicts resolve by the newest timestamp. Every
record carries a client-generated ID and an updated-at timestamp. Recording
rows ride this queue; their audio moves over presigned storage URLs in a
transfer pass of its own, so a large upload never holds up a sync. A full sync
engine with per-field merges was rejected as more than the first release needs.

## Future features

These are candidates for later releases, in no fixed order.

- Search of streaming catalogs from inside the app
- Shared canonical song catalog with deduplication
- Sharing songs, lists, and recordings between users
- Sheet music and chord charts attached to songs
- Pitch correction of recordings
- Tempo change of recordings without pitch change
- Melody transcription to notation
- Paid access

## Design records

The system architecture, the data model, the API and sync protocol, the client
structure, the tooling, and the testing approach are defined in the first
release architecture spec. Design records live in the project vault under
`specs/`, not in this repository. Run `sessionmemory project --json` to find
the vault paths. The first release spec is
`specs/2026-09-11-crosstune-v1-architecture.md`.

## Glossary

Old-time and bluegrass vocabulary that appears in the product.

- Tune. An instrumental piece with no words. Most of the old-time repertoire.
- Song. A piece with words. In this document, "song" also names the catalog
  entity that covers both tunes and songs.
- Key. The tonal center a player uses for a tune, such as D or A. The same tune
  is played in different keys by different players.
- Mode. The scale flavor, such as major, mixolydian, dorian, or minor. Old-time
  players often say "modal" for any non-major mode.
- Tuning. The string tuning of the instrument, such as standard, cross-tuning
  (AEAE) for fiddle, or double-C for banjo. Many old-time tunes are tied to a
  tuning, and the product name comes from cross-tuning.
- Crooked. A tune with an irregular number of beats or measures in a part.
- Part structure. The order and repeat pattern of a tune's sections, written
  as AABB, AABBCC, or similar.
- Jam. An informal session where musicians play together and learn tunes from
  each other.
