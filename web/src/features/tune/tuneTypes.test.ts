import { describe, expect, it } from 'vitest'
import type { CatalogEntry } from '../catalog/filters'
import { TRAD, catalogComposers, mostUsedGenre, orderedTypes, timeSignatureFor } from './tuneTypes'

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

  it('is null for a catalog with no genres', () => {
    expect(mostUsedGenre([entry({})])).toBeNull()
  })
})

describe('catalogComposers', () => {
  it('offers Trad. first, then every composer once, alphabetically', () => {
    const entries = [entry({ composer: 'Ed Reavy' }), entry({ composer: 'ed reavy' })]
    expect(catalogComposers(entries)).toEqual([TRAD, 'Ed Reavy'])
  })
})

describe('timeSignatureFor', () => {
  it.each([
    ['Reel', '4/4'],
    ['jig', '6/8'],
    ['Slip jig', '9/8'],
    ['Hop jig', '9/8'],
    ['Slide', '12/8'],
    ['Single jig', '12/8'],
    ['Polka', '2/4'],
    ['Mazurka', '3/4'],
    ['March', '2/4'],
  ])('%s is %s', (type, expected) => {
    expect(timeSignatureFor(type)).toBe(expected)
  })

  it('is null for a type with no one time signature', () => {
    expect(timeSignatureFor('Set dance')).toBeNull()
    expect(timeSignatureFor('Air')).toBeNull()
  })
})
