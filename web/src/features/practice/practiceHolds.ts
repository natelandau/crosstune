import { createContext, useContext } from 'react'
import type { IsolateSetting } from '../player/isolate/isolateSetting'

/**
 * Speed, pitch, and isolate setting practice is playing but has not yet written; null where it
 * matches the row.
 */
export interface HeldSettings {
  speedPercent: number | null
  pitchCents: number | null
  isolate: IsolateSetting | null
  /** True for the trim view's hold. Time it plays is neither practice nor practice settings. */
  trimming: boolean
}

export interface PracticeHolds {
  /**
   * What practice plays for `id` ahead of the row, so a stored value landing late (its own
   * earlier write, say) never replaces what the musician is hearing. Null when nothing is held.
   */
  held: (id: string) => HeldSettings | null
  /** Records what practice is playing ahead of the row for `id`; null lets go. */
  hold: (id: string, settings: HeldSettings | null) => void
  /** Calls `listener` whenever any hold changes; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
}

// A list or the dock rendered without the provider, as in a test that does not need
// practice, gets a no-op rather than a throw.
export const DETACHED_PRACTICE_HOLDS: PracticeHolds = {
  held: () => null,
  hold: () => {},
  subscribe: () => () => {},
}

export const PracticeHoldsContext = createContext<PracticeHolds>(DETACHED_PRACTICE_HOLDS)

export function usePracticeHolds(): PracticeHolds {
  return useContext(PracticeHoldsContext)
}
