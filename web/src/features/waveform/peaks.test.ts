import { describe, expect, it } from 'vitest'
import {
  barLevels,
  encodePeaks,
  fitPeaks,
  gridLevel,
  parsePeaks,
  peakByte,
  slicePeaks,
} from './peaks'

describe('encodePeaks and parsePeaks', () => {
  it('round trips values through the header', () => {
    const values = Uint8Array.from([10, 20, 30, 255, 0])
    const peaks = parsePeaks(encodePeaks(values))
    expect(peaks.pointsPerSecond).toBe(50)
    expect(Array.from(peaks.values)).toEqual(Array.from(values))
  })

  it('rejects a header naming a different version', () => {
    const file = encodePeaks(Uint8Array.from([1, 2, 3]))
    file[0] = 2
    expect(() => parsePeaks(file)).toThrow()
  })

  it('rejects a header naming a different points-per-second', () => {
    const file = encodePeaks(Uint8Array.from([1, 2, 3]))
    file[1] = 0
    file[2] = 25
    expect(() => parsePeaks(file)).toThrow()
  })
})

describe('slicePeaks', () => {
  it('rounds ms offsets to point indices at 50 points per second', () => {
    const values = Uint8Array.from({ length: 100 }, (_, i) => i)
    const sliced = slicePeaks({ pointsPerSecond: 50, values }, 400, 1000)
    expect(Array.from(sliced.values)).toEqual(Array.from({ length: 30 }, (_, i) => i + 20))
  })
})

describe('fitPeaks', () => {
  it('resamples to round(durationMs / 20) points, each the max of its window', () => {
    const values = Uint8Array.from({ length: 120 }, (_, i) => i)
    const fitted = fitPeaks(values, 2000)
    expect(fitted).toHaveLength(100)
    for (let t = 0; t < 100; t++) {
      const start = Math.floor((t * 120) / 100)
      const end = Math.floor(((t + 1) * 120) / 100)
      const expectedMax = Math.max(...Array.from({ length: end - start }, (_, i) => start + i))
      expect(fitted[t]).toBe(expectedMax)
    }
  })
})

describe('peakByte', () => {
  it('scales the largest magnitude sample to 0-255', () => {
    expect(peakByte(Float32Array.from([0, -1, 0.5]))).toBe(255)
  })

  it('is 0 for silence', () => {
    expect(peakByte(Float32Array.from([0, 0, 0]))).toBe(0)
  })
})

describe('barLevels', () => {
  it('takes the max of each bar and scales to the largest value', () => {
    const levels = barLevels(Uint8Array.from([10, 50, 20, 100, 0, 25]), 3)
    expect(levels).toEqual([0.5, 1, 0.25])
  })

  it('scales to a loudest value it is given, such as the whole file of a slice', () => {
    expect(barLevels(Uint8Array.from([25, 50]), 2, 200)).toEqual([0.125, 0.25])
  })

  it('spreads fewer points than bars across them', () => {
    expect(barLevels(Uint8Array.from([100, 50]), 4)).toEqual([1, 1, 0.5, 0.5])
  })

  it('is all zero for silence or no points', () => {
    expect(barLevels(Uint8Array.from([0, 0]), 2)).toEqual([0, 0])
    expect(barLevels(new Uint8Array(0), 2)).toEqual([0, 0])
  })
})

describe('gridLevel', () => {
  const peaks = { pointsPerSecond: 50, values: Uint8Array.from([10, 200, 30, 40, 250, 60, 70]) }

  it('takes the max of the points a bar covers, scaled to the loudest value', () => {
    // 50 ms bars over 20 ms points: bar 1 covers 50-100 ms, points 2 to 4.
    expect(gridLevel(peaks, 50, 0, 250)).toBe(200 / 250)
    expect(gridLevel(peaks, 50, 1, 250)).toBe(250 / 250)
  })

  it('gives a bar at least one point when bars are narrower than points', () => {
    expect(gridLevel(peaks, 10, 3, 250)).toBe(200 / 250)
  })

  it('is null before the first point and past the last', () => {
    expect(gridLevel(peaks, 50, -1, 250)).toBeNull()
    expect(gridLevel(peaks, 50, 3, 250)).toBeNull()
  })

  it('is zero for silence', () => {
    expect(gridLevel({ pointsPerSecond: 50, values: new Uint8Array(4) }, 50, 0, 0)).toBe(0)
  })
})
