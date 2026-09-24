import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../api/vocabulary'
import { tuneRow as tune, userTuneRow as userTune } from '../../test/rows'
import {
  catalogEntries,
  DEFAULT_FILTERS,
  FACET_LABELS,
  FACETS,
  facetValues,
  filterCatalog,
  hiddenResets,
  hideArchived,
  normalizeFilters,
  tuneCountLabel,
  visibleFacets,
} from './filters'

const tunes = [
  tune('s1', "soldier's joy", {
    key: 'D',
    mode: 'major',
    tunings: { violin: { tuning: 'ADAE' }, five_string_banjo: { tuning: 'gDGBD' } },
    genre: 'Old-time',
  }),
  tune('s2', 'Cluck Old Hen', { key: 'A', mode: 'mixolydian', alternate_titles: ['Cluck'] }),
  tune('s3', 'Deleted', { deleted_at: 't' }),
  tune('s4', 'Angeline the Baker', { key: 'D' }),
  tune('s5', 'Orphan', { key: 'G' }),
]
const userTunes = [
  userTune('u1', 's1'),
  userTune('u2', 's2', { status: 'learning' }),
  userTune('u3', 's3'),
  userTune('u4', 's4', { status: 'want_to_learn', archived_at: 't' }),
]

describe('catalogEntries', () => {
  it('joins active pairs and sorts by title ignoring case', () => {
    const entries = catalogEntries(tunes, userTunes)
    expect(entries.map((e) => e.tune.id)).toEqual(['s4', 's2', 's1'])
  })
})

describe('hideArchived', () => {
  const entries = catalogEntries(tunes, userTunes)

  it('drops archived entries unless shown', () => {
    expect(hideArchived(entries, false).map((e) => e.tune.id)).toEqual(['s2', 's1'])
    expect(hideArchived(entries, true)).toBe(entries)
  })

  it('keeps the extra fields of a wider entry', () => {
    const wide = entries.map((entry, index) => ({ ...entry, index }))
    expect(hideArchived(wide, false).map((e) => e.index)).toEqual([1, 2])
  })
})

describe('filterCatalog', () => {
  const entries = catalogEntries(tunes, userTunes)

  it('hides archived tunes unless asked', () => {
    expect(filterCatalog(entries, DEFAULT_FILTERS).map((e) => e.tune.id)).toEqual(['s2', 's1'])
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, archived: true }).map((e) => e.tune.id),
    ).toEqual(['s4', 's2', 's1'])
  })

  it('matches the query against titles and alternate titles', () => {
    expect(filterCatalog(entries, DEFAULT_FILTERS, 'SOLD').map((e) => e.tune.id)).toEqual(['s1'])
    expect(filterCatalog(entries, DEFAULT_FILTERS, 'cluck').map((e) => e.tune.id)).toEqual(['s2'])
  })

  it('keeps a title that matches the query exactly apart from accents', () => {
    const accented = catalogEntries([tune('s6', 'Été Waltz')], [userTune('u6', 's6')])
    expect(filterCatalog(accented, DEFAULT_FILTERS, 'ete waltz').map((e) => e.tune.id)).toEqual([
      's6',
    ])
  })

  it('filters by status and facets', () => {
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, status: 'learning' }).map((e) => e.tune.id),
    ).toEqual(['s2'])
    expect(filterCatalog(entries, { ...DEFAULT_FILTERS, key: 'D' }).map((e) => e.tune.id)).toEqual([
      's1',
    ])
    expect(
      filterCatalog(entries, {
        ...DEFAULT_FILTERS,
        mode: 'mixolydian',
        'tuning:violin': 'all',
      }).map((e) => e.tune.id),
    ).toEqual(['s2'])
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, genre: 'Old-time' }).map((e) => e.tune.id),
    ).toEqual(['s1'])
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, 'tuning:violin': 'ADAE' }).map((e) => e.tune.id),
    ).toEqual(['s1'])
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, 'tuning:five_string_banjo': 'gCGCD' }).map(
        (e) => e.tune.id,
      ),
    ).toEqual([])
  })
})

describe('facetValues', () => {
  it('lists distinct sorted values across all entries, archived included', () => {
    const facets = facetValues(catalogEntries(tunes, userTunes))
    expect(facets.key).toEqual(['A', 'D'])
    expect(facets.mode).toEqual(['major', 'mixolydian'])
    expect(facets['tuning:violin']).toEqual(['ADAE'])
    expect(facets['tuning:five_string_banjo']).toEqual(['gDGBD'])
    expect(facets.genre).toEqual(['Old-time'])
  })

  it('folds spellings that differ only by case into one option', () => {
    const entries = catalogEntries(
      [
        tune('s1', 'A', { key: 'D', genre: 'old-time' }),
        tune('s2', 'B', { key: 'd', genre: 'Old-Time' }),
      ],
      [userTune('u1', 's1'), userTune('u2', 's2')],
    )
    const facets = facetValues(entries)
    expect(facets.key).toEqual(['D'])
    expect(facets.genre).toEqual(['old-time'])
    expect(filterCatalog(entries, { ...DEFAULT_FILTERS, key: 'D' })).toHaveLength(2)
  })
})

