import { describe, expect, it } from 'vitest'

import { LOOP_LIMIT } from '../../commands/messages'
import {
  canCreate,
  clampLoop,
  loopName,
  moveSpan,
  partSuggestions,
  pickColor,
  resizeSpan,
  snapMs,
  spanFromDrag,
  stackRows,
  type Bounds,
  type PlacedLoop,
} from './loopModel'

const B: Bounds = { startMs: 1000, endMs: 61000 }
const s = (startMs: number, endMs: number) => ({ startMs, endMs })
const placed = (id: string, startMs: number, endMs: number, color = 0): PlacedLoop => ({
  id,
  startMs,
  endMs,
  color,
})

describe('clampLoop', () => {
  it.each([
    [s(0, 5000), s(1000, 5000)],
    [s(60800, 70000), null],
    [s(60000, 70000), s(60000, 61000)],
  ])('%j -> %j', (span, expected) => {
    expect(clampLoop(span, B)).toEqual(expected)
  })
})

describe('spanFromDrag', () => {
  it.each([
    [5000, 3000, s(3000, 5000)],
    [5000, 5100, s(5000, 5500)],
    [60900, 61000, s(60500, 61000)],
  ])('anchor %i pointer %i -> %j', (anchor, pointer, expected) => {
    expect(spanFromDrag(anchor, pointer, B)).toEqual(expected)
  })
})

describe('moveSpan', () => {
  it.each([
    [s(2000, 4000), -5000, s(1000, 3000)],
    [s(2000, 4000), 60000, s(59000, 61000)],
  ])('%j by %i -> %j', (span, delta, expected) => {
    expect(moveSpan(span, delta, B)).toEqual(expected)
  })
})

describe('resizeSpan', () => {
  it.each([
    ['end', 2100, s(2000, 2500)],
    ['start', 0, s(1000, 4000)],
    ['start', 4800, s(3500, 4000)],
  ] as const)('%s to %i -> %j', (edge, to, expected) => {
    expect(resizeSpan(s(2000, 4000), edge, to, B)).toEqual(expected)
  })
})

describe('snapMs', () => {
  it.each([
    [10_040, 10_000],
    // Exactly SNAP_PX (8 px at 10 ms/px) away still snaps; one ms further does not.
    [10_080, 10_000],
    [10_081, 10_081],
    [10_100, 10_100],
  ])('%i against [10000] -> %i', (ms, expected) => {
    expect(snapMs(ms, [10_000], 10)).toBe(expected)
  })
})

describe('stackRows', () => {
  it('stacks overlapping loops into the lowest free row', () => {
    const rows = stackRows([
      placed('a', 0, 10),
      placed('b', 5, 15),
      placed('c', 12, 20),
      placed('d', 16, 18),
    ])
    expect([...rows]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
      ['d', 1],
    ])
  })

  it('treats touching loops as non-overlapping', () => {
    const rows = stackRows([placed('a', 0, 10), placed('b', 10, 20)])
    expect(rows.get('a')).toBe(0)
    expect(rows.get('b')).toBe(0)
  })
})

describe('pickColor', () => {
  it('returns 0 with no loops', () => {
    expect(pickColor(s(5, 8), [])).toBe(0)
  })

  it('avoids colors used by overlapping and adjacent neighbors', () => {
    const loops = [placed('o', 4, 6, 0), placed('before', 0, 3, 1), placed('after', 9, 12, 0)]
    expect(pickColor(s(5, 8), loops)).toBe(2)
  })

  it('picks the lowest index when neighbors tie and overall counts tie', () => {
    const loops = [
      placed('c0', 4, 6, 0),
      placed('c1', 5, 7, 1),
      placed('c2', 5, 7, 2),
      placed('c3', 6, 7, 3),
      placed('c4', 6, 7, 4),
      placed('c5', 6, 7, 5),
      placed('c3b', 6, 7, 3),
    ]
    expect(pickColor(s(5, 8), loops)).toBe(0)
  })

  it('breaks a neighbor tie by least use across all loops', () => {
    const loops = [
      placed('o0', 4, 6, 0),
      placed('o1', 5, 7, 1),
      placed('o2', 5, 7, 2),
      placed('o3', 6, 7, 3),
      placed('o4', 6, 7, 4),
      placed('near', 9, 12, 5),
      placed('far1', 100, 200, 0),
      placed('far2', 300, 400, 0),
      placed('far3', 500, 600, 1),
    ]
    expect(pickColor(s(5, 8), loops)).toBe(2)
  })
})

describe('partSuggestions', () => {
  it.each([
    ['AABB', [], ['A part', 'B part']],
    ['aabbcc', ['B part'], ['A part', 'C part', 'B part']],
    ['AB(x3)', [], ['A part', 'B part']],
    ['AABB (CC)', [], ['A part', 'B part']],
    ['aabb', [], ['A part', 'B part']],
    ['AABBCC', [], ['A part', 'B part', 'C part']],
    ['ABAC', [], ['A part', 'B part', 'C part']],
    ['A A B B', [], ['A part', 'B part']],
    // ß uppercases to SS, which is no part letter.
    ['AßB', [], ['A part', 'B part']],
    ['', [], []],
    [null, [], []],
  ] as const)('%j used %j -> %j', (structure, used, expected) => {
    expect(partSuggestions(structure, used)).toEqual(expected)
  })
})

describe('loopName', () => {
  it('names an unlabeled loop by its offset into the trim', () => {
    expect(loopName(null, 85_000, 1000)).toBe('Loop 1:24')
    expect(loopName('  ', 85_000, 1000)).toBe('Loop 1:24')
  })

  it('uses the label when present', () => {
    expect(loopName('B part', 85_000, 1000)).toBe('B part')
  })
})

describe('canCreate', () => {
  it('blocks at the cap with a reason', () => {
    expect(canCreate(100, B)).toEqual({ allowed: false, reason: LOOP_LIMIT })
  })

  it('hides the control when the trim range is too short', () => {
    expect(canCreate(0, s(0, 400))).toEqual({ allowed: false, reason: null })
  })

  it('allows otherwise', () => {
    expect(canCreate(99, B)).toEqual({ allowed: true, reason: null })
  })
})
