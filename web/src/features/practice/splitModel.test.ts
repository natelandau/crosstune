import { describe, expect, it } from 'vitest'
import { MAX_RECORDING_MS, MAX_SPLIT_PIECES } from '../../domain/recordingLimits'
import {
  canAddCut,
  canSave,
  cutRoom,
  initialSplit,
  pieceAt,
  pieceColor,
  pieces,
  splitReducer,
  type SplitAction,
  type SplitState,
} from './splitModel'

function state(patch: Partial<SplitState> = {}): SplitState {
  return {
    lowMs: 0,
    highMs: 60_000,
    lineMs: 0,
    cuts: [],
    selected: null,
    overLimit: false,
    ...patch,
  }
}

function run(start: SplitState, ...actions: SplitAction[]): SplitState {
  return actions.reduce(splitReducer, start)
}

describe('initialSplit', () => {
  const row = { trim_start_ms: 0, trim_end_ms: null, source_duration_ms: 60_000, duration_ms: null }

  it('spans the whole source of an untrimmed row', () => {
    expect(initialSplit(row, undefined)).toMatchObject({ lowMs: 0, highMs: 60_000, lineMs: 0 })
  })

  it('spans the current trim', () => {
    const trimmed = { ...row, trim_start_ms: 5000, trim_end_ms: 40_000 }
    expect(initialSplit(trimmed, undefined)).toMatchObject({ lowMs: 5000, highMs: 40_000 })
  })

  it('falls back to the duration, then the local file length', () => {
    const noSource = { ...row, source_duration_ms: null, duration_ms: 30_000 }
    expect(initialSplit(noSource, undefined).highMs).toBe(30_000)
    const bare = { ...row, source_duration_ms: null }
    expect(initialSplit(bare, { local_duration_ms: 20_000 }).highMs).toBe(20_000)
  })

  it('flags a range over 3 hours', () => {
    const long = { ...row, source_duration_ms: MAX_RECORDING_MS + 1 }
    expect(initialSplit(long, undefined).overLimit).toBe(true)
    expect(initialSplit(row, undefined).overLimit).toBe(false)
  })
})

