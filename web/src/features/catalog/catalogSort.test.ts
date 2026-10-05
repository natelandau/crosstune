import { describe, expect, it } from 'vitest'
import { tuneRow as tune, userTuneRow as userTune } from '../../test/rows'
import { lastPlayedByTune, sortCatalog, type CatalogSort } from './catalogSort'
import type { CatalogEntry } from './filters'

function entry(
  id: string,
  title: string,
  dates: { added?: string; tuneEdited?: string; userEdited?: string } = {},
): CatalogEntry {
  return {
    tune: tune(id, title, dates.tuneEdited ? { updated_at: dates.tuneEdited } : {}),
    userTune: userTune(`u-${id}`, id, {
      ...(dates.added ? { created_at: dates.added } : {}),
      ...(dates.userEdited ? { updated_at: dates.userEdited } : {}),
    }),
  }
}

const titles = (entries: CatalogEntry[]) => entries.map((e) => e.tune.title)
const choice = (sort: CatalogSort, descending: boolean) => ({ sort, descending })
const NONE = new Map<string, number>()

describe('sortCatalog', () => {
  it('sorts by title A to Z, ignoring case and accents, and Z to A reversed', () => {
    const entries = [entry('a', 'cluck old hen'), entry('b', 'Ángeline'), entry('c', 'Bonaparte')]
    expect(titles(sortCatalog(entries, choice('title', false), NONE))).toEqual([
      'Ángeline',
      'Bonaparte',
      'cluck old hen',
    ])
    expect(titles(sortCatalog(entries, choice('title', true), NONE))).toEqual([
      'cluck old hen',
      'Bonaparte',
      'Ángeline',
    ])
  })

  it('breaks a title tie by id, so two same-named tunes keep one order', () => {
    const entries = [entry('z', 'Sally Ann'), entry('m', 'Sally Ann')]
    expect(sortCatalog(entries, choice('title', false), NONE).map((e) => e.tune.id)).toEqual([
      'm',
      'z',
    ])
  })

  it('sorts by when the tune joined the catalog, newest first or oldest first', () => {
    const entries = [
      entry('a', 'Middle', { added: '2026-03-01T00:00:00Z' }),
      entry('b', 'Newest', { added: '2026-05-01T00:00:00.000Z' }),
      entry('c', 'Oldest', { added: '2026-01-01T00:00:00.123456Z' }),
    ]
    expect(titles(sortCatalog(entries, choice('added', true), NONE))).toEqual([
      'Newest',
      'Middle',
      'Oldest',
    ])
    expect(titles(sortCatalog(entries, choice('added', false), NONE))).toEqual([
      'Oldest',
      'Middle',
      'Newest',
    ])
  })

  it("sorts by the later of the tune's and the musician's own last edit", () => {
    const entries = [
      entry('a', 'Tune edited last', {
        tuneEdited: '2026-06-01T00:00:00Z',
        userEdited: '2026-02-01T00:00:00Z',
      }),
      entry('b', 'Own row edited last', {
        tuneEdited: '2026-01-01T00:00:00Z',
        userEdited: '2026-07-01T00:00:00Z',
      }),
      entry('c', 'Untouched', {
        tuneEdited: '2026-03-01T00:00:00Z',
        userEdited: '2026-03-01T00:00:00Z',
      }),
    ]
    expect(titles(sortCatalog(entries, choice('modified', true), NONE))).toEqual([
      'Own row edited last',
      'Tune edited last',
      'Untouched',
    ])
  })

  it('breaks a date tie by title A to Z in either direction', () => {
    const same = { added: '2026-03-01T00:00:00Z' }
    const entries = [entry('a', 'Cotton Eyed Joe', same), entry('b', 'Arkansas Traveler', same)]
    for (const descending of [true, false]) {
      expect(titles(sortCatalog(entries, choice('added', descending), NONE))).toEqual([
        'Arkansas Traveler',
        'Cotton Eyed Joe',
      ])
    }
  })

  it('sorts by last played, with never-played tunes last in either direction', () => {
    const entries = [
      entry('a', 'Played long ago'),
      entry('b', 'Never played'),
      entry('c', 'Played today'),
      entry('d', 'Also never played'),
    ]
    const played = new Map([
      ['a', Date.parse('2026-01-01T00:00:00Z')],
      ['c', Date.parse('2026-10-04T00:00:00Z')],
    ])
    expect(titles(sortCatalog(entries, choice('played', true), played))).toEqual([
      'Played today',
      'Played long ago',
      'Also never played',
      'Never played',
    ])
    expect(titles(sortCatalog(entries, choice('played', false), played))).toEqual([
      'Played long ago',
      'Played today',
      'Also never played',
      'Never played',
    ])
  })

  it('leaves the given list as it was', () => {
    const entries = [entry('b', 'B'), entry('a', 'A')]
    sortCatalog(entries, choice('title', false), NONE)
    expect(titles(entries)).toEqual(['B', 'A'])
  })
})

describe('lastPlayedByTune', () => {
  it('keeps each tune its latest play or practice session, as an instant', () => {
    const plays = [
      { tune_id: 't1', started_at: '2026-02-01T10:00:00Z' },
      { tune_id: 't1', started_at: '2026-04-01T10:00:00.000Z' },
      { tune_id: null, started_at: '2026-09-01T10:00:00Z' },
    ]
    const sessions = [
      { tune_id: 't1', started_at: '2026-03-01T10:00:00Z' },
      { tune_id: 't2', started_at: '2026-05-01T10:00:00.123456Z' },
      { tune_id: null, started_at: '2026-09-01T10:00:00Z' },
    ]
    expect(lastPlayedByTune(plays, sessions)).toEqual(
      new Map([
        ['t1', Date.parse('2026-04-01T10:00:00Z')],
        ['t2', Date.parse('2026-05-01T10:00:00.123Z')],
      ]),
    )
  })
})
