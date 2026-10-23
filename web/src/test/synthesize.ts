import { seeded } from './random'

export interface ClipRecipe {
  id: string
  sampleRate: number
  seconds: number
  a4: number
  /** 0 for a clip with no tone. */
  f0: number
  /** `[harmonic, relativeAmplitude]`; a harmonic may be fractional, for an inharmonic string. */
  partials: [number, number][]
  amplitude: number
  /** Exponential time constant, or null for a sustained tone. */
  decaySeconds: number | null
  /** Peak level of uniform white noise. */
  noiseDbfs: number | null
  /**
   * Mains hum: `dbfs` is the peak level of a weight-1 partial, and `partials` are
   * `[harmonic, relativeAmplitude]` of `hz`, a lone fundamental when absent.
   */
  hum: { hz: number; dbfs: number; partials?: [number, number][] } | null
  vibrato?: { cents: number; hz: number }
  /** Null for a clip that must produce no reading. */
  expect: { name: string; octave: number; cents: number } | null
  lockWithinMs?: number
  /** Allowed distance of the median cents from `expect.cents`; 0.5 when absent, at most 1.5. */
  toleranceCents?: number
}

const level = (dbfs: number) => 10 ** (dbfs / 20)

/**
 * Renders a recipe sample by sample in double precision. The tone's phase is in cycles of `f0`
 * and accumulates `f(t) / sampleRate` each sample, so vibrato bends the frequency without the
 * runaway a `sin(2π·f(t)·t)` form gives. Noise is mulberry32 seeded with `seed + index`, one draw
 * per sample mapped to [-1, 1).
 */
export function synthesize(clip: ClipRecipe, index: number, seed: number): Float32Array {
  const n = Math.round(clip.seconds * clip.sampleRate)
  const out = new Float32Array(n)
  const random = seeded(seed + index)
  const noise = clip.noiseDbfs === null ? 0 : level(clip.noiseDbfs)
  const hum = clip.hum === null ? 0 : level(clip.hum.dbfs)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / clip.sampleRate
    let tone = 0
    for (const [harmonic, weight] of clip.partials) {
      tone += weight * Math.sin(2 * Math.PI * harmonic * phase)
    }
    const envelope = clip.decaySeconds === null ? 1 : Math.exp(-t / clip.decaySeconds)
    let sample = clip.amplitude * envelope * tone
    if (clip.hum !== null) {
      for (const [harmonic, weight] of clip.hum.partials ?? [[1, 1]]) {
        sample += hum * weight * Math.sin(2 * Math.PI * harmonic * clip.hum.hz * t)
      }
    }
    if (clip.noiseDbfs !== null) sample += noise * (2 * random() - 1)
    out[i] = sample
    const bend = clip.vibrato
      ? 2 ** ((clip.vibrato.cents * Math.sin(2 * Math.PI * clip.vibrato.hz * t)) / 1200)
      : 1
    phase += (clip.f0 * bend) / clip.sampleRate
  }
  return out
}
