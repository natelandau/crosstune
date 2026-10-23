// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { synthesize, type ClipRecipe } from '../../../test/synthesize'
import { clipSeed, loadClips } from '../../../test/tunerClips'
import { PitchTracker, type Reading } from './tracker'

const CHUNK = 512
const clips = loadClips()
const seed = clipSeed()

interface Push {
  /** Sample time at the end of the chunk just pushed. */
  endMs: number
  reading: Reading | null
}

function feed(tracker: PitchTracker, samples: Float32Array, sampleRate: number, startMs = 0) {
  const pushes: Push[] = []
  for (let at = 0; at < samples.length; at += CHUNK) {
    const chunk = samples.subarray(at, Math.min(at + CHUNK, samples.length))
    const reading = tracker.push(chunk)
    pushes.push({ endMs: startMs + ((at + chunk.length) / sampleRate) * 1000, reading })
  }
  return pushes
}

/** One reading per analysis, since a push between analyses repeats the last one. */
function readingsOf(pushes: Push[]): Reading[] {
  const byTime = new Map<number, Reading>()
  for (const { reading } of pushes) if (reading) byTime.set(reading.atMs, reading)
  return [...byTime.values()]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const centsBetween = (frequency: number, target: number) => 1200 * Math.log2(frequency / target)

const VIOLIN = clips.find((clip) => clip.id === 'violin-a4-flat-2.2')!

/** A sustained violin-like A4 at `frequency`, so the behavior tests need no clip of their own. */
function violinAt(frequency: number, seconds: number): ClipRecipe {
  return { ...VIOLIN, f0: frequency, seconds, a4: 440 }
}

/**
 * Half a second at `from`, then half a second at `to`, with no break in phase, as a string
 * sounds while its peg turns.
 */
function glide(partials: [number, number][], from: number, to: number, sampleRate: number) {
  const out = new Float32Array(sampleRate)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    let tone = 0
    for (const [harmonic, weight] of partials) {
      tone += weight * Math.sin(2 * Math.PI * harmonic * phase)
    }
    out[i] = 0.2 * tone
    phase += (i < sampleRate / 2 ? from : to) / sampleRate
  }
  return out
}

