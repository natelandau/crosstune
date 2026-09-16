# Crosstune product brief

Crosstune is a song catalog for folk musicians. A musician keeps a list of
the songs they know and the songs they want to learn. From any song, the
musician can reach a recording of it in two taps, with or without a network
connection.

This document records what the product is, who it is for, what the first
release contains, and the constraints that hold for every release. Read it
before you design or build any part of the system. The reasons behind the
stack are in `decisions.md`.

## The problem

Folk musicians, whether they play old-time, bluegrass, Irish, Eastern
European, or another tradition, learn most of their repertoire by ear, from
other musicians at jam sessions and from recordings. The tools they use today
do not fit that workflow.

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

The first users are folk musicians who attend jams and want a better tool
than paper. Crosstune is a community product. It is free at launch.
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
- Appearance. Settings offers light, dark, or the system setting, which
  follows the phone when it switches, and a text size of compact, regular, or
  roomy. Both are per device and need no account.
- Offline. The full catalog is cached on the device. Reads and writes work
  without a connection. Writes sync when the connection returns.
- Recordings. A user records with the phone's microphone or uploads an audio
  file. A recording is added to a song or waits unfiled in the Recordings tab.
  It plays at once on the device that made it and uploads in the background.
  It reaches the user's other devices when someone plays it, or ahead of time
  on any device where Download all recordings to this device is turned on in
  Settings. A free account stores 1 GB of recordings.

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

## Glossary

Vocabulary that appears in the product. Two naming rules hold everywhere,
in the schema, the API, and every label. Song is the only word for a catalog
entry. Instruments carry their formal names, violin and never fiddle,
because the product serves many traditions and schema names are expensive
to change. Tuning values keep their traditional names, such as Cross A
(AEAE), because those are the names players use.

- Song. The catalog entity. It covers a piece with words and an instrumental
  piece with no words, which players call a tune.
- Key. The tonal center a player uses for a tune, such as D or A. The same tune
  is played in different keys by different players.
- Mode. The scale flavor, such as major, mixolydian, dorian, or minor. Many
  players say "modal" for any non-major mode.
- Tuning. The string tuning of the instrument, such as standard, cross-tuning
  (AEAE) for violin, or double-C for banjo. Many tunes are tied to a tuning,
  and the product name comes from cross-tuning.
- Crooked. A tune with an irregular number of beats or measures in a part.
- Part structure. The order and repeat pattern of a tune's sections, written
  as AABB, AABBCC, or similar.
- Jam. An informal session where musicians play together and learn tunes from
  each other.
