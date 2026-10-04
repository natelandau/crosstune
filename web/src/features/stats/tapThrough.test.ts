import { describe, expect, test } from 'vitest'
import { tuneRow, userTuneRow } from '../../test/rows'
import {
  catalogEntries,
  DEFAULT_FILTERS,
  filterCatalog,
  isFilterValue,
  type CatalogFilters,
  type Facet,
} from '../catalog/filters'
import { tuningKey } from '../settings/instruments'
import { breakdowns } from './breakdowns'

// Spellings that differ by case, accents, normalization form, and outer whitespace, so every
// breakdown group gathers several of them.
const GENRES = ['Irish', 'irish', ' Írish ', 'ÍRISH', 'Old-time', 'old-time ', 'Cajun']
const TYPES = ['Reel', 'reel', 'REEL ', 'Jig', 'jig', 'Slip jig', 'Waltz', 'waltz']
const KEYS = ['D', 'd', ' D', 'G', 'g', 'A', 'Bb', 'bb']
const MODES = ['major', 'Major', 'MAJOR ', 'dorian', 'Dorian', 'mixolydian', 'Mixólydian']
const TUNINGS = ['GDAE', 'gdae', ' GDAE', 'AEAE', 'aeae', 'Calico (AEAC#)']

const tunes = Array.from({ length: 40 }, (_, i) =>
  tuneRow(`t${i}`, `Tune ${i}`, {
    genre: GENRES[i % GENRES.length],
    tune_type: TYPES[(i * 3) % TYPES.length],
    key: KEYS[(i * 5) % KEYS.length],
    modes: [MODES[i % MODES.length]!, MODES[(i * 2 + 1) % MODES.length]!],
    tunings: { violin: { tuning: TUNINGS[(i * 7) % TUNINGS.length] } },
  }),
)
const userTunes = tunes.map((tune) => userTuneRow(`u-${tune.id}`, tune.id))
const entries = catalogEntries(tunes, userTunes)
const stats = breakdowns(
  tunes.map((tune, i) => ({ tune, userTune: userTunes[i]! })),
  ['violin'],
)

function shown(patch: Partial<CatalogFilters>): number {
  return filterCatalog(entries, { ...DEFAULT_FILTERS, ...patch }).length
}

const facetValues: [Facet, { value: string; count: number }][] = [
  ...stats.tune_type.map((value) => ['tune_type', value] as [Facet, typeof value]),
  ...stats.genre.map((value) => ['genre', value] as [Facet, typeof value]),
  ...stats.tunings.flatMap(({ instrument, values }) =>
    values.map((value) => [tuningKey(instrument as 'violin'), value] as [Facet, typeof value]),
  ),
]

describe('every stats value opens exactly the tunes it counted', () => {
  test.each(facetValues)('%s %o', (facet, { value, count }) => {
    expect(isFilterValue(facet, value)).toBe(true)
    expect(shown({ [facet]: value })).toBe(count)
  })

  test.each(stats.key.map((row) => [row.key, row]))('key %s and its modes', (_key, row) => {
    expect(shown({ key: row.key })).toBe(row.count)
    for (const { value, count } of row.modes)
      expect(shown({ key: row.key, mode: value })).toBe(count)
  })
})
