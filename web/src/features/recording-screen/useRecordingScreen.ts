import { createContext, useContext } from 'react'

/** Speed and pitch the screen is playing but has not yet written; null where it matches the row. */
export interface HeldSettings {
  speedPercent: number | null
  pitchCents: number | null
  /** True for the trim view's hold. Time it plays is neither practice nor practice settings. */
  trimming: boolean
}

export interface RecordingScreen {
  /**
   * Opens the recording screen for `id`, starting it in the player if it is not loaded.
   */
  open: (id: string) => void
  close: () => void
  /**
   * What the screen plays for `id` ahead of the row, so a stored value landing late (its own
   * earlier write, say) never replaces what the musician is hearing. Null when nothing is held.
   */
  held: (id: string) => HeldSettings | null
  /** Records what the screen is playing ahead of the row for `id`; null lets go. */
  hold: (id: string, settings: HeldSettings | null) => void
  /** Calls `listener` whenever any hold changes; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
}

// A list or the dock rendered without the provider, as in a test that does not need the
// screen, gets a no-op rather than a throw.
const detached: RecordingScreen = {
  open: () => {},
  close: () => {},
  held: () => null,
  hold: () => {},
  subscribe: () => () => {},
}

export const RecordingScreenContext = createContext<RecordingScreen>(detached)

export function useRecordingScreen(): RecordingScreen {
  return useContext(RecordingScreenContext)
}
