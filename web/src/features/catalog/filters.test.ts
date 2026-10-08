import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../api/vocabulary'
import { tuneRow as tune, userTuneRow as userTune } from '../../test/rows'
import {
  catalogEntries,
  type CatalogFilters,
  DEFAULT_FILTERS,
  type Facet,
  FACET_LABELS,
  FACETS,
  facetChoices,
  facetValues,
  effectiveStatus,
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
  ROW_FACETS,
  sheetFacets,
  tuneCountLabel,
  visibleFacets,
} from './filters'
import { sheetFilters } from './filterLabels'

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

  it('reads an unrecognized status as Unknown', () => {
    const odd = catalogEntries(
      [tune('s9', 'Z')],
      [userTune('u9', 's9', { status: 'mystery' as never })],
    )
    expect(effectiveStatus(odd[0]!.userTune)).toBe('want_to_learn')
    expect(
      filterCatalog(odd, { ...DEFAULT_FILTERS, status: 'want_to_learn' }).map((e) => e.tune.id),
    ).toEqual(['s9'])
    expect(filterCatalog(odd, { ...DEFAULT_FILTERS, status: 'known' })).toEqual([])
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
    expect(facets.genre).toEqual(['Old-Time'])
    expect(filterCatalog(entries, { ...DEFAULT_FILTERS, key: 'D' })).toHaveLength(2)
  })
})

describe('facetChoices', () => {
  // The stats row for these shows "Bruce Molsky", the spelling most of them hold, and a tap on
  // it stores that spelling, though the tune that sorts first holds another.
  const entries = catalogEntries(
    [tune('m1', 'A Tune'), tune('m2', 'B Tune'), tune('m3', 'C Tune')],
    [
      userTune('mu1', 'm1', { learned_from: 'bruce molsky' }),
      userTune('mu2', 'm2', { learned_from: 'Bruce Molsky' }),
      userTune('mu3', 'm3', { learned_from: 'Bruce Molsky' }),
    ],
  )

  it('offers one option for a set value the fold calls the same as a facet value', () => {
    const values = facetValues(entries).learned_from
    expect(values).toEqual(['Bruce Molsky'])
    expect(facetChoices(values, 'Bruce Molsky')).toEqual({
      choices: ['Bruce Molsky'],
      selected: 'Bruce Molsky',
    })
    expect(facetChoices(values, ' bruce MOLSKY')).toEqual({
      choices: ['Bruce Molsky'],
      selected: 'Bruce Molsky',
    })
  })

  it('keeps a set value no facet value matches as its own option', () => {
    expect(facetChoices(['A', 'D'], 'Bb')).toEqual({ choices: ['A', 'D', 'Bb'], selected: 'Bb' })
    expect(facetChoices(['A', 'D'], 'all')).toEqual({ choices: ['A', 'D'], selected: 'all' })
    expect(facetChoices(['A', 'D'], NO_KEY)).toEqual({
      choices: [NO_KEY, 'A', 'D'],
      selected: NO_KEY,
    })
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
      composer: 'all',
      learned_from: 'all',
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

  it('puts Type first in the sheet when only Key has a control on the row', () => {
    const visible: Facet[] = ['key', 'tune_type', 'genre']
    const set = { ...DEFAULT_FILTERS, key: 'D', tune_type: 'reel' }
    const sheet = sheetFilters(set, visible, ROW_FACETS)
    expect(sheet.facets).toEqual(['tune_type', 'genre'])
    expect(sheet.count).toBe(1)
    expect(sheetFilterCount(set, visible)).toBe(0)
    expect(sheet.reset).toMatchObject({ tune_type: 'all' })
    expect(sheet.reset).not.toHaveProperty('key')
    expect(sheet.tokens.map((token) => token.label)).toEqual(['reel'])
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

describe('composer and learned from facets', () => {
  const entries = catalogEntries(
    [
      tune('c1', 'Sally Ann', { composer: 'Ed Haley' }),
      tune('c2', 'Lucy Farr'),
      tune('c3', 'Jenny Lind'),
    ],
    [
      userTune('cu1', 'c1', { learned_from: 'Bruce Molsky' }),
      userTune('cu2', 'c2', { learned_from: ' bruce molsky ' }),
      userTune('cu3', 'c3', { learned_from: '   ', archived_at: 't' }),
    ],
  )
  const ids = (found: { tune: { id: string } }[]) => found.map((e) => e.tune.id)

  it('filters by the user’s learned from, ignoring case and padding', () => {
    expect(
      ids(filterCatalog(entries, { ...DEFAULT_FILTERS, learned_from: 'bruce molsky' })),
    ).toEqual(['c2', 'c1'])
  })

  it('filters by the tune’s composer', () => {
    expect(ids(filterCatalog(entries, { ...DEFAULT_FILTERS, composer: 'ed haley' }))).toEqual([
      'c1',
    ])
  })

  it('offers one learned from per spelling, none for blanks, archived entries included', () => {
    const archived = catalogEntries(
      [tune('a1', 'A')],
      [userTune('au1', 'a1', { learned_from: 'Kevin', archived_at: 't' })],
    )
    expect(facetValues(entries).learned_from).toHaveLength(1)
    expect(facetValues(archived).learned_from).toEqual(['Kevin'])
    expect(facetValues(entries).composer).toEqual(['Ed Haley'])
  })

  it('never offers All as a learned from', () => {
    expect(isFilterValue('learned_from', 'All')).toBe(false)
    const all = catalogEntries([tune('x', 'X')], [userTune('xu', 'x', { learned_from: 'All' })])
    expect(facetValues(all).learned_from).toEqual([])
  })

  it('lists both after genre only when some entry holds one', () => {
    const instruments = new Set<Instrument>(['violin'])
    expect(visibleFacets(facetValues(entries), instruments)).toEqual(['composer', 'learned_from'])
    const bare = catalogEntries([tune('b', 'B', { genre: 'Old-time' })], [userTune('bu', 'b')])
    expect(visibleFacets(facetValues(bare), instruments)).toEqual(['genre'])
  })

  it('reads a stored filter from before these facets as Any', () => {
    const filters = normalizeFilters({ key: 'D' })
    expect(filters.composer).toBe('all')
    expect(filters.learned_from).toBe('all')
  })

  it('keeps both off the bar', () => {
    expect(sheetFacets(['key', 'composer', 'learned_from'])).toEqual(['composer', 'learned_from'])
  })

  it('searches the learned from', () => {
    const kevin = catalogEntries(
      [tune('k', 'Plain Title')],
      [userTune('ku', 'k', { learned_from: 'Kevin Wimmer' })],
    )
    expect(ids(filterCatalog(kevin, DEFAULT_FILTERS, 'kev'))).toEqual(['k'])
  })

  it('still treats learned from and composer as Missing attributes', () => {
    expect(missingChoices(entries)).toContain('learned_from')
    expect(missingChoices(entries)).toContain('composer')
    expect(
      ids(filterCatalog(entries, { ...DEFAULT_FILTERS, archived: true, missing: 'learned_from' })),
    ).toEqual(['c3'])
    expect(
      ids(filterCatalog(entries, { ...DEFAULT_FILTERS, archived: true, missing: 'composer' })),
    ).toEqual(['c3', 'c2'])
  })
})
