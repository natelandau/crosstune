import { createContext, useContext, useSyncExternalStore } from 'react'

/** The row action that opens the recording screen. */
export const EDIT_RECORDING = 'Edit'

/** Speed and pitch the screen is playing but has not yet written; null where it matches the row. */
export interface HeldSettings {
  speedPercent: number | null
  pitchCents: number | null
  /** The musician's own settings on their way to the row, which the screen shows in its place;
   * false for a value only played, such as the trim view's 100%. */
  shown: boolean
}

export interface RecordingScreen {
  /**
   * Opens the recording screen for `id`, starting it in the player if it is not loaded.
   * `view` opens straight into that view rather than the recording's own.
   */
  open: (id: string, view?: 'practice') => void
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

/** The hold for `id`, re-rendering the caller whenever it changes. */
export function useHeldSettings(id: string): HeldSettings | null {
  const { held, subscribe } = useRecordingScreen()
  return useSyncExternalStore(subscribe, () => held(id))
}
