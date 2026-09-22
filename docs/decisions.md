# Crosstune decisions

Choices that bind future work, with the alternatives rejected, so nobody
reopens one without new information. Add a new entry at the end.

## Web app first, native later

- A responsive web app, installable as a PWA, is the only client.
- Native apps come later through Capacitor, with a native plugin for
  background audio. React Native is the fallback if a WebView proves
  limiting.
- The API is the boundary. A native client plugs in without backend changes.

## Paste a link, no in-app search

- Users paste a streaming URL and the API resolves its metadata.
- In-app search of Spotify, Apple Music, and YouTube needs developer keys,
  quotas, and terms of service, and adds nothing to the data model.

## Per-user catalog, shared catalog designed in

- Every song is owned by its creator and invisible to others.
- The schema separates the song from the user-song relationship, so a shared
  canonical catalog can be added by a merge step.
- A shared catalog at launch brings deduplication, naming variants, and
  permissions that nobody needs yet.

## Python and FastAPI

- Every planned audio feature (pitch correction, tempo change, transcription)
  lives in Python.
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
- Above 768px a sidebar replaces the tab bar, so a wide screen never shows
  a phone app in a browser.
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

## Clerk for sign-in

- Email magic link, Google, and Apple. Apple is required by the App Store
  when any other social login is offered.
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
