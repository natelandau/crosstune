import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../api/vocabulary'
import { tuneRow as tune, userTuneRow as userTune } from '../../test/rows'
import {
  catalogEntries,
  type CatalogFilters,
  DEFAULT_FILTERS,
  FACET_LABELS,
  FACETS,
  facetValues,
  filterCatalog,
  hiddenResets,
  hideArchived,
  isFilterValue,
  titleMatches,
  missingChoices,
  sheetFilterCount,
  sheetResets,
  NO_KEY,
  normalizeFilters,
  sheetFacets,
  tuneCountLabel,
  visibleFacets,
} from './filters'

const tunes = [
  tune('s1', "soldier's joy", {
    key: 'D',
    modes: ['major'],
    tunings: { violin: { tuning: 'ADAE' }, five_string_banjo: { tuning: 'gDGBD' } },
    genre: 'Old-time',
  }),
  tune('s2', 'Cluck Old Hen', { key: 'A', modes: ['mixolydian'], alternate_titles: ['Cluck'] }),
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

  it('matches part of a title ignoring accents', () => {
    const accented = catalogEntries([tune('s6', 'Été Waltz')], [userTune('u6', 's6')])
    expect(filterCatalog(accented, DEFAULT_FILTERS, 'ete w').map((e) => e.tune.id)).toEqual(['s6'])
  })

  it('matches a facet value the shared fold calls the same', () => {
    const spelled = catalogEntries(
      [tune('s7', 'A', { genre: ' Fe\u0302te ' }), tune('s8', 'B', { genre: 'Fete Noire' })],
      [userTune('u7', 's7'), userTune('u8', 's8')],
    )
    expect(
      filterCatalog(spelled, { ...DEFAULT_FILTERS, genre: 'F\u00eaTE' }).map((e) => e.tune.id),
    ).toEqual(['s7'])
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

describe('blank and sentinel values', () => {
  const entries = catalogEntries(
    [
      tune('b1', 'A', { key: 'None', genre: '\u0300' }),
      tune('b2', 'B', { key: 'D', genre: '  ' }),
      tune('b3', 'C', { key: 'G', genre: 'All' }),
    ],
    [userTune('ub1', 'b1'), userTune('ub2', 'b2'), userTune('ub3', 'b3')],
  )

  it('offers no option a stored filter would read as Any or No key, or the fold calls blank', () => {
    const facets = facetValues(entries)
    expect(facets.key).toEqual(['D', 'G'])
    expect(facets.genre).toEqual([])
  })

  it('reads a value that folds to nothing as missing and matches no filter with it', () => {
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, missing: 'genre' }).map((e) => e.tune.id),
    ).toEqual(['b1', 'b2'])
    expect(filterCatalog(entries, { ...DEFAULT_FILTERS, genre: '\u0301' })).toEqual([])
  })

  it('never calls a query the fold calls blank a title match', () => {
    expect(titleMatches(tune('m1', '\u0301'), '\u0300')).toBe(false)
  })

  it('tells which values can be a filter', () => {
    expect(isFilterValue('genre', 'Irish')).toBe(true)
    expect(isFilterValue('genre', ' ALL ')).toBe(false)
    expect(isFilterValue('genre', '\u0300')).toBe(false)
    expect(isFilterValue('genre', 'None')).toBe(true)
    expect(isFilterValue('key', 'n\u00f3ne')).toBe(false)
  })
})

