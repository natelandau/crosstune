# Stats fixtures

Each file is one case for the stats module on every client
(`web/src/features/stats/computeStats.ts` and its Swift port). `input` is a
`StatsInput`: `today` as a local `YYYY-MM-DD`, the device `time_zone`, the
musician's `instruments`, and the local rows of `tunes`, `user_tunes`,
`recordings`, `recording_links`, `lists`, `scans`, `scan_views`,
`play_events`, `practice_sessions`, and `status_changes`. Every list is
present in every case, as `[]` when empty. Rows use the wire field names.
A row may carry a field stats never reads, and a null field may be
written as `null` or left out; a client reads both spellings the same.
`expected` is the whole `Stats` the module returns for that input, and a
client passes a case only when its output equals it exactly.

Rules the cases pin where the spec leaves a choice:

- A tune is a live user-tune joined to a live tune. Counts, breakdowns,
  rarities, and the equivalence's tune skip archived tunes; months, the
  heatmap, and on this day are history and keep them.
- `counts.scans` counts live scans whose tune is a current tune: neither
  deleted nor archived, with a live user-tune. `counts.scan_tunes` counts
  the distinct tunes holding them.
- A heatmap day's `scan_views` counts the views that started that local
  day, whatever the state of the tune viewed. Scan views add no music.
- A status change counts on the heatmap only with a `from_status`. A
  user-tune's first row is its creation, already counted as a tune added.
- A day with any count above zero is active; an active day with no music
  is level 1.
- The equivalence's tune counts only recordings longer than zero after
  trimming, and names no tune when none has one. With no entry that fits
  the total, the equivalence is null.
- A key row counts the tunes in that key. Its mode values count each tune
  under every mode it holds in any part, once per mode, skipping blank
  modes, so the modes can sum to more than the row. The
  key and mode rarity still reads only the first part's mode.
- Text sorts and ties by plain code points, never a locale collator.
- Breakdowns and rarities group values the way the catalog filter matches
  them, by the fold in `fixtures/text/README.md`, so case, accents, NFC
  against NFD, and outer whitespace never split a group, and tapping a
  value opens exactly the tunes it counted. A value whose fold key is
  empty, such as whitespace or combining marks alone, joins no group.
  A group shows its most common trimmed spelling, ties to the first in
  code point order, and rows order by that spelling. Rarities count
  groups, so a value another tune holds in another case is not rare.
- The key grid spells each mode one way in every key: the vocabulary's
  spelling when the mode folds to a known mode, otherwise the spelling
  most tunes use for it across the whole catalog.
- On this day names tunes by tune ID and recordings by recording ID. A
  February 29 anchor shows on February 28 only in a year with no February
  29.
