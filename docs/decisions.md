# Crosstune decisions

Each decision below was weighed against alternatives. The reason is recorded so
that a later reader does not reopen a settled question without new information.
Entries are in the order they were made. Add a new entry at the end.

## Song list before recording

The song list with links to existing recordings ships first. Audio recording
ships second. The list is a data and integration problem that the web handles
well. Recording depends on microphone, wake lock, and storage behavior that
only a real phone can confirm.

## Responsive web application first, native apps second

The first client is a responsive web application, installable as a PWA. Audio
recording ships in the responsive web application, proven in the installed
home-screen app on iOS. Native apps follow for app store distribution. The
API is the boundary between the backend and every client, so a native client
plugs in without backend changes.

## Paste a link, no in-app search

A user pastes a URL from a streaming service. Crosstune resolves metadata from
the link and stores it. In-app search of Spotify, Apple Music, and YouTube needs
developer API keys, quotas, and terms of service, and it adds nothing to the data
model. It can be added later.

## Per-user catalog, shared catalog designed in

Every song is owned by the user who created it and is invisible to other users.
The schema separates the song entity from the user-song entity, so a shared
canonical catalog can be added later. A shared catalog at launch brings
deduplication, naming variants, and edit permissions, none of which the first
release needs.

## Status and filters plus named lists

The default views are the catalog filtered by status and attributes. Named lists
exist for setlists and other ad hoc groupings. A named list is a join table and
adds little cost.

## Python backend with FastAPI

The backend is Python. The founder is a Python developer with FastAPI and
Litestar experience. Every planned audio feature, such as pitch correction,
tempo change, and melody transcription, lives in the Python audio and machine
learning ecosystem. FastAPI emits an OpenAPI schema, and a generator turns that
schema into TypeScript types for the client. FastAPI was chosen over Litestar for
its larger ecosystem. Nothing in the architecture depends on that choice.

## TypeScript web client with React and Vite

The web client is a single-page application written in TypeScript with React.
A server-rendered Python client was rejected for two reasons. It cannot work
offline, and it shares nothing with a future native client. Flutter was rejected
because its web output renders to a canvas, which harms text selection, links,
and accessibility. React Native from day one was rejected because its web output
is a compromise and the learning load is too high at once. React was chosen over
Svelte for its larger ecosystem and because it keeps both native paths open.

## Capacitor as the planned native path

The path to the app stores wraps the web client with Capacitor, with a
native plugin for background audio. One client codebase serves the web and
both app stores. React Native remains a fallback if a WebView proves
limiting.

## Hosting

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
- Every R2 object is in Standard storage. Infrequent Access was rejected for
  kept originals because it has no free tier and bills operations rounded up
  to the next million, so one object copied into it costs more in a month than
  Standard storage of every recording. Its lower storage price cannot cover
  that until the originals pass roughly two terabytes.

## Authentication with Clerk

Users sign in through Clerk with email magic links, Google, and Apple. The API
verifies Clerk JSON Web Tokens. Apple sign-in is required by the App Store when
any other social login is offered. Self-hosted auth was rejected because it puts
password reset, email deliverability, and social login on a solo developer.

## Offline edits with last-write-wins sync

The client caches the full catalog and queues writes made offline. On
reconnect, the client replays the queue, and conflicts resolve by the newest
timestamp. Recording audio moves over presigned storage URLs in a transfer
pass of its own, so a large upload never holds up a sync. A full sync engine
with per-field merges was rejected as more than the first release needs.
`architecture.md` describes the protocol.
