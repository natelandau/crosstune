/**
 * Every tuned constant of the detector. The Swift twin in CrosstuneKit mirrors these names and
 * values, and both pass the clips in `fixtures/tuner/clips.json`.
 */
export const TRACKER = {
  /** Lowest pitch read, in Hz: below a five-string bass's low B. */
  minHz: 30,
  /** Highest pitch read, in Hz. */
  maxHz: 4200,
  /** Input kept for analysis, in seconds; at least the long window. */
  bufferSeconds: 0.17,
  /** New input between analyses, in seconds. */
  hopSeconds: 0.02,
  /** Window while unlocked or below `shortWindowMinHz`: several periods of a low E. */
  longWindowSeconds: 0.085,
  /** Window once locked at or above `shortWindowMinHz`, for a faster response. */
  shortWindowSeconds: 0.032,
  /** Smoothed pitch, in Hz, at or above which a locked tracker moves to the short window. */
  shortWindowMinHz: 200,
  /** Smoothed pitch, in Hz, below which it moves back to the long window. */
  longWindowBelowHz: 190,
  /** The first key maximum at least this fraction of the highest one is the period. */
  keyMaximumRatio: 0.9,
  /** How close, as a fraction of twice the chosen lag, a peak must be to count as its octave. */
  octaveLagTolerance: 0.03,
  /** How much higher than the chosen peak the peak at twice its lag must be to win. */
  octaveMargin: 0.05,
  /** Newton steps that polish the chosen peak's lag between samples. */
  refineSteps: 2,
  /** Lowest clarity that counts as a pitch. */
  minClarity: 0.85,
  /** Quietest window RMS analyzed, in dBFS. */
  minRmsDbfs: -42,
  /** Mains hum and its second harmonic, in Hz; an estimate this close to one is no note. */
  humRejectHz: [50, 60, 100, 120],
  /** Half-width, in Hz, of the band rejected around each `humRejectHz`. */
  humRejectWidthHz: 0.3,
  /** Estimates the median runs over. */
  medianCount: 3,
  /** Weight of each new median in the exponential average of cents. */
  smoothing: 0.35,
  /** An estimate this many cents from the average counts toward a snap. */
  snapCents: 15,
  /** Consecutive estimates past `snapCents` that snap the average to the newest; outlasts one vibrato swing. */
  snapCount: 3,
  /** Time without an estimate, in seconds, before the reading clears and the tracker unlocks. */
  holdSeconds: 0.2,
} as const
