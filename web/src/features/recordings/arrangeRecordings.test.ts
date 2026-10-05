import { describe, expect, it } from 'vitest'
import { recordingRow } from '../../test/rows'
import {
  type FiledArrangement,
  type RecordingSort,
  DEFAULT_SORT,
  arrangedCount,
  arrangeRecordings,
  nextSort,
  recordingCountLabel,
} from './arrangeRecordings'
import type { RecordingPrecision } from '../../api/vocabulary'
import type { RecordingView } from './useRecordings'

const BASE = Date.parse('2026-01-01T00:00:00Z')

function view(
  id: string,
  opts: {
    label?: string | null
    tuneId?: string | null
    tuneTitle?: string | null
    staleTuneId?: string
    origin?: string
    /** Minutes after BASE that the recording was added. */
    minutes: number
    recorded?: { at: string; precision: RecordingPrecision | 'decade' } | null
  },
): RecordingView {
  return {
    recording: recordingRow(id, {
      label: opts.label ?? null,
      tune_id: opts.staleTuneId ?? opts.tuneId ?? null,
      origin: opts.origin ?? 'own',
      added_at: new Date(BASE + opts.minutes * 60_000).toISOString(),
      recorded_at: opts.recorded?.at ?? null,
      recorded_precision: opts.recorded?.precision ?? null,
    }),
    file: undefined,
    tuneId: opts.tuneId ?? null,
    tuneTitle: opts.tuneTitle ?? null,
  }
}

const ids = (views: RecordingView[]) => views.map((v) => v.recording.id)
const choice = (sort: RecordingSort, descending: boolean) => ({ sort, descending })

function flat(filed: FiledArrangement): RecordingView[] {
  if (filed.kind !== 'flat') throw new Error('expected a flat arrangement')
  return filed.views
}

function groups(filed: FiledArrangement) {
  if (filed.kind !== 'byTune') throw new Error('expected a byTune arrangement')
  return filed.groups
}

describe('arrangeRecordings by date added', () => {
  const views = [
    view('u1', { minutes: 1 }),
    view('u2', { minutes: 3 }),
    view('u3', { minutes: 2 }),
    view('f1', { tuneId: 't', tuneTitle: 'T', minutes: 4 }),
    view('f2', { tuneId: 't', tuneTitle: 'T', minutes: 6 }),
    view('f3', { tuneId: 't', tuneTitle: 'T', minutes: 5 }),
  ]

  it('puts the newest first when descending', () => {
    const result = arrangeRecordings(views, choice('added', true), '')
    expect(ids(result.unfiled)).toEqual(['u2', 'u3', 'u1'])
    expect(ids(flat(result.filed))).toEqual(['f2', 'f3', 'f1'])
  })

  it('puts the oldest first when ascending', () => {
    const result = arrangeRecordings(views, choice('added', false), '')
    expect(ids(result.unfiled)).toEqual(['u1', 'u3', 'u2'])
    expect(ids(flat(result.filed))).toEqual(['f1', 'f3', 'f2'])
  })

  it('breaks a tie between equal dates by id, mirrored when reversed', () => {
    const tied = [
      view('b', { minutes: 1 }),
      view('c', { minutes: 1 }),
      view('a', { minutes: 1 }),
      view('fb', { tuneId: 't', tuneTitle: 'T', minutes: 1 }),
      view('fa', { tuneId: 't', tuneTitle: 'T', minutes: 1 }),
    ]
    const newest = arrangeRecordings(tied, choice('added', true), '')
    expect(ids(newest.unfiled)).toEqual(['c', 'b', 'a'])
    expect(ids(flat(newest.filed))).toEqual(['fb', 'fa'])
    const oldest = arrangeRecordings([...tied].reverse(), choice('added', false), '')
    expect(ids(oldest.unfiled)).toEqual(['a', 'b', 'c'])
    expect(ids(flat(oldest.filed))).toEqual(['fa', 'fb'])
    const byTune = arrangeRecordings(tied, choice('tune', false), '')
    expect(ids(groups(byTune.filed)[0]!.views)).toEqual(['fb', 'fa'])
  })

  it('does not reorder its input', () => {
    const before = ids(views)
    arrangeRecordings(views, DEFAULT_SORT, '')
    expect(ids(views)).toEqual(before)
  })
})

