import { describe, expect, it } from 'vitest'
import {
  detailWindow,
  initialTrim,
  isChanged,
  MIN_DETAIL_MS,
  MIN_TRIM_MS,
  trimPatch,
  trimReducer,
  type TrimState,
} from './trimModel'

const untrimmed = { trim_start_ms: 0, trim_end_ms: null, source_duration_ms: 60_000 }

function state(patch: Partial<TrimState> = {}): TrimState {
  return { bounds: [0, 60_000], start: 0, end: 60_000, focus: 'start', zoom: 1, ...patch }
}

describe('trimModel', () => {
  it('starts an untrimmed row on the whole source', () => {
    const trim = initialTrim(untrimmed, undefined)
    expect(trim.bounds).toEqual([0, 60_000])
    expect(trim.start).toBe(0)
    expect(trim.end).toBe(60_000)
    expect(trim.focus).toBe('start')
  })

  it('starts an already-trimmed row on its current trim', () => {
    const trim = initialTrim(
      { trim_start_ms: 5000, trim_end_ms: 40_000, source_duration_ms: 60_000 },
      undefined,
    )
    expect(trim.bounds).toEqual([5000, 40_000])
    expect(trim.start).toBe(5000)
    expect(trim.end).toBe(40_000)
  })

  it("falls back to the file's own length when the row has no source length", () => {
    const trim = initialTrim(
      { trim_start_ms: 0, trim_end_ms: null, source_duration_ms: null },
      { local_duration_ms: 30_000 },
    )
    expect(trim.bounds).toEqual([0, 30_000])
  })

  it('opens the detail on about ten seconds, never past the whole range', () => {
    expect(initialTrim(untrimmed, undefined).zoom).toBe(6)
    const short = initialTrim({ ...untrimmed, source_duration_ms: 4000 }, undefined)
    expect(short.zoom).toBe(1)
  })

  it.each([
    ['start before the bounds', 'start', -500, 0, 60_000],
    ['end past the bounds', 'end', 70_000, 0, 60_000],
    ['start within a second of the end', 'start', 59_500, 59_000, 60_000],
    ['end within a second of the start', 'end', 200, 0, MIN_TRIM_MS],
  ] as const)('drag clamps the %s', (_name, handle, ms, start, end) => {
    const next = trimReducer(state(), { type: 'drag', handle, ms })
    expect([next.start, next.end]).toEqual([start, end])
    expect(next.focus).toBe(handle)
  })

  it('drag moves a handle to where it is dropped', () => {
    const next = trimReducer(state(), { type: 'drag', handle: 'end', ms: 42_000 })
    expect(next.end).toBe(42_000)
  })

  it.each([
    [100, 10_100],
    [-100, 9900],
    [1000, 11_000],
    [-1000, 9000],
  ])('nudge by %i moves the handle', (deltaMs, expected) => {
    const next = trimReducer(state({ start: 10_000 }), {
      type: 'nudge',
      handle: 'start',
      deltaMs,
    })
    expect(next.start).toBe(expected)
  })

  it('nudge stops at the other handle less a second', () => {
    const next = trimReducer(state({ start: 10_000, end: 11_050 }), {
      type: 'nudge',
      handle: 'start',
      deltaMs: 100,
    })
    expect(next.start).toBe(10_050)
  })

  it('setAtPlayhead places a handle at the playhead', () => {
    const next = trimReducer(state({ focus: 'start' }), {
      type: 'setAtPlayhead',
      handle: 'end',
      ms: 30_000,
    })
    expect(next.end).toBe(30_000)
    expect(next.focus).toBe('end')
  })

  it('setAtPlayhead ignores an end less than a second after the start', () => {
    const before = state({ start: 10_000 })
    const next = trimReducer(before, { type: 'setAtPlayhead', handle: 'end', ms: 10_500 })
    expect(next).toBe(before)
  })

  it('setAtPlayhead ignores a start less than a second before the end', () => {
    const before = state({ end: 20_000 })
    const next = trimReducer(before, { type: 'setAtPlayhead', handle: 'start', ms: 19_500 })
    expect(next).toBe(before)
  })

  it('focus changes only which handle the detail follows', () => {
    const next = trimReducer(state(), { type: 'focus', handle: 'end' })
    expect(next).toEqual(state({ focus: 'end' }))
  })

  it('restore puts both handles back without touching the focus or zoom', () => {
    const before = state({ start: 5000, end: 9000, focus: 'end', zoom: 3 })
    const next = trimReducer(before, { type: 'restore', start: 1000, end: 50_000 })
    expect(next).toEqual({ ...before, start: 1000, end: 50_000 })
  })

  it('zoom stays between the whole range and the shortest detail', () => {
    expect(trimReducer(state({ zoom: 2 }), { type: 'zoom', factor: 2 }).zoom).toBe(4)
    expect(trimReducer(state({ zoom: 2 }), { type: 'zoom', factor: 0.1 }).zoom).toBe(1)
    expect(trimReducer(state({ zoom: 2 }), { type: 'zoom', factor: 1000 }).zoom).toBe(
      60_000 / MIN_DETAIL_MS,
    )
  })

  it('the detail window centers on the focused handle inside the bounds', () => {
    expect(detailWindow(state({ start: 30_000, zoom: 6 }))).toEqual([25_000, 35_000])
    expect(detailWindow(state({ start: 1000, zoom: 6 }))).toEqual([0, 10_000])
    expect(detailWindow(state({ focus: 'end', zoom: 6 }))).toEqual([50_000, 60_000])
    expect(detailWindow(state({ start: 30_000, zoom: 6 }), 45_000)).toEqual([40_000, 50_000])
  })

  it('is changed once either handle leaves the current trim', () => {
    expect(isChanged(state(), untrimmed)).toBe(false)
    expect(isChanged(state({ start: 100 }), untrimmed)).toBe(true)
    expect(isChanged(state({ end: 59_000 }), untrimmed)).toBe(true)
  })

  it('writes an end at the source end as null when the row had none', () => {
    expect(trimPatch(state({ start: 5000 }), untrimmed)).toEqual({
      trim_start_ms: 5000,
      trim_end_ms: null,
    })
    expect(trimPatch(state({ end: 50_000 }), untrimmed)).toEqual({
      trim_start_ms: 0,
      trim_end_ms: 50_000,
    })
  })

  it('keeps a set end when the end handle stays on it', () => {
    const row = { trim_start_ms: 0, trim_end_ms: 60_000, source_duration_ms: 60_000 }
    expect(trimPatch(state({ start: 5000 }), row)).toEqual({
      trim_start_ms: 5000,
      trim_end_ms: 60_000,
    })
  })
})
