// The sample catalog the demos show: real old-time and Irish tunes with their usual keys.
import type { Tune } from './atoms'

export const TUNES: Tune[] = [
  { t: 'Ashokan Farewell', k: 'D', s: 'learning' },
  { t: 'Backstep Cindy', k: 'D', s: 'known' },
  { t: 'Bibb County Hoedown', k: 'A', s: 'known' },
  { t: "Bonaparte's Retreat", k: 'D', s: 'unknown', tu: 'Violin: DDAD' },
  { t: 'Cluck Old Hen', k: 'A', s: 'known', tu: 'Violin: AEAE' },
  { t: "Elzic's Farewell", k: 'A', m: 'dor', s: 'learning', tu: 'Violin: AEAE' },
  { t: 'Forked Deer', k: 'D', s: 'known' },
  { t: 'Kesh Jig', k: 'G', s: 'known' },
  { t: 'Lost Indian', k: 'A', m: 'mix', s: 'learning' },
  { t: 'Midnight on the Water', k: 'D', s: 'known', tu: 'Violin: DDAD' },
  { t: 'Over the Waterfall', k: 'D', s: 'known' },
  { t: 'Red Haired Boy', k: 'A', m: 'mix', s: 'learning' },
  { t: 'Sail Away Ladies', k: 'D', s: 'learning' },
  { t: 'Salt Creek', k: 'A', s: 'known' },
  { t: "Soldier's Joy", k: 'D', s: 'known' },
  { t: 'Westphalia Waltz', k: 'G', s: 'unknown' },
  { t: 'Whiskey Before Breakfast', k: 'D', s: 'known' },
]

/** The Learning list: the catalog's learning tunes plus a few more. */
export const LEARN: Tune[] = TUNES.filter((t) => t.s === 'learning')
  .concat([
    { t: 'Swallowtail Jig', k: 'E', m: 'min', s: 'learning' },
    { t: "Tobin's Jig", k: 'D', s: 'learning' },
    { t: 'Ducks on the Millpond', k: 'A', s: 'learning', tu: 'Violin: AEAE' },
    { t: 'Lilting Banshee', k: 'A', m: 'dor', s: 'learning' },
  ])
  .sort((a, b) => a.t.localeCompare(b.t))

/** The phone catalog a search for "jig" narrows. */
export const JIGS: Tune[] = [
  { t: 'Ashokan Farewell', k: 'D', s: 'learning' },
  { t: 'Cliffs of Moher', k: 'A', m: 'dor', s: 'unknown' },
  { t: 'Forked Deer', k: 'D', s: 'known' },
  { t: 'Kesh Jig', k: 'G', s: 'known' },
  { t: 'Lilting Banshee', k: 'A', m: 'dor', s: 'learning' },
  { t: "Morrison's Jig", k: 'E', m: 'min', s: 'unknown' },
  { t: 'Out on the Ocean', k: 'G', s: 'known' },
  { t: 'Salt Creek', k: 'A', s: 'known' },
  { t: "Soldier's Joy", k: 'D', s: 'known' },
  { t: 'Swallowtail Jig', k: 'E', m: 'min', s: 'learning' },
  { t: "Tobin's Jig", k: 'D', s: 'learning' },
  { t: 'Westphalia Waltz', k: 'G', s: 'unknown' },
]

/** Every sample tune by title. */
export const BY_TITLE: Record<string, Tune> = Object.fromEntries(
  TUNES.concat(JIGS).map((t) => [t.t, t]),
)
