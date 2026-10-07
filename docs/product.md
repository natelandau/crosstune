# Crosstune

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
- Free at launch. Paid access comes later, so accounts and data must support
  billing without a rewrite.
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
  leave it unfiled for later.
- Learn and practice by ear. Play a recording slower or faster, shift its
  pitch, and loop the hard part. Find and link other versions on streaming
  services.
- Keep lists. Ordered, named lists for a set list, a practice plan, a
  playlist, or any grouping a musician wants.

Jams are one important setting among several. At a jam, a musician filters
the catalog by key, taps a tune, and hears how it goes. That path stays
fast. No feature assumes that the musician is at a jam.

## What it does

A native app for iPhone, iPad, and Mac, and an installable web app (PWA)
for Android and every browser. The parts that matter:

- Accounts. Sign in with an emailed code, Google, or Apple. Each
  catalog is private to its owner.
- Catalog. Tunes with musical attributes (key, mode for each part, tunings,
  genre, type, time signature, part structure, composer), lyrics, where and
  when they were learned, notes, and a status. Tunes can be archived.
- Lists. Ordered, named lists such as a set list. A tune can be in many.
  Each tune plays from its row: the recording or link the musician pinned,
  or else the one the Play first setting picks. The Apple app also plays a
  list as a playlist of recordings and full Apple Music tracks, with
  shuffle and repeat, and next and previous on the lock screen.
- Links. Paste a URL from YouTube, Spotify, Apple Music, TIDAL, Bandcamp,
  SoundCloud, the Internet Archive, Slippery-Hill, or any site. The app
  resolves title and artwork. Supported providers play in an in-app dock;
  every link also opens the provider. On iPhone, iPad, and Mac, an Apple
  Music subscriber hears Apple Music tracks and albums in full. Everyone
  else hears the preview.
- Find recordings. From a tune, pick one of the musician's chosen services
  and search it. Apple Music, TIDAL, and Internet Archive results play in
  place and link with one tap. YouTube, Spotify, Bandcamp, SoundCloud, and
  Slippery-Hill open their own search page. With one service chosen, the
  tune goes straight to it. Search needs a connection.
- Recordings. Record with the phone's microphone, upload audio, or save the
  audio of a Slippery-Hill link. A recording is filed under a tune or waits
  unfiled, and keeps where it came from, when it was added, and, when known,
  when it was recorded. A take or an uploaded file plays at once and uploads
  in the background. Saved link audio is fetched by the server and plays once
  it is ready. Every recording reaches the musician's other devices. A
  recording can be trimmed for good, and plays at a slower or faster speed
  and a shifted pitch on every device. A recording keeps labeled practice
  loops that repeat. Free accounts hold 50 MB and Premium accounts 5 GB.
- Lyrics. A full-screen reading view that keeps the screen awake.
- Browse. The catalog filtered by status and attributes, with text search.
  Filters persist.
- Instruments. The musician records which instruments they play, from
  those with a per-tune tuning. Tuning fields and filters appear only for
  those.
- Music services. The musician chooses which services Find recordings
  offers. Every service starts chosen. The choice syncs like every setting.
- Appearance. Light, dark, or system, and a text size: three sizes on the
  web, the device's size shifted up or down on Apple. Per device.
- Scans. Images attached to a tune: written music, a lyric sheet, or
  handwritten notes. Scan them on iPhone and iPad, or add an image from a
  file on Mac and the web. View, reorder, and delete them on every device.
  Every scan downloads to every device and counts toward the same storage
  as recordings.
- Offline. The full catalog is on the device. Reads and writes work offline
  and sync when a connection returns.
- Export. One zip from Settings: tunes and lists as spreadsheets, plus the
  recordings and scans on the device.
- Stats. A page from Settings counts the catalog and its recordings, shows
  when the musician added and played, and finds rarities and anniversaries.
  It shows only the attributes the musician uses.

## Designed for, not built

Each has a place in the data model and no code:

- A shared canonical catalog across users, with deduplication
- Sharing tunes, lists, and recordings between users
- Chord charts
- Melody transcription
- Paid access

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
| Jam            | An informal gathering where musicians play tunes together and learn from each other, large or small. Irish players call it a session.                                        |
| Scan           | One image attached to a tune: written music, a lyric sheet, or handwritten notes. Never notation, which names only the first.                                                |
