export type NoteName = 'C' | 'C♯' | 'D' | 'D♯' | 'E' | 'F' | 'F♯' | 'G' | 'G♯' | 'A' | 'A♯' | 'B'

export interface Note {
  name: NoteName
  octave: number
  /** Offset from the nearest equal-tempered note, -50 to 50. */
  cents: number
}

/** Where a note sits: inside the target zone, just outside it, or far off. */
export type TuneStep = 'zone' | 'close' | 'far'

const NAMES: readonly NoteName[] = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

const A4_MIDI = 69

/** The furthest off, in cents either way, a note counts as in tune. */
const IN_TUNE_CENTS = 3
/** The target zone's reach, in cents either way, inside which a note turns toward in tune. */
export const ZONE_CENTS = 10
/** The furthest off, in cents either way, a note outside the zone counts as close. */
const CLOSE_CENTS = 15

/** The nearest note to `frequency`, null when the frequency or `a4` is not a positive number. */
export function noteFor(frequency: number, a4: number): Note | null {
  const midi = A4_MIDI + 12 * Math.log2(frequency / a4)
  if (!Number.isFinite(midi)) return null
  const nearest = Math.round(midi)
  const pitchClass = ((nearest % 12) + 12) % 12
  return {
    name: NAMES[pitchClass]!,
    octave: Math.floor(nearest / 12) - 1,
    cents: (midi - nearest) * 100,
  }
}

/**
 * `cents` to the tenth the tuner shows. Every check below judges this, so what shows and what is
 * judged agree. Halves round up, as `Math.round` does.
 */
export function tenths(cents: number): number {
  return Math.round(cents * 10) / 10
}

export function tuneStep(cents: number): TuneStep {
  const off = Math.abs(tenths(cents))
  if (off <= ZONE_CENTS) return 'zone'
  return off <= CLOSE_CENTS ? 'close' : 'far'
}

export function isInTune(cents: number): boolean {
  return Math.abs(tenths(cents)) <= IN_TUNE_CENTS
}

/**
 * How far a note `cents` off has come toward in tune: 0 outside the target zone, 1 in tune, and
 * rising evenly between, so a peg turn inside the zone shows as steady progress.
 */
export function greenness(cents: number): number {
  const off = Math.abs(tenths(cents))
  return Math.min(1, Math.max(0, (ZONE_CENTS - off) / (ZONE_CENTS - IN_TUNE_CENTS)))
}

export type TuneHint = 'flat' | 'sharp'

/** Which way a note is off, or null when it is in tune. */
export function tuneHint(cents: number): TuneHint | null {
  const shown = tenths(cents)
  if (shown < -IN_TUNE_CENTS) return 'flat'
  return shown > IN_TUNE_CENTS ? 'sharp' : null
}
