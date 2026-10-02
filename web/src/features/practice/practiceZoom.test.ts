import { describe, expect, it } from 'vitest'
import {
  fitScale,
  glideMs,
  MAX_PX_PER_S,
  minPxPerS,
  openingScale,
  scrubMs,
  viewAt,
  zoomScale,
} from './practiceZoom'

const frame = { widthPx: 1000, lengthMs: 120_000 }

describe('scrubMs', () => {
  it.each([
    [10_000, 100, 9000],
    [500, 100, 0],
    [59_500, -100, 60_000],
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
