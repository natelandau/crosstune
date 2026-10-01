import { describe, expect, it } from 'vitest'
import {
  catalogCaption,
  choose,
  filterTunes,
  LISTS,
  MAX_ROWS,
  NO_FILTER,
  RAIL,
  STATUS_LABELS,
  TUNES,
  visibleTunes,
  type Status,
} from '../src/demos/catalog'

const names = (state: Parameters<typeof filterTunes>[0]) => filterTunes(state).map((t) => t.name)

describe('filterTunes', () => {
  it('shows every tune with nothing chosen', () => {
    expect(filterTunes(NO_FILTER)).toHaveLength(TUNES.length)
  })

  it('combines key and status', () => {
    expect(names({ key: 'A', status: 'learning', list: null })).toEqual([
      'Bibb County Hoedown',
      'Breaking Up Christmas',
    ])
  })

  it("shows a list's tunes in the list's order", () => {
    const list = LISTS[0]
    expect(names({ ...NO_FILTER, list: list.name })).toEqual(list.tunes)
  })

  it('names only tunes in the catalog in every list', () => {
    const catalog = new Set(TUNES.map((t) => t.name))
    for (const list of LISTS) for (const name of list.tunes) expect(catalog).toContain(name)
  })
})

describe('choose', () => {
  it('clears key and status when a list is chosen', () => {
    expect(choose({ key: 'A', status: 'known', list: null }, { list: 'Waltzes' })).toEqual({
      key: null,
      status: null,
      list: 'Waltzes',
    })
  })

  it('clears the list when a key is chosen', () => {
    expect(choose({ ...NO_FILTER, list: 'Waltzes' }, { key: 'D' })).toEqual({
      key: 'D',
      status: null,
      list: null,
    })
  })
})

describe('catalogCaption', () => {
  it('invites a choice with nothing chosen', () => {
    expect(catalogCaption(NO_FILTER)).toBe('Tap a key, a status, or a list.')
  })

  it('says cross-tuned tunes are included when a key spans tunings', () => {
    expect(catalogCaption({ ...NO_FILTER, key: 'A' })).toBe(
      '7 tunes in A, cross-tuned ones included.',
    )
  })

  it('names the status', () => {
    expect(catalogCaption({ ...NO_FILTER, status: 'learning' })).toBe("6 tunes you're learning.")
    expect(catalogCaption({ key: 'G', status: 'known', list: null })).toBe('2 tunes in G you know.')
    expect(catalogCaption({ key: 'C', status: 'unknown', list: null })).toBe(
      '1 tune in C you want to learn.',
    )
  })

  it('says when a key has no tunes', () => {
    expect(catalogCaption({ ...NO_FILTER, key: 'Bb' })).toBe('No tunes in B♭ yet.')
  })

  it('names a list and its order', () => {
    expect(catalogCaption({ ...NO_FILTER, list: 'Waltzes' })).toBe(
      'Waltzes: 2 tunes, in the order you play them.',
    )
  })
})

describe('visibleTunes', () => {
  it(`draws at most ${MAX_ROWS} rows and counts the rest`, () => {
    const { shown, more } = visibleTunes(NO_FILTER)
    expect(shown).toHaveLength(MAX_ROWS)
    expect(more).toBe(TUNES.length - MAX_ROWS)
  })

  it('leaves nothing out of a short result', () => {
    expect(visibleTunes({ ...NO_FILTER, list: 'Waltzes' }).more).toBe(0)
  })
})

describe('the catalog', () => {
  it('has a tune for every key and status on the rail', () => {
    for (const key of RAIL) {
      for (const status of Object.keys(STATUS_LABELS) as Status[]) {
        expect(filterTunes({ key, status, list: null }), `${key} ${status}`).not.toHaveLength(0)
      }
    }
  })

  it('names each tune once', () => {
    expect(new Set(TUNES.map((t) => t.name)).size).toBe(TUNES.length)
  })
})