describe('splitReducer', () => {
  it('moves the line inside the range', () => {
    expect(run(state(), { type: 'moveLine', ms: 99_000 }).lineMs).toBe(60_000)
    expect(run(state(), { type: 'moveLine', ms: -5 }).lineMs).toBe(0)
    expect(run(state(), { type: 'nudge', ms: 100 }).lineMs).toBe(100)
  })

  it('adds a cut at the line and selects it, so Remove cut undoes it', () => {
    const next = run(state({ lineMs: 20_000 }), { type: 'addCut' })
    expect(next).toMatchObject({ cuts: [20_000], selected: 0 })
    expect(run(next, { type: 'removeCut' }).cuts).toEqual([])
  })

  it('keeps cuts ascending and selects the new one', () => {
    const next = run(
      state({ lineMs: 40_000 }),
      { type: 'addCut' },
      { type: 'seek', ms: 10_000 },
      { type: 'addCut' },
    )
    expect(next).toMatchObject({ cuts: [10_000, 40_000], selected: 0 })
  })

  it('moves the new cut with the line until something lets it go', () => {
    const added = run(state({ lineMs: 20_000 }), { type: 'addCut' })
    expect(run(added, { type: 'moveLine', ms: 25_000 }).cuts).toEqual([25_000])
    expect(run(added, { type: 'seek', ms: 30_000 })).toMatchObject({
      cuts: [20_000],
      lineMs: 30_000,
      selected: null,
    })
  })

  it('selects a cut the line comes to rest on', () => {
    const start = state({ cuts: [10_000], lineMs: 5000 })
    const onCut = run(start, { type: 'moveLine', ms: 10_000 })
    expect(onCut.selected).toBeNull()
    expect(run(onCut, { type: 'rest' }).selected).toBe(0)
    expect(run(start, { type: 'rest' }).selected).toBeNull()
  })

  it('refuses a cut within 1 second of an end or another cut', () => {
    expect(canAddCut(state({ lineMs: 999 }))).toBe(false)
    expect(canAddCut(state({ lineMs: 1000 }))).toBe(true)
    expect(canAddCut(state({ lineMs: 59_001 }))).toBe(false)
    expect(canAddCut(state({ lineMs: 20_500, cuts: [20_000] }))).toBe(false)
    expect(canAddCut(state({ lineMs: 21_000, cuts: [20_000] }))).toBe(true)
    const refused = run(state({ lineMs: 500 }), { type: 'addCut' })
    expect(refused.cuts).toEqual([])
  })

  it('refuses the 50th cut', () => {
    const cuts = Array.from({ length: MAX_SPLIT_PIECES - 2 }, (_, i) => (i + 1) * 1000)
    const at = { highMs: 100_000, cuts, lineMs: 80_000 }
    const forty9 = run(state(at), { type: 'addCut' })
    expect(forty9.cuts).toHaveLength(MAX_SPLIT_PIECES - 1)
    expect(pieces(forty9)).toHaveLength(MAX_SPLIT_PIECES)
    expect(canAddCut({ ...forty9, lineMs: 90_000, selected: null })).toBe(false)
    expect(
      run({ ...forty9, lineMs: 90_000, selected: null }, { type: 'addCut' }).cuts,
    ).toHaveLength(MAX_SPLIT_PIECES - 1)
  })

  it('selects a cut and moves the line to it', () => {
    const next = run(state({ cuts: [10_000, 30_000] }), { type: 'select', index: 1 })
    expect(next).toMatchObject({ selected: 1, lineMs: 30_000 })
  })

  it('steps between cuts', () => {
    const start = state({ cuts: [10_000, 30_000], lineMs: 20_000 })
    expect(run(start, { type: 'previous' })).toMatchObject({ selected: 0, lineMs: 10_000 })
    expect(run(start, { type: 'next' })).toMatchObject({ selected: 1, lineMs: 30_000 })
    expect(run(start, { type: 'next' }, { type: 'next' }).selected).toBe(1)
    expect(run(start, { type: 'previous' }, { type: 'previous' }).selected).toBe(0)
  })

  it('steps past the cut the line sits on without selecting it', () => {
    const start = state({ cuts: [10_000, 30_000], lineMs: 10_000 })
    expect(run(start, { type: 'next' }).selected).toBe(1)
    expect(run(start, { type: 'previous' }).selected).toBeNull()
  })

  it('moves a selected cut and keeps it 1 second from its neighbors', () => {
    const start = state({ cuts: [10_000, 30_000], selected: 0, lineMs: 10_000 })
    expect(run(start, { type: 'moveLine', ms: 15_000 })).toMatchObject({
      cuts: [15_000, 30_000],
      lineMs: 15_000,
    })
    expect(run(start, { type: 'moveLine', ms: 45_000 }).cuts).toEqual([29_000, 30_000])
    expect(run(start, { type: 'moveLine', ms: 100 }).cuts).toEqual([1000, 30_000])
    expect(run(start, { type: 'nudge', ms: 100 }).cuts).toEqual([10_100, 30_000])
  })

  it('removes the selected cut', () => {
    const start = state({ cuts: [10_000, 30_000], selected: 0, lineMs: 10_000 })
    expect(run(start, { type: 'removeCut' })).toMatchObject({ cuts: [30_000], selected: null })
    expect(run(state({ cuts: [10_000] }), { type: 'removeCut' }).cuts).toEqual([10_000])
  })

  it('refuses a new cut while one is selected', () => {
    expect(canAddCut(state({ cuts: [10_000], selected: 0, lineMs: 10_000 }))).toBe(false)
  })
})

