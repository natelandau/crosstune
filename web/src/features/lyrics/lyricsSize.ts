import { useSyncExternalStore } from 'react'
import { clamp } from '../../math'
import { createStoredValue, readStored } from '../../platform/storage'

export const LYRICS_STEPS = 6
export const DEFAULT_LYRICS_STEP = 4

// Per device, like appearance and the app's own text size, so it needs no account. The step is
// an absolute size rather than a multiplier on that setting: reading from a music stand is a
// different distance from browsing in the hand, so compounding the two would make one wrong.
export const LYRICS_SIZE_KEY = 'crosstune.lyricsSize'

function clampStep(step: number): number {
  // Math.round/max/min all propagate NaN, so an unclamped non-finite input would otherwise
  // reach storage and the DOM as the literal string "NaN", matching no CSS step.
  if (!Number.isFinite(step)) return DEFAULT_LYRICS_STEP
  return clamp(Math.round(step), 1, LYRICS_STEPS)
}

function parseStep(raw: string | null): number {
  const stored = Number(raw)
  return Number.isInteger(stored) && stored >= 1 && stored <= LYRICS_STEPS
    ? stored
    : DEFAULT_LYRICS_STEP
}

export function readLyricsStep(): number {
  return parseStep(readStored(LYRICS_SIZE_KEY))
}

const step = createStoredValue({ key: LYRICS_SIZE_KEY, parse: parseStep, serialize: String })

export function setLyricsStep(next: number): void {
  step.set(clampStep(next))
}

/**
 * Move the step by a delta, from whatever the store holds now. Two presses in one tick both
 * read the same rendered step, so a caller that adds to its own copy loses the first press.
 */
export function stepLyricsSize(by: number): number {
  setLyricsStep(step.get() + by)
  return step.get()
}

export function useLyricsStep(): number {
  return useSyncExternalStore(step.subscribe, step.get)
}
