import { describe, expect, it } from 'vitest'
import { TYPE_TIME_SIGNATURES } from '../../constants'
import type { CatalogEntry } from '../catalog/filters'
import {
  TRADITIONAL,
  catalogComposers,
  mostUsedGenre,
  orderedTypes,
  timeSignatureFor,
} from './tuneTypes'

function entry(fields: Partial<CatalogEntry['tune']>): CatalogEntry {
  return {
    tune: { tune_type: null, genre: null, composer: null, deleted_at: null, ...fields },
    userTune: { archived_at: null, deleted_at: null },
  } as unknown as CatalogEntry
}

describe('orderedTypes', () => {
  it("puts a genre's own types first, then the rest alphabetically", () => {
    const types = orderedTypes('Irish', [])
    expect(types.slice(0, 3)).toEqual(['Reel', 'Jig', 'Slip jig'])
    expect(types.indexOf('Breakdown')).toBeGreaterThan(types.indexOf('Waltz'))
    expect(new Set(types).size).toBe(types.length)
  })

  it('matches the genre ignoring case', () => {
    expect(orderedTypes('irish', [])[0]).toBe('Reel')
  })

  it("orders by the catalog's own use when the tune has no genre", () => {
    const entries = [
      entry({ tune_type: 'Polka' }),
      entry({ tune_type: 'polka' }),
      entry({ tune_type: 'Rag' }),
    ]
    expect(orderedTypes('', entries).slice(0, 2)).toEqual(['Polka', 'Rag'])
  })

  it('spells a known type the canonical way, once', () => {
    const types = orderedTypes('', [entry({ tune_type: 'polka' })])
    expect(types[0]).toBe('Polka')
    expect(types.filter((t) => t === 'Polka')).toHaveLength(1)
    expect(types).not.toContain('polka')
  })

  it('keeps a custom type the catalog uses', () => {
    expect(orderedTypes('', [entry({ tune_type: 'Fling' })])).toContain('Fling')
  })
})

describe('mostUsedGenre', () => {
  it('counts spellings alike and breaks ties alphabetically', () => {
    const entries = [
      entry({ genre: 'Old-time' }),
      entry({ genre: 'irish' }),
      entry({ genre: 'Irish' }),
      entry({ genre: 'Old-time' }),
    ]
    expect(mostUsedGenre(entries)).toBe('Irish')
  })

  it('spells a known genre the canonical way over an all-caps majority', () => {
    const entries = [
      entry({ genre: 'IRISH' }),
      entry({ genre: 'Irish' }),
      entry({ genre: 'Irish' }),
    ]
    expect(mostUsedGenre(entries)).toBe('Irish')
  })

  it('spells a lowercase-only known genre the canonical way', () => {
    expect(mostUsedGenre([entry({ genre: 'irish' })])).toBe('Irish')
  })

  it('spells a custom genre the way most tunes do, ties to the first seen', () => {
    const most = [
      entry({ genre: 'klezmer' }),
      entry({ genre: 'KLEZMER' }),
      entry({ genre: 'KLEZMER' }),
    ]
    expect(mostUsedGenre(most)).toBe('KLEZMER')
    const tied = [entry({ genre: 'klezmer' }), entry({ genre: 'Klezmer' })]
    expect(mostUsedGenre(tied)).toBe('klezmer')
  })

  it('is null for a catalog with no genres', () => {
    expect(mostUsedGenre([entry({})])).toBeNull()
  })
})

describe('catalogComposers', () => {
  it('offers Traditional first, then every composer once, alphabetically', () => {
    const entries = [entry({ composer: 'Ed Reavy' }), entry({ composer: 'ed reavy' })]
    expect(catalogComposers(entries)).toEqual([TRADITIONAL, 'Ed Reavy'])
  })

  it('spells a composer the way most tunes do', () => {
    const entries = [
      entry({ composer: 'ED REAVY' }),
      entry({ composer: 'Ed Reavy' }),
      entry({ composer: 'Ed Reavy' }),
    ]
    expect(catalogComposers(entries)).toEqual([TRADITIONAL, 'Ed Reavy'])
  })
})

describe('timeSignatureFor', () => {
  it.each([
    ['Reel', '4/4'],
    ['HORNPIPE', '4/4'],
    ['Barndance', '4/4'],
    ['Highland', '4/4'],
    ['Strathspey', '4/4'],
    ['Breakdown', '4/4'],
    ['Rag', '4/4'],
    ['jig', '6/8'],
    ['slip JIG', '9/8'],
    ['Hop jig', '9/8'],
    ['Slide', '12/8'],
    ['Single jig', '12/8'],
    ['Polka', '2/4'],
    ['March', '2/4'],
    ['Waltz', '3/4'],
    ['Mazurka', '3/4'],
  ])('%s is %s', (type, expected) => {
    expect(timeSignatureFor(type)).toBe(expected)
  })

  it('covers every type with one time signature', () => {
    const tested = [
      'Reel',
      'Hornpipe',
      'Barndance',
      'Highland',
      'Strathspey',
      'Breakdown',
      'Rag',
      'Jig',
      'Slip jig',
      'Hop jig',
      'Slide',
      'Single jig',
      'Polka',
      'March',
      'Waltz',
      'Mazurka',
    ]
    expect(Object.keys(TYPE_TIME_SIGNATURES).sort()).toEqual(tested.sort())
  })

  it('is null for a type with no one time signature', () => {
    expect(timeSignatureFor('Set dance')).toBeNull()
    expect(timeSignatureFor('Air')).toBeNull()
  })
})
