import { describe, expect, it } from 'vitest'
import { DOT, keepWindows, remapTaps, tapFilter, trimArgs } from '../../capture/timeline.ts'
import type { Timeline } from '../../capture/types.ts'

const timeline = (overrides: Partial<Timeline>): Timeline => ({
  name: 'tunes',
  scale: 3,
  start: 1000.8,
  end: 1008.9,
  taps: [],
  ...overrides,
})

describe('trimArgs', () => {
  it('bounds the scene in recording time', () => {
    const { ss, to } = trimArgs(timeline({}), 999.0)
    expect(ss).toBeCloseTo(1.8, 9)
    expect(to).toBeCloseTo(9.9, 9)
  })
})

describe('tapFilter', () => {
  it('overlays a dot for 0.45 s at the scaled tap point', () => {
    const filter = tapFilter(timeline({ taps: [{ t: 1001.4, x: 120, y: 210 }] }), 1206, 720)
    expect(filter).toContain("enable='between(t,0.6,1.05)'")
    expect(filter).toContain(`x=${Math.round((120 * 3 * 720) / 1206 - DOT / 2)}`)
    expect(filter).toContain(`y=${Math.round((210 * 3 * 720) / 1206 - DOT / 2)}`)
  })

  it('chains one overlay per tap', () => {
    const taps = [
      { t: 1001, x: 10, y: 10 },
      { t: 1002, x: 20, y: 20 },
    ]
    expect(tapFilter(timeline({ taps }), 1206, 720).match(/overlay=/g)).toHaveLength(2)
  })

  it('crops before the scale and maps dots into the crop', () => {
    const crop = { w: 804, h: 1748, x: 0, y: 524 }
    const filter = tapFilter(timeline({ taps: [{ t: 1001.4, x: 120, y: 300 }] }), 1206, 720, crop)
    expect(filter).toContain('[v]crop=804:1748:0:524,scale=720:-2')
    expect(filter).toContain(`x=${Math.round((120 * 3 * 720) / 804 - DOT / 2)}`)
    expect(filter).toContain(`y=${Math.round(((300 * 3 - 524) * 720) / 804 - DOT / 2)}`)
  })

  it('skips a tap outside the crop', () => {
    const crop = { w: 804, h: 1748, x: 0, y: 524 }
    const taps = [
      { t: 1001, x: 120, y: 10 },
      { t: 1002, x: 120, y: 300 },
    ]
    const filter = tapFilter(timeline({ taps }), 1206, 720, crop)
    expect(filter.match(/overlay=/g)).toHaveLength(1)
    expect(filter).toContain('between(t,1.2,')
    expect(tapFilter(timeline({ taps: [taps[0]] }), 1206, 720, crop)).toBe(
      '[v]crop=804:1748:0:524,scale=720:-2[out]',
    )
  })

  it('is a plain scale with no taps', () => {
    expect(tapFilter(timeline({}), 1206, 720)).toBe('[v]scale=720:-2[out]')
  })
})

describe('keepWindows', () => {
  // The recording starts 1 s before the scene, so recording time = scene time + 1.
  const at = (...times: number[]) =>
    timeline({ start: 1000, end: 1020, taps: times.map((t) => ({ t: 1000 + t, x: 0, y: 0 })) })

  it('keeps the whole scene when nothing is tapped', () => {
    expect(keepWindows(at(), 999, 30)).toEqual([{ ss: 1, to: 21 }])
  })

  it('merges taps 0.5 s apart into one window with a tail', () => {
    const windows = keepWindows(at(5, 5.5), 999, 30)
    expect(windows).toHaveLength(1)
    expect(windows[0].ss).toBeCloseTo(5.5, 9)
    expect(windows[0].to).toBeCloseTo(9.5, 9)
  })

  it('cuts the idle stretch between distant taps', () => {
    const windows = keepWindows(at(2, 12), 999, 30)
    expect(windows).toHaveLength(2)
    expect(windows[0].ss).toBeCloseTo(2.5, 9)
    expect(windows[0].to).toBeCloseTo(4.8, 9)
    expect(windows[1].ss).toBeCloseTo(12.5, 9)
    expect(windows[1].to).toBeCloseTo(16, 9)
  })

  it('clamps a tap at the scene edges to the scene', () => {
    const windows = keepWindows(at(0.2, 19.5), 999, 30)
    expect(windows[0].ss).toBeCloseTo(1, 9)
    expect(windows.at(-1)?.to).toBeCloseTo(21, 9)
  })

  it('caps the tail at 3 s, or the given length, and at the scene end', () => {
    expect(keepWindows(at(10), 999, 30).at(-1)?.to).toBeCloseTo(14, 9)
    expect(keepWindows(at(10), 999, 30, 5).at(-1)?.to).toBeCloseTo(16, 9)
    expect(keepWindows(at(18), 999, 30, 5).at(-1)?.to).toBeCloseTo(21, 9)
  })

  it('drops a window that starts after the recording stopped changing', () => {
    // A 10 s file: the tap at scene 15 s (recording 16 s) shows only the held last frame.
    const windows = keepWindows(at(2, 15), 999, 10)
    expect(windows).toHaveLength(1)
    expect(windows[0].ss).toBeCloseTo(2.5, 9)
  })

  it('keeps the whole stretch between the taps a span names', () => {
    // Without the span, taps at 2 and 8 leave a cut from 4.8 to 8.5.
    const windows = keepWindows(at(2, 8, 15), 999, 30, 3, [[0, 1]])
    expect(windows).toHaveLength(2)
    expect(windows[0].ss).toBeCloseTo(2.5, 9)
    expect(windows[0].to).toBeCloseTo(10.8, 9)
    expect(windows[1].ss).toBeCloseTo(15.5, 9)
  })
})

describe('remapTaps', () => {
  const windows = [
    { ss: 2, to: 4 },
    { ss: 10, to: 13 },
  ]
  const tap = (t: number) => ({ t: 1000 + t, x: 1, y: 2 })

  it('moves tap times into the concatenated clip', () => {
    const taps = remapTaps([tap(3), tap(11)], windows, 1000)
    expect(taps.map((t) => t.t)).toEqual([1, 3])
    expect(taps[0]).toMatchObject({ x: 1, y: 2 })
  })

  it('drops taps that fall in a cut', () => {
    expect(remapTaps([tap(6)], windows, 1000)).toEqual([])
  })

  it('nudges dots by an offset', () => {
    expect(remapTaps([tap(3)], windows, 1000, 0.25)[0].t).toBeCloseTo(1.25, 9)
  })
})
