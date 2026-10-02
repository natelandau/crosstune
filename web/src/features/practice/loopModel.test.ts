import { describe, expect, it } from 'vitest'

import {
  adjacent,
  freeGap,
  loopAt,
  loopName,
  newLoop,
  partSuggestions,
  pickColor,
  resizeSpan,
  snapMs,
  roomAround,
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

const A = placed('a', 10000, 20000)
const Bl = placed('b', 30000, 40000)
const loops = [A, Bl]

describe('loopAt', () => {
  it.each([
    ['inside', 15000, loops, 'a'],
    ['start inclusive', 10000, loops, 'a'],
    ['end exclusive', 20000, loops, null],
    ['seam goes to the loop that starts there', 20000, [A, placed('c', 20000, 25000), Bl], 'c'],
    ['between loops', 25000, loops, null],
  ])('%s', (_name, ms, list, id) => {
    expect(loopAt(ms, list)?.id ?? null).toBe(id)
  })
})

describe('roomAround', () => {
  it.each([
    [A, s(1000, 30000)],
    [Bl, s(20000, 61000)],
  ])('%j -> %j', (loop, expected) => {
    expect(roomAround(loop, loops, B)).toEqual(expected)
  })
})

describe('freeGap', () => {
  it.each([
    [25000, s(20000, 30000)],
    [5000, s(1000, 10000)],
    [15000, null],
  ])('%i -> %j', (ms, expected) => {
    expect(freeGap(ms, loops, B)).toEqual(expected)
  })
})

describe('newLoop', () => {
  it.each([
    [
      'clamps to both neighbors only when needed',
      25000,
      loops,
      { kind: 'span', span: s(21000, 29000) },
    ],
    ['flush to the loop before', 21000, loops, { kind: 'span', span: s(20000, 25000) }],
    ['flush to the start bound', 3000, loops, { kind: 'span', span: s(1000, 7000) }],
    ['inside a loop', 15000, loops, { kind: 'inside', id: 'a' }],
    [
      'a gap of exactly 500 ms',
      20250,
      [A, placed('c', 20500, 30000)],
      { kind: 'span', span: s(20000, 20500) },
    ],
    ['a gap of 499 ms', 20250, [A, placed('c', 20499, 30000)], { kind: 'noRoom' }],
    [
      'the cap, checked before anything else',
      15000,
      Array.from({ length: 100 }, (_, i) => placed(`l${i}`, i * 1000, i * 1000 + 500)),
      { kind: 'atCap' },
    ],
  ])('%s', (_name, playhead, list, expected) => {
    expect(newLoop(playhead, list, B)).toEqual(expected)
  })
})

describe('adjacent', () => {
  it.each([
    ['next', 25000, null, 'b'],
    ['previous', 25000, null, 'a'],
    ['previous', 10000, 'a', null],
    ['previous', 15000, 'a', null],
    ['next', 10000, 'a', 'b'],
  ] as const)('%s from %i, selected %s -> %s', (direction, playhead, selected, id) => {
    expect(adjacent(direction, playhead, loops, selected)?.id ?? null).toBe(id)
  })
})

describe('resizeSpan between neighbors', () => {
  it.each([
    [A, 'end', 35000, s(10000, 30000)],
    [Bl, 'start', 15000, s(20000, 40000)],
    [A, 'end', 10200, s(10000, 10500)],
  ] as const)('%j %s to %i -> %j', (loop, edge, to, expected) => {
    expect(resizeSpan(loop, edge, to, roomAround(loop, loops, B))).toEqual(expected)
  })
})