describe('arrangeRecordings by date recorded', () => {
  const views = [
    view('time', { minutes: 1, recorded: { at: '1998-10-03T16:12:00Z', precision: 'time' } }),
    view('day', { minutes: 2, recorded: { at: '1937-05-12T00:00:00Z', precision: 'day' } }),
    view('month', { minutes: 3, recorded: { at: '1998-05-01T00:00:00Z', precision: 'month' } }),
    view('year', { minutes: 4, recorded: { at: '1937-01-01T00:00:00Z', precision: 'year' } }),
    view('none1', { minutes: 5 }),
    view('none2', { minutes: 6 }),
  ]

  it('puts the newest first, a year at its start, and unknown dates last', () => {
    const result = arrangeRecordings(views, choice('recorded', true), '')
    expect(ids(result.unfiled)).toEqual(['time', 'month', 'day', 'year', 'none2', 'none1'])
  })

  it('puts the oldest first and still leaves unknown dates last', () => {
    const result = arrangeRecordings(views, choice('recorded', false), '')
    expect(ids(result.unfiled)).toEqual(['year', 'day', 'month', 'time', 'none1', 'none2'])
  })

  it('orders the flat filed list the same way', () => {
    const filed = views.map((v) => ({ ...v, tuneId: 't', tuneTitle: 'T' }))
    const result = arrangeRecordings(filed, choice('recorded', true), '')
    expect(ids(flat(result.filed))).toEqual(['time', 'month', 'day', 'year', 'none2', 'none1'])
  })

  it('treats a date whose precision this client predates as unknown', () => {
    const odd = [
      view('newer', { minutes: 1, recorded: { at: '1930-01-01T00:00:00Z', precision: 'decade' } }),
      view('year', { minutes: 2, recorded: { at: '1937-01-01T00:00:00Z', precision: 'year' } }),
    ]
    for (const descending of [true, false]) {
      const result = arrangeRecordings(odd, choice('recorded', descending), '')
      expect(ids(result.unfiled)).toEqual(['year', 'newer'])
    }
  })

  it('breaks a tie by date added, then by id', () => {
    const year = { at: '1937-01-01T00:00:00Z', precision: 'year' } as const
    const tied = [
      view('b', { minutes: 1, recorded: year }),
      view('a', { minutes: 1, recorded: year }),
      view('c', { minutes: 2, recorded: year }),
    ]
    expect(ids(arrangeRecordings(tied, choice('recorded', true), '').unfiled)).toEqual([
      'c',
      'b',
      'a',
    ])
    expect(ids(arrangeRecordings(tied, choice('recorded', false), '').unfiled)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('arrangeRecordings by title', () => {
  const views = [
    view('b', { label: 'banjo', minutes: 1 }),
    view('a', { label: 'Álpha', minutes: 2 }),
    view('c', { label: 'cello', minutes: 3 }),
    view('n1', { minutes: 4 }),
    view('n2', { minutes: 5 }),
  ]

  it('orders titled recordings with the collator, then untitled newest added first', () => {
    const result = arrangeRecordings(views, choice('title', false), '')
    expect(ids(result.unfiled)).toEqual(['a', 'b', 'c', 'n2', 'n1'])
  })

  it('reverses titled recordings and still puts untitled ones last, oldest added first', () => {
    const result = arrangeRecordings(views, choice('title', true), '')
    expect(ids(result.unfiled)).toEqual(['c', 'b', 'a', 'n1', 'n2'])
  })

  it('orders the flat filed list the same way', () => {
    const filed = views.map((v) => ({ ...v, tuneId: 't', tuneTitle: 'T' }))
    const result = arrangeRecordings(filed, choice('title', false), '')
    expect(result.unfiled).toEqual([])
    expect(ids(flat(result.filed))).toEqual(['a', 'b', 'c', 'n2', 'n1'])
  })

  it('reverses the flat filed list the same way', () => {
    const filed = views.map((v) => ({ ...v, tuneId: 't', tuneTitle: 'T' }))
    const result = arrangeRecordings(filed, choice('title', true), '')
    expect(result.unfiled).toEqual([])
    expect(ids(flat(result.filed))).toEqual(['c', 'b', 'a', 'n1', 'n2'])
  })
})

describe('arrangeRecordings by tune', () => {
  const views = [
    view('b1', { tuneId: 'tb', tuneTitle: 'Banks', minutes: 1 }),
    view('b2', { tuneId: 'tb', tuneTitle: 'Banks', minutes: 3 }),
    view('a1', { tuneId: 'ta', tuneTitle: 'Arkansas', minutes: 2 }),
    view('a2', { tuneId: 'ta', tuneTitle: 'Arkansas', minutes: 4 }),
    view('u1', { minutes: 5 }),
    view('u2', { minutes: 6 }),
  ]

  it('groups by tune title ascending with newest first inside each group', () => {
    const result = arrangeRecordings(views, choice('tune', false), '')
    const g = groups(result.filed)
    expect(g.map((x) => x.tuneTitle)).toEqual(['Arkansas', 'Banks'])
    expect(g.map((x) => ids(x.views))).toEqual([
      ['a2', 'a1'],
      ['b2', 'b1'],
    ])
    expect(ids(result.unfiled)).toEqual(['u2', 'u1'])
  })

  it('reverses the groups only when descending', () => {
    const result = arrangeRecordings(views, choice('tune', true), '')
    const g = groups(result.filed)
    expect(g.map((x) => x.tuneTitle)).toEqual(['Banks', 'Arkansas'])
    expect(g.map((x) => ids(x.views))).toEqual([
      ['b2', 'b1'],
      ['a2', 'a1'],
    ])
    expect(ids(result.unfiled)).toEqual(['u1', 'u2'])
  })

  it('puts own recordings before imported ones inside a group, each newest added first', () => {
    const mixed = [
      view('i1', { tuneId: 't', tuneTitle: 'T', origin: 'slippery_hill', minutes: 1 }),
      view('o1', { tuneId: 't', tuneTitle: 'T', minutes: 2 }),
      view('i2', { tuneId: 't', tuneTitle: 'T', origin: 'slippery_hill', minutes: 4 }),
      view('o2', { tuneId: 't', tuneTitle: 'T', minutes: 3 }),
    ]
    for (const descending of [false, true]) {
      const g = groups(arrangeRecordings(mixed, choice('tune', descending), '').filed)
      expect(ids(g[0]!.views)).toEqual(['o2', 'o1', 'i2', 'i1'])
    }
  })

  it('keeps two tunes with one title as two groups ordered by id', () => {
    const same = [
      view('x2', { tuneId: 't2', tuneTitle: "Soldier's Joy", minutes: 1 }),
      view('x1', { tuneId: 't1', tuneTitle: "Soldier's Joy", minutes: 2 }),
    ]
    const g = groups(arrangeRecordings(same, choice('tune', false), '').filed)
    expect(g.map((x) => x.tuneId)).toEqual(['t1', 't2'])
  })
})

describe('arrangeRecordings filing', () => {
  it('leaves a recording whose tune is gone in unfiled', () => {
    const result = arrangeRecordings(
      [view('r', { tuneId: null, staleTuneId: 'deleted', minutes: 1 })],
      DEFAULT_SORT,
      '',
    )
    expect(ids(result.unfiled)).toEqual(['r'])
    expect(flat(result.filed)).toEqual([])
  })
})

describe('arrangeRecordings search', () => {
  const views = [
    view('s', { label: 'fast', tuneId: 't', tuneTitle: "Soldier's Joy", minutes: 1 }),
    view('a', { label: 'Álpha', minutes: 2 }),
    view('n', { minutes: 3 }),
  ]

  it('matches the tune title, trimmed and ignoring case', () => {
    const result = arrangeRecordings(views, DEFAULT_SORT, '  soldier ')
    expect(ids(flat(result.filed))).toEqual(['s'])
    expect(result.unfiled).toEqual([])
  })

  it('matches a label ignoring case and accents', () => {
    const result = arrangeRecordings(views, DEFAULT_SORT, 'ALPHA')
    expect(ids(result.unfiled)).toEqual(['a'])
    expect(flat(result.filed)).toEqual([])
  })

  it('does not match the placeholder name of an untitled recording', () => {
    const result = arrangeRecordings(views, DEFAULT_SORT, 'Recording')
    expect(ids(result.unfiled)).toEqual([])
  })

  it('treats only spaces as no query', () => {
    const result = arrangeRecordings(views, DEFAULT_SORT, '   ')
    expect(ids(result.unfiled)).toEqual(['n', 'a'])
    expect(ids(flat(result.filed))).toEqual(['s'])
  })

  it('returns empty lists when nothing matches', () => {
    const flatResult = arrangeRecordings(views, DEFAULT_SORT, 'zzz')
    expect(flatResult.unfiled).toEqual([])
    expect(flat(flatResult.filed)).toEqual([])
    const tuneResult = arrangeRecordings(views, choice('tune', false), 'zzz')
    expect(tuneResult.unfiled).toEqual([])
    expect(groups(tuneResult.filed)).toEqual([])
  })
})

describe('nextSort', () => {
  it('defaults to date added, newest first', () => {
    expect(DEFAULT_SORT).toEqual(choice('added', true))
  })

  it('reverses the current sort when picked again', () => {
    expect(nextSort(choice('added', true), 'added')).toEqual(choice('added', false))
    expect(nextSort(choice('recorded', true), 'recorded')).toEqual(choice('recorded', false))
  })

  it('starts a different sort at its own first direction', () => {
    expect(nextSort(choice('added', true), 'title')).toEqual(choice('title', false))
    expect(nextSort(choice('title', true), 'tune')).toEqual(choice('tune', false))
    expect(nextSort(choice('title', false), 'recorded')).toEqual(choice('recorded', true))
    expect(nextSort(choice('recorded', false), 'added')).toEqual(choice('added', true))
  })
})

describe('the list header count', () => {
  const views = [
    view('u1', { minutes: 1 }),
    view('f1', { tuneId: 't', tuneTitle: 'T', minutes: 2 }),
    view('f2', { tuneId: 's', tuneTitle: 'S', minutes: 3 }),
  ]

  it('counts both lists whether the filed one is flat or grouped by tune', () => {
    expect(arrangedCount(arrangeRecordings(views, DEFAULT_SORT, ''))).toBe(3)
    expect(arrangedCount(arrangeRecordings(views, choice('tune', false), ''))).toBe(3)
    expect(arrangedCount(arrangeRecordings(views, DEFAULT_SORT, 'zzz'))).toBe(0)
  })

  it('names the whole, or the part of it shown', () => {
    expect(recordingCountLabel(24, 24)).toBe('24 recordings')
    expect(recordingCountLabel(1, 1)).toBe('1 recording')
    expect(recordingCountLabel(3, 24)).toBe('3 of 24 recordings')
    expect(recordingCountLabel(0, 24)).toBe('0 of 24 recordings')
  })
})