describe('PitchTracker', () => {
  it.each(clips.map((clip, index) => [clip.id, clip, index] as const))(
    'reads %s',
    (_id, clip, index) => {
      const tracker = new PitchTracker({ sampleRate: clip.sampleRate, a4: clip.a4 })
      const readings = readingsOf(feed(tracker, synthesize(clip, index, seed), clip.sampleRate))
      const { expect: expected } = clip
      if (expected === null) {
        expect(readings).toEqual([])
        return
      }
      expect(readings.length).toBeGreaterThan(0)
      expect(readings[0]!.atMs).toBeLessThanOrEqual(clip.lockWithinMs ?? 150)
      const settled = readings.filter((reading) => reading.atMs > 200)
      for (const reading of settled) {
        expect({ name: reading.note.name, octave: reading.note.octave }).toEqual({
          name: expected.name,
          octave: expected.octave,
        })
      }
      const lastHalf = readings.filter((reading) => reading.atMs >= (clip.seconds * 1000) / 2)
      expect(lastHalf.length).toBeGreaterThan(0)
      // A clip may loosen the bound only so far that the two platforms still agree in cents.
      expect(clip.toleranceCents ?? 0).toBeLessThanOrEqual(1.5)
      const tolerance = clip.vibrato ? 2 : (clip.toleranceCents ?? 0.5)
      const cents = median(lastHalf.map((reading) => reading.note.cents))
      expect(Math.abs(cents - expected.cents)).toBeLessThanOrEqual(tolerance)
    },
  )

  it('holds steady on a held note', () => {
    const index = clips.indexOf(VIOLIN)
    const tracker = new PitchTracker({ sampleRate: VIOLIN.sampleRate, a4: VIOLIN.a4 })
    const readings = readingsOf(feed(tracker, synthesize(VIOLIN, index, seed), VIOLIN.sampleRate))
    const cents = readings.map((reading) => reading.note.cents)
    expect(Math.max(...cents) - Math.min(...cents)).toBeLessThan(1.0)
  })

  it('follows a peg turn at once', () => {
    const { sampleRate } = VIOLIN
    const turned = 440 * 2 ** (25 / 1200)
    const tracker = new PitchTracker({ sampleRate, a4: 440 })
    const pushes = feed(tracker, glide(VIOLIN.partials, 440, turned, sampleRate), sampleRate)
    const caughtUp = pushes.find(
      ({ endMs, reading }) =>
        endMs > 500 && reading && Math.abs(centsBetween(reading.frequency, turned)) <= 5,
    )
    expect(caughtUp).toBeDefined()
    expect(caughtUp!.endMs).toBeLessThanOrEqual(600)
  })

  it('reads a bass note after a high one at once and in its own octave', () => {
    const sampleRate = 48_000
    const e1 = 440 * 2 ** (-41 / 12)
    const bass: [number, number][] = [
      [1, 1],
      [2, 0.8],
      [3, 0.5],
    ]
    const tracker = new PitchTracker({ sampleRate, a4: 440 })
    const readings = readingsOf(feed(tracker, glide(bass, 440, e1, sampleRate), sampleRate))
    const moved = readings.find(
      (reading) => reading.atMs > 500 && !(reading.note.name === 'A' && reading.note.octave === 4),
    )
    expect(moved).toBeDefined()
    expect({ name: moved!.note.name, octave: moved!.note.octave }).toEqual({ name: 'E', octave: 1 })
    // The long window's length of the new note and the median's two estimates, with no gap.
    expect(moved!.atMs).toBeLessThanOrEqual(650)
  })

  it.each([
    ['above', 440, true],
    ['below', 100, false],
  ] as const)(
    'keeps a note held between the window thresholds on its window, from %s',
    (_side, from, short) => {
      const { sampleRate } = VIOLIN
      const between = 195
      const tracker = new PitchTracker({ sampleRate, a4: 440 })
      const pushes = feed(tracker, glide(VIOLIN.partials, from, between, sampleRate), sampleRate)
      const settled = pushes.filter(
        ({ endMs, reading }) =>
          endMs > 700 && reading && Math.abs(centsBetween(reading.frequency, between)) <= 5,
      )
      expect(settled.length).toBeGreaterThan(0)
      expect(tracker.usesShortWindow).toBe(short)
    },
  )

  it('fades after the note stops', () => {
    const { sampleRate } = VIOLIN
    const tracker = new PitchTracker({ sampleRate, a4: 440 })
    const held = feed(tracker, synthesize(violinAt(440, 0.5), 0, seed), sampleRate)
    expect(held.at(-1)!.reading).not.toBeNull()
    const silence = feed(tracker, new Float32Array(sampleRate / 2), sampleRate, 500)
    const faded = silence.findIndex(({ reading }) => reading === null)
    expect(faded).toBeGreaterThanOrEqual(0)
    expect(silence[faded]!.endMs).toBeLessThanOrEqual(800)
    expect(silence.slice(faded).every(({ reading }) => reading === null)).toBe(true)
  })

  it('setA4 moves the cents', () => {
    const { sampleRate } = VIOLIN
    const tracker = new PitchTracker({ sampleRate, a4: 440 })
    feed(tracker, synthesize(violinAt(440, 0.5), 0, seed), sampleRate)
    tracker.setA4(442)
    const readings = readingsOf(
      feed(tracker, synthesize(violinAt(440, 0.5), 1, seed), sampleRate, 500),
    )
    expect(readings.length).toBeGreaterThan(0)
    for (const reading of readings) {
      expect(reading.note.name).toBe('A')
      expect(reading.note.octave).toBe(4)
      expect(reading.note.cents).toBeCloseTo(-7.85, 0)
    }
  })

  it('starts over after reset', () => {
    const { sampleRate } = VIOLIN
    const tracker = new PitchTracker({ sampleRate, a4: 440 })
    feed(tracker, synthesize(violinAt(440, 0.5), 0, seed), sampleRate)
    tracker.reset()
    const readings = readingsOf(feed(tracker, synthesize(violinAt(440, 0.3), 1, seed), sampleRate))
    expect(readings[0]!.atMs).toBeLessThanOrEqual(150)
  })
})