describe('normalizeFilters', () => {
  it('fills defaults for missing or malformed stored values', () => {
    expect(normalizeFilters(null)).toEqual(DEFAULT_FILTERS)
    expect(normalizeFilters({ status: 'bogus', archived: 'yes' })).toEqual(DEFAULT_FILTERS)
    expect(normalizeFilters({ key: 'A', archived: true }).key).toBe('A')
  })

  it('drops a search query stored by an earlier build', () => {
    expect('query' in normalizeFilters({ query: 'soldier', key: 'D' })).toBe(false)
  })

  it('reads a filter stored under a retired tuning key as Any', () => {
    const filters = normalizeFilters({
      tuning: 'AEAE',
      violin_tuning: 'ADAE',
      banjo_tuning: 'gDGBD',
    })
    expect(filters['tuning:violin']).toBe('all')
    expect(filters['tuning:five_string_banjo']).toBe('all')
    for (const key of ['tuning', 'violin_tuning', 'banjo_tuning']) {
      expect(key in filters).toBe(false)
    }
  })
})

describe('visibleFacets', () => {
  const facets = facetValues(catalogEntries(tunes, userTunes))

  it('offers a facet only when it has values and its instrument is played', () => {
    expect(visibleFacets(facets, new Set<Instrument>(['violin']))).toEqual([
      'key',
      'mode',
      'tuning:violin',
      'genre',
    ])
    expect(visibleFacets(facets, new Set<Instrument>(['five_string_banjo']))).toEqual([
      'key',
      'mode',
      'tuning:five_string_banjo',
      'genre',
    ])
    expect(
      visibleFacets({ ...facets, genre: [] }, new Set<Instrument>(['violin', 'five_string_banjo'])),
    ).toEqual(['key', 'mode', 'tuning:violin', 'tuning:five_string_banjo'])
  })

  it('names the counts the same way wherever they are shown', () => {
    expect(tuneCountLabel(84, 84)).toBe('84 tunes')
    expect(tuneCountLabel(11, 84)).toBe('11 of 84 tunes')
    expect(tuneCountLabel(1, 84)).toBe('1 of 84 tunes')
    expect(tuneCountLabel(1, 1)).toBe('1 tune')
    expect(tuneCountLabel(0, 0)).toBe('0 tunes')
  })

  it('builds a reset patch for hidden facets only', () => {
    expect(hiddenResets(['key', 'mode', 'tuning:violin', 'genre'])).toEqual({
      'tuning:five_string_banjo': 'all',
      'tuning:tenor_banjo': 'all',
      'tuning:guitar': 'all',
      'tuning:mandolin': 'all',
      'tuning:bouzouki': 'all',
      'tuning:mountain_dulcimer': 'all',
    })
    expect(hiddenResets([...FACETS])).toEqual({})
  })
})

describe('tuning facets', () => {
  it('filters by one instrument’s tuning and ignores its capo', () => {
    const entries = catalogEntries(
      [
        tune('g1', 'Guitar', { tunings: { guitar: { tuning: 'DADGAD', capo: 2 } } }),
        tune('g2', 'Capo only', { tunings: { guitar: { capo: 2 } } }),
      ],
      [userTune('u1', 'g1'), userTune('u2', 'g2')],
    )
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, 'tuning:guitar': 'DADGAD' }).map(
        (e) => e.tune.id,
      ),
    ).toEqual(['g1'])
    expect(facetValues(entries)['tuning:guitar']).toEqual(['DADGAD'])
  })

  it('offers a tuning facet only for a played instrument with values', () => {
    const values = facetValues(
      catalogEntries(
        [tune('g1', 'Guitar', { tunings: { guitar: { tuning: 'DADGAD' } } })],
        [userTune('u1', 'g1')],
      ),
    )
    expect(visibleFacets(values, new Set<Instrument>(['violin']))).not.toContain('tuning:guitar')
    expect(visibleFacets(values, new Set<Instrument>(['guitar']))).toContain('tuning:guitar')
  })

  it('labels a tuning facet by its instrument', () => {
    expect(FACET_LABELS['tuning:tenor_banjo']).toBe('Tenor banjo tuning')
  })
})
