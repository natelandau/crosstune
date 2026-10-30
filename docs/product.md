# Crosstune

<!-- impeccable:product-schema 1 -->

Crosstune is a tune catalog and practice app for musicians who learn by
ear. Each tune holds its status, its recordings, and its links. From that
catalog a musician records, practices, and builds lists, with or without a
network connection.

## Why it exists

Musicians who learn by ear learn from recordings and from other players.
The tools they have do not fit that:

- Tune lists live on paper, sorted by key, with a separate list of tunes to
  learn.
- Recordings of tunes from jams, sessions, and solo playing land in a
  general voice memo app, mixed with everything else and hard to find.
- A musician's own recording of a tune and the streaming versions live in
  different apps.
- Slowing a recording down, shifting its pitch, and looping the hard part
  need yet another app.
- Set lists and practice lists live on paper or in a notes app, apart from
  the recordings.

## Who it is for

- Musicians who learn by ear, in old-time, bluegrass, Irish, klezmer, and
  other folk traditions. They play alone, in small sessions, and at large
  jams.
- Success is musicians using Crosstune as their one place for tunes,
  recordings, and practice, in place of paper lists and voice memo apps, and
  other players asking for an account.

## Use cases

The catalog is the hub. Every other use case starts from a tune in it, and
none of them outranks the others.

- Keep track of tunes. Each tune is known, learning, or want to learn. The
  catalog answers what a musician can play and what to learn next.
- Record. Capture one tune at a time, as it is played at a jam, in a small
  session, or by one musician alone. File the recording under a tune, or
  leave it unfiled for later. Split a long recording into one recording
  per tune.
- Learn and practice by ear. Play a recording slower or faster, shift its
  pitch, and loop the hard part. Find and link other versions on streaming
  services.
- Keep lists. Ordered, named lists for a set list, a practice plan, a
  playlist, or any grouping a musician wants.

Jams are one important setting among several. At a jam, a musician filters
the catalog by key, taps a tune, and hears how it goes. That path stays
fast. No feature assumes that the musician is at a jam.

## What it promises

- A native app for iPhone, iPad, and Mac, and an installable web app for
  Android and every browser.
- Each catalog is private to its owner.
- The full catalog lives on the device. Reads and writes work offline and
  sync when a connection returns. Search of other services needs a
  connection.
- Paste accepts a link from any site. In-app search covers only the
  services whose APIs allow it (`architecture.md`, Links and playback).
- Tuning fields and filters appear only for the instruments the musician
  plays.
- A setting syncs unless it describes the device: appearance, text size,
  recording channels, and sort choices stay per device.
- Export (one zip of tunes, lists, recordings, and scans) and import work
  on any plan.

## Plans

- Free: the catalog, lists, links, sync, offline, the tuner, import, and
  export.
- Premium: recordings, scans, and 3 GB of storage for both. One
  subscription for every device, the same price on the web and in the App
  Store.
- Every new account starts with a 30-day Premium trial, with 100 MB of
  storage.
- A lapsed account cannot play its recordings or open its scans, but keeps
  every file until it goes a year without syncing. It then loses its
  recordings and scans, after two warning emails.

## Designed for, not built

Each has a place in the data model and no code:

- A shared canonical catalog across users, with deduplication
- Sharing tunes, lists, and recordings between users
- Melody transcription

## Constraints for every release

- Phone first. A screen used with an instrument in hand works one-handed
  and in poor light. A recording of any tune is at most two taps from the
  catalog.
- Offline. The catalog is readable and editable with no signal.
- API first. The backend never depends on a client. The Apple app and the
  web client use the same endpoints.
- Private now, shared later. The schema separates a tune from a user's
  relationship to it, so a shared catalog is a merge step, not a rewrite.
- Musical facets live on the tune (key, mode, tuning, part structure). The
  user's record holds only the relationship: status, learned from, when,
  notes.
- No invented proof. No testimonial, review, press quote, or user count in
  any copy until a real one exists.

## Platform

adaptive

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
| Jam            | An informal gathering where musicians play tunes together and learn from each other, large or small. Irish players call it a session.                                        |
| Scan           | One image attached to a tune: written music, a lyric sheet, or handwritten notes. Never notation, which names only the first.                                                |
