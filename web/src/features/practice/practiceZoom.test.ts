import { describe, expect, it } from 'vitest'
import {
  unstretchedMs,
  fitScale,
  glideMs,
  MAX_PX_PER_S,
  minPxPerS,
  openingScale,
  RUBBER_REACH_PX,
  rubberBand,
  scrubMs,
  stretchedScale,
  viewAt,
  zoomScale,
} from './practiceZoom'

const frame = { widthPx: 1000, lengthMs: 120_000 }

describe('scrubMs', () => {
  it.each([
    [10_000, 100, 9000],
    [1500, 100, 500],
    [58_500, -100, 59_500],
  ])('from %i by %i px -> %i', (from, dx, expected) => {
    expect(scrubMs(from, dx, 100, 60_000)).toBe(expected)
  })
})

describe('glideMs', () => {
  it('carries the drag on, opposite to the finger', () => {
    expect(glideMs(1000, 100)).toBe(-3250)
  })
})

describe('viewAt', () => {
  it.each([
    [5000, 0],
    [0, -5000],
  ])('center %i -> startMs %i', (center, startMs) => {
    expect(viewAt(100, center, 1000, 1000)).toEqual({
      startMs,
      pxPerS: 100,
      widthPx: 1000,
      trimStartMs: 1000,
    })
  })
})

describe('scales', () => {
  it('stops zooming out where the whole recording fits', () => {
    expect(minPxPerS(1000, 120_000)).toBeCloseTo(8.3333, 3)
  })

  // Shared with PracticeZoomTests.swift; keep the two tables equal.
  it.each([
    [0, 10_000, 5000, 83.3333],
    [0, 10_000, 0, 45.4545],
    [0, 10_000, 9000, 50],
    [0, 10_000, 10_000, 45.4545],
    [0, 10_000, 20_000, 45.4545],
    [0, 600, 300, 200],
  ])('fits %i-%i with the playhead at %i at %f px/s', (startMs, endMs, playheadMs, expected) => {
    expect(fitScale({ startMs, endMs }, playheadMs, 1000)).toBeCloseTo(expected, 3)
  })

  it('opens as Fit would on a loop, else 30 seconds wide', () => {
    expect(openingScale(null, 0, 1000)).toBeCloseTo(33.3333, 3)
    expect(openingScale({ startMs: 0, endMs: 10_000 }, 5000, 1000)).toBeCloseTo(83.3333, 3)
    expect(openingScale({ startMs: 0, endMs: 10_000 }, 0, 1000)).toBeCloseTo(45.4545, 3)
  })

  it.each([
    [100, 4, 200],
    [10, 0.5, 8.3333],
  ])('zooms %f by x%f to %f', (pxPerS, factor, expected) => {
    expect(zoomScale(pxPerS, factor, frame)).toBeCloseTo(expected, 3)
    expect(MAX_PX_PER_S).toBe(200)
  })
})

it('undoes the rubber band, so a press that catches a spring back drags on from where it is drawn', () => {
  for (const shownMs of [-400, -50, 10_050, 10_300]) {
    const fromMs = unstretchedMs(shownMs, 200, 10_000)
    expect(scrubMs(fromMs, 0, 200, 10_000)).toBeCloseTo(shownMs, 6)
  }
})

describe('rubberBand', () => {
  it('follows nothing at the limit and keeps the side of the pull', () => {
    expect(rubberBand(0, 100)).toBe(0)
    expect(rubberBand(40, 100)).toBeGreaterThan(0)
    expect(rubberBand(-40, 100)).toBeCloseTo(-rubberBand(40, 100), 9)
  })

  it('gives less the farther it is pulled, and never reaches its reach', () => {
    const pulls = [10, 50, 200, 1000, 100_000]
    const drawn = pulls.map((pull) => rubberBand(pull, 100))
    pulls.forEach((pull, at) => expect(drawn[at]!).toBeLessThan(pull))
    for (let at = 1; at < drawn.length; at++) {
      expect(drawn[at]! - drawn[at - 1]!).toBeLessThan(pulls[at]! - pulls[at - 1]!)
      expect(drawn[at]!).toBeGreaterThan(drawn[at - 1]!)
    }
    expect(drawn.at(-1)!).toBeLessThan(100)
  })
})

describe('scrubMs past an end', () => {
  it('pulls past either end by less than the drag, and never past the reach', () => {
    // 1 px is 10 ms at 100 px/s.
    const past = scrubMs(500, 150, 100, 60_000)
    expect(past).toBeLessThan(0)
    expect(past).toBeGreaterThan(-1000)
    const beyond = scrubMs(59_500, -150, 100, 60_000)
    expect(beyond).toBeGreaterThan(60_000)
    expect(beyond).toBeLessThan(61_000)
    expect(scrubMs(0, 100_000, 100, 60_000)).toBeGreaterThan(-RUBBER_REACH_PX * 10)
  })
})

describe('stretchedScale', () => {
  it('is the scale itself within the limits', () => {
    expect(stretchedScale(100, frame)).toBeCloseTo(100, 9)
    expect(stretchedScale(MAX_PX_PER_S, frame)).toBeCloseTo(MAX_PX_PER_S, 9)
  })

  it('stretches past either limit with resistance, never past 1.25 of it', () => {
    const min = minPxPerS(frame.widthPx, frame.lengthMs)
    const over = stretchedScale(MAX_PX_PER_S * 1.5, frame)
    expect(over).toBeGreaterThan(MAX_PX_PER_S)
    expect(over).toBeLessThan(MAX_PX_PER_S * 1.25)
    expect(stretchedScale(MAX_PX_PER_S * 1000, frame)).toBeLessThan(MAX_PX_PER_S * 1.25)
    const under = stretchedScale(min / 1.5, frame)
    expect(under).toBeLessThan(min)
    expect(under).toBeGreaterThan(min / 1.25)
    expect(stretchedScale(min / 1000, frame)).toBeGreaterThan(min / 1.25)
  })
})
