// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { synthesize } from '../../../test/synthesize'
import { clipSeed, loadClips } from '../../../test/tunerClips'
import { TRACKER } from './constants'
import { estimatePitch } from './nsdf'

const SAMPLE_RATE = 48000

function tone(frequency: number, partials: [number, number][], amplitude: number, ms = 85) {
  const samples = new Float32Array(Math.round((SAMPLE_RATE * ms) / 1000))
  for (let i = 0; i < samples.length; i++) {
    let sum = 0
    for (const [harmonic, weight] of partials) {
      sum += weight * Math.sin((2 * Math.PI * harmonic * frequency * i) / SAMPLE_RATE)
    }
    samples[i] = amplitude * sum
  }
  return samples
}

const cents = (frequency: number, target: number) => 1200 * Math.log2(frequency / target)

describe('estimatePitch', () => {
  it('reads a pure tone to a tenth of a cent', () => {
    const estimate = estimatePitch(tone(440, [[1, 1]], 0.2), SAMPLE_RATE)
    expect(Math.abs(cents(estimate!.frequency, 440))).toBeLessThan(0.1)
    expect(estimate!.clarity).toBeGreaterThan(0.99)
  })

  it('reads a bass E whose fundamental is weak at its fundamental, not the octave', () => {
    const partials: [number, number][] = [
      [1, 0.08],
      [2, 1],
      [3, 0.6],
      [4, 0.3],
    ]
    const estimate = estimatePitch(tone(41.2034, partials, 0.25), SAMPLE_RATE)
    expect(Math.abs(cents(estimate!.frequency, 41.2034))).toBeLessThan(0.5)
  })

  it('reads nothing below the level floor', () => {
    expect(estimatePitch(tone(440, [[1, 1]], 0.005), SAMPLE_RATE)).toBeNull()
  })

  it('reads nothing in loud mains hum', () => {
    const hum: [number, number][] = [
      [1, 1],
      [2, 0.5],
      [3, 0.25],
    ]
    expect(estimatePitch(tone(60, hum, 0.0316), SAMPLE_RATE)).toBeNull()
    expect(estimatePitch(tone(50, hum, 0.0316), SAMPLE_RATE)).toBeNull()
  })

  it.each(loadClips().map((clip, index) => [clip.id, clip, index] as const))(
    'reads nothing below the lowest pitch in any window of %s',
    (_id, clip, index) => {
      const samples = synthesize(clip, index, clipSeed())
      const window = Math.round(clip.sampleRate * TRACKER.longWindowSeconds)
      const hop = Math.round(clip.sampleRate * TRACKER.hopSeconds)
      const lowest: number[] = []
      // Windows end where a tracker's analyses do.
      for (let end = Math.ceil(window / hop) * hop; end <= samples.length; end += hop) {
        const estimate = estimatePitch(samples.subarray(end - window, end), clip.sampleRate)
        if (estimate && estimate.frequency < TRACKER.minHz * 0.99) lowest.push(estimate.frequency)
      }
      expect(lowest).toEqual([])
    },
  )

  it('reads nothing in an empty window', () => {
    expect(estimatePitch(new Float32Array(4080), SAMPLE_RATE)).toBeNull()
  })
})
