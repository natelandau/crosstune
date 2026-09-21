import { useSyncExternalStore } from 'react'

export const LYRICS_STEPS = 6
export const DEFAULT_LYRICS_STEP = 4

// Per device, like appearance and the app's own text size, so it needs no account. The step is
// an absolute size rather than a multiplier on that setting: reading from a music stand is a
// different distance from browsing in the hand, so compounding the two would make one wrong.
export const LYRICS_SIZE_KEY = 'crosstune.lyricsSize'

function clamp(step: number): number {
  // Math.round/max/min all propagate NaN, so an unclamped non-finite input would otherwise
  // reach storage and the DOM as the literal string "NaN", matching no CSS step.
  if (!Number.isFinite(step)) return DEFAULT_LYRICS_STEP
  return Math.min(LYRICS_STEPS, Math.max(1, Math.round(step)))
}

export function readLyricsStep(): number {
  try {
    const stored = Number(localStorage.getItem(LYRICS_SIZE_KEY))
    return Number.isInteger(stored) && stored >= 1 && stored <= LYRICS_STEPS
      ? stored
      : DEFAULT_LYRICS_STEP
  } catch {
    return DEFAULT_LYRICS_STEP
  }
}

// Storage is read once. After that the value in memory is what the screen shows, so a step
// chosen while storage is blocked still reads as chosen until the page reloads.
let step: number | undefined

function current(): number {
  return (step ??= readLyricsStep())
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setLyricsStep(next: number): void {
  step = clamp(next)
  try {
    localStorage.setItem(LYRICS_SIZE_KEY, String(step))
  } catch {
    // Private mode or blocked storage: the step still applies until the page reloads.
  }
  for (const listener of listeners) listener()
}

/**
 * Move the step by a delta, from whatever the store holds now. Two presses in one tick both
 * read the same rendered step, so a caller that adds to its own copy loses the first press.
 */
export function stepLyricsSize(by: number): number {
  setLyricsStep(current() + by)
  return current()
}

export function useLyricsStep(): number {
  return useSyncExternalStore(subscribe, current)
}