describe('moveCut and cutRoom', () => {
  const two = state({ cuts: [10_000, 30_000], lineMs: 20_000 })

  it('gives each cut the room that keeps every piece at least 1 second', () => {
    expect(cutRoom(two, 0)).toEqual([1000, 29_000])
    expect(cutRoom(two, 1)).toEqual([11_000, 59_000])
  })

  it('moves one cut and leaves the line where it is', () => {
    expect(run(two, { type: 'moveCut', index: 0, ms: 15_000 })).toMatchObject({
      cuts: [15_000, 30_000],
      lineMs: 20_000,
    })
  })

  it('keeps cuts ordered and 1 second from each other', () => {
    expect(run(two, { type: 'moveCut', index: 0, ms: 45_000 }).cuts).toEqual([29_000, 30_000])
    expect(run(two, { type: 'moveCut', index: 1, ms: 2000 }).cuts).toEqual([10_000, 11_000])
  })

  it('keeps cuts 1 second inside the range', () => {
    expect(run(two, { type: 'moveCut', index: 0, ms: -500 }).cuts).toEqual([1000, 30_000])
    expect(run(two, { type: 'moveCut', index: 1, ms: 99_000 }).cuts).toEqual([10_000, 59_000])
  })

  it('lets go of the cut it moves when that cut is selected', () => {
    const selected = state({ cuts: [10_000, 30_000], selected: 0, lineMs: 10_000 })
    expect(run(selected, { type: 'moveCut', index: 0, ms: 12_000 })).toMatchObject({
      cuts: [12_000, 30_000],
      selected: null,
      lineMs: 10_000,
    })
    expect(run(selected, { type: 'moveCut', index: 1, ms: 32_000 }).selected).toBe(0)
  })

  it('leaves the state alone for a missing cut', () => {
    expect(run(two, { type: 'moveCut', index: 5, ms: 15_000 })).toBe(two)
  })
})

describe('pieceColor', () => {
  it('cycles through every loop color, so neighbors differ', () => {
    const colors = Array.from({ length: 12 }, (_, i) => pieceColor(i))
    expect(new Set(colors.slice(0, 6)).size).toBe(6)
    expect(colors.slice(6)).toEqual(colors.slice(0, 6))
    for (let i = 1; i < colors.length; i++) expect(colors[i]).not.toBe(colors[i - 1])
  })
})

describe('pieces and pieceAt', () => {
  const split = state({ cuts: [10_000, 30_000] })

  it('covers the range end to end', () => {
    expect(pieces(split)).toEqual([
      { startMs: 0, endMs: 10_000 },
      { startMs: 10_000, endMs: 30_000 },
      { startMs: 30_000, endMs: 60_000 },
    ])
  })

  it('finds the piece holding a time', () => {
    expect(pieceAt(split, 0)).toBe(0)
    expect(pieceAt(split, 9999)).toBe(0)
    expect(pieceAt(split, 10_000)).toBe(1)
    expect(pieceAt(split, 60_000)).toBe(2)
  })
})

describe('canSave', () => {
  it('needs a cut', () => {
    expect(canSave(state())).toBe(false)
    expect(canSave(state({ cuts: [20_000] }))).toBe(true)
  })

  it('needs every piece at least 1 second', () => {
    expect(canSave(state({ cuts: [500] }))).toBe(false)
  })

  it('refuses a take over 3 hours while a piece is over 3 hours', () => {
    const long = state({ highMs: MAX_RECORDING_MS * 2, overLimit: true })
    expect(canSave({ ...long, cuts: [MAX_RECORDING_MS + 1000] })).toBe(false)
    expect(canSave({ ...long, cuts: [MAX_RECORDING_MS] })).toBe(true)
  })

  it('allows long pieces when the take is within the limit', () => {
    expect(canSave(state({ highMs: MAX_RECORDING_MS, cuts: [5000] }))).toBe(true)
  })

  it('refuses more than 50 pieces', () => {
    const cuts = Array.from({ length: MAX_SPLIT_PIECES }, (_, i) => (i + 1) * 1000)
    expect(canSave(state({ highMs: 100_000, cuts }))).toBe(false)
  })
})
