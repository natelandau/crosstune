# Crosstune

Crosstune is a tune catalog for folk musicians. A musician keeps the tunes
they know and the tunes they want to learn, and reaches a recording of any
tune in two taps, with or without a network connection.

## Why it exists

Folk musicians learn by ear, from other players at jams and from recordings.
The tools they have do not fit that:

- Jam recordings land in a general voice memo app, mixed with everything else
  and hard to find.
- Tune lists live on paper, sorted by key, with a separate list of tunes to
  learn.
- A musician's own recording of a tune and the streaming versions live in
  different apps.
- At a jam, a musician needs the list of tunes they know and a fast reminder
  of how each one goes.

## Who it is for

- Folk musicians of any tradition who attend jams and want a better tool
  than paper.
- Free at launch. Paid access comes later, so accounts and data must support
  billing without a rewrite.
- Success is the founder using it at a jam instead of a paper list, and
  other players asking for an account.

## The core loop

1. Add a tune with its key, tuning, and other attributes.
2. Mark it known, learning, or want to learn.
3. Paste links to recordings of it, or record it.
4. At the jam, filter the catalog by key, tap the tune, hear it.

Everything else supports this loop.

## What it does

An installable web app (PWA). The parts that matter:

- Accounts. Sign in with an email magic link, Google, or Apple. Each
  catalog is private to its owner.
- Catalog. Tunes with musical attributes (key, mode for each part, tunings,
  genre, type, time signature, part structure, composer), lyrics, where and
  when they were learned, notes, and a status. Tunes can be archived.
- Lists. Ordered, named lists such as a setlist. A tune can be in many.
- Links. Paste a URL from YouTube, Spotify, Apple Music, TIDAL, Bandcamp,
  SoundCloud, the Internet Archive, or any site. The app resolves title and
  artwork. Supported providers play in an in-app dock; every link also opens
  the provider.
- Recordings. Record with the phone's microphone or upload audio. A
  recording is filed under a tune or waits unfiled. It plays at once, uploads
  in the background, and reaches the musician's other devices. Free accounts
  hold 1 GB.
- Lyrics. A full-screen reading view that keeps the screen awake.
- Browse. The catalog filtered by status and attributes, with text search.
  Filters persist.
- Instruments. The musician records which instruments they play, from
  those with a per-tune tuning. Tuning fields and filters appear only for
  those.
- Appearance. Light, dark, or system, and three text sizes. Per device.
- Offline. The full catalog is on the device. Reads and writes work offline
  and sync when a connection returns.

## Designed for, not built

Each has a place in the data model and no code:

- Search of streaming catalogs from inside the app
- A shared canonical catalog across users, with deduplication
- Sharing tunes, lists, and recordings between users
- Sheet music and chord charts
- Audio tools: pitch correction, tempo change, melody transcription
- Paid access

## Constraints for every release

- Phone first. The jam-night screen works one-handed, in poor light, in
  under two taps.
- Offline. The catalog is readable and editable with no signal.
- API first. The backend never depends on the web client. Native apps come
  later for app store distribution and background audio.
- Private now, shared later. The schema separates a tune from a user's
  relationship to it, so a shared catalog is a merge step, not a rewrite.
- Musical facets live on the tune (key, mode, tuning, part structure). The
  user's record holds only the relationship: status, learned from, when,
  notes.
- Vanilla Postgres. No vendor extensions, so the database host changes with
  a connection string.

## Glossary

Two naming rules hold in the schema, the API, and every label: tune, never
song, and violin, never fiddle. Each is the word a player of any folk
tradition, and a non-native English speaker, understands first. Tune is what
Irish, old-time, bluegrass, klezmer, and jazz players call a piece they play,
with or without words. Irish, old-time, and bluegrass players say fiddle;
klezmer, Romani, and classical players say violin, and every player
understands it. Tuning values keep their traditional names.

| Term           | Meaning                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tune           | The catalog entity: a piece a musician plays, with or without words. A sung piece is a tune of type Song.                                                                    |
| Key            | The tonal center, such as D or A. Different players use different keys for one tune.                                                                                         |
| Mode           | The scale flavor: major, minor, mixolydian, dorian, or modal, a tune between minor and mixolydian. A tune can change mode between parts.                                     |
| Type           | The tune's form, such as reel, jig, slip jig, breakdown, or waltz. It usually fixes the time signature.                                                                      |
| Tuning         | The string tuning and capo for one instrument on a tune: cross-tuning (AEAE) on violin, double C on 5-string banjo, DADGAD capo 2 on guitar. The product name comes from it. |
| Crooked        | A tune with an irregular number of beats or measures in a part.                                                                                                              |
| Part structure | The order and repeats of a tune's sections: AABB, AABBCC.                                                                                                                    |
| Status         | Known, learning, or want to learn. Want to learn is labeled "Unknown".                                                                                                       |
| Jam            | An informal session where musicians play together and learn tunes from each other.                                                                                           |