describe('part modes', () => {
  const kesh = catalogEntries(
    [tune('k1', 'The Kesh', { modes: ['major', 'mixolydian'] }), tune('k2', 'Sally Ann')],
    [userTune('ku1', 'k1'), userTune('ku2', 'k2')],
  )

  it('matches a mode held by any part', () => {
    const found = filterCatalog(kesh, { ...DEFAULT_FILTERS, mode: 'mixolydian' })
    expect(found.map((e) => e.tune.id)).toEqual(['k1'])
  })

  it('keeps a tune with no mode while no mode is chosen', () => {
    expect(filterCatalog(kesh, DEFAULT_FILTERS)).toHaveLength(2)
  })

  it('offers each part mode as a mode value', () => {
    expect(facetValues(kesh).mode).toEqual(['major', 'mixolydian'])
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
      tune_type: 'all',
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

describe('type and composer', () => {
  const entries = catalogEntries(
    [
      tune('r1', 'The Silver Spear', { tune_type: 'reel' }),
      tune('r2', 'Lucy Farr', { composer: 'Ed Reavy', tune_type: 'Barndance' }),
    ],
    [userTune('ru1', 'r1'), userTune('ru2', 'r2')],
  )

  it('matches a type ignoring case', () => {
    const found = filterCatalog(entries, { ...DEFAULT_FILTERS, tune_type: 'Reel' })
    expect(found.map((e) => e.tune.id)).toEqual(['r1'])
  })

  it('finds a tune by its composer', () => {
    expect(filterCatalog(entries, DEFAULT_FILTERS, 'reavy').map((e) => e.tune.id)).toEqual(['r2'])
  })

  it('reads a stored filter from before Type as every type', () => {
    expect(normalizeFilters({ key: 'D' }).tune_type).toBe('all')
  })

  it('keeps Type on the bar, not in the sheet', () => {
    expect(sheetFacets(['key', 'tune_type', 'genre'])).toEqual(['genre'])
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

describe('tunes with no key', () => {
  const entries = catalogEntries(
    [
      tune('n1', 'Keyed', { key: 'D' }),
      tune('n2', 'Null key'),
      tune('n3', 'Blank key', { key: '  ' }),
    ],
    [userTune('nu1', 'n1'), userTune('nu2', 'n2'), userTune('nu3', 'n3')],
  )

  it('finds every tune with no key', () => {
    const found = filterCatalog(entries, { ...DEFAULT_FILTERS, key: NO_KEY })
    expect(found.map((e) => e.tune.id)).toEqual(['n3', 'n2'])
  })

  it('offers no key first, beside the keys the catalog holds', () => {
    expect(facetValues(entries).key).toEqual([NO_KEY, 'D'])
  })

  it('offers no key only when some tune has a key, since it would narrow nothing', () => {
    const keyless = catalogEntries([tune('n2', 'Null key')], [userTune('nu2', 'n2')])
    expect(facetValues(keyless).key).toEqual([])
    const keyed = catalogEntries([tune('n1', 'Keyed', { key: 'D' })], [userTune('nu1', 'n1')])
    expect(facetValues(keyed).key).toEqual(['D'])
  })

  it('keeps no key as a stored filter', () => {
    expect(normalizeFilters({ key: NO_KEY }).key).toBe(NO_KEY)
  })
})

describe('unheard', () => {
  const build = (heard: ReadonlySet<string>) =>
    catalogEntries(
      [tune('h1', 'Heard'), tune('h2', 'Silent')],
      [userTune('hu1', 'h1'), userTune('hu2', 'h2')],
      heard,
    )

  it('unheard keeps tunes with no recording or link', () => {
    const heard = new Set(['h1'])
    const entries = build(heard)
    expect(entries.map((e) => e.heard)).toEqual([true, false])
    expect(
      filterCatalog(entries, { ...DEFAULT_FILTERS, unheard: true }).map((e) => e.tune.id),
    ).toEqual(['h2'])
    expect(filterCatalog(entries, DEFAULT_FILTERS)).toHaveLength(2)
  })
})

describe('missing', () => {
  const entries = catalogEntries(
    [
      tune('m1', 'Full', {
        key: 'D',
        modes: ['major'],
        composer: 'Anon',
        tunings: { violin: { tuning: 'ADAE' } },
      }),
      tune('m2', 'Bare', { key: '  ', composer: '' }),
    ],
    [userTune('mu1', 'm1', { learned_from: 'Sam' }), userTune('mu2', 'm2')],
  )
  const ids = (missing: CatalogFilters['missing']) =>
    filterCatalog(entries, { ...DEFAULT_FILTERS, missing }).map((e) => e.tune.id)

  it('missing key matches no-key tunes', () => {
    expect(ids('key')).toEqual(['m2'])
    expect(ids('key')).toEqual(
      filterCatalog(entries, { ...DEFAULT_FILTERS, key: NO_KEY }).map((e) => e.tune.id),
    )
  })

  it('reads blank text, empty modes, and a missing tuning as missing', () => {
    expect(ids('composer')).toEqual(['m2'])
    expect(ids('mode')).toEqual(['m2'])
    expect(ids('tuning:violin')).toEqual(['m2'])
    expect(ids('genre')).toEqual(['m2', 'm1'])
    expect(ids('all')).toEqual(['m2', 'm1'])
  })

  it('missing learned from reads the user tune', () => {
    expect(ids('learned_from')).toEqual(['m2'])
    expect(ids('learned_on')).toEqual(['m2', 'm1'])
  })

  it('missing choices list only attributes some tune holds', () => {
    expect(missingChoices(entries)).toEqual([
      'key',
      'mode',
      'composer',
      'tuning:violin',
      'learned_from',
    ])
    expect(missingChoices([])).toEqual([])
  })

  it('counts and resets the new sheet filters', () => {
    const set = { ...DEFAULT_FILTERS, unheard: true, missing: 'genre' as const }
    expect(sheetFilterCount(set, [])).toBe(2)
    expect(sheetResets([])).toMatchObject({ unheard: false, missing: 'all' })
  })

  it('resets a missing tuning whose facet is hidden', () => {
    expect(hiddenResets([], 'tuning:violin')).toMatchObject({ missing: 'all' })
    expect(hiddenResets([], 'composer')).not.toHaveProperty('missing')
    expect(hiddenResets(['tuning:violin'], 'tuning:violin')).not.toHaveProperty('missing')
  })
})

describe('stored filters without the new keys', () => {
  it('stored filters without the new keys normalize to defaults', () => {
    const filters = normalizeFilters({ key: 'D' })
    expect(filters.unheard).toBe(false)
    expect(filters.missing).toBe('all')
    expect(normalizeFilters({ unheard: true, missing: 'composer' })).toMatchObject({
      unheard: true,
      missing: 'composer',
    })
    expect(normalizeFilters({ unheard: 'yes', missing: 'bogus' })).toMatchObject({
      unheard: false,
      missing: 'all',
    })
  })
})
