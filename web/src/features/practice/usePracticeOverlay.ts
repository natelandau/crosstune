import { createContext, useContext } from 'react'

/** Speed and pitch practice is playing but has not yet written; null where it matches the row. */
export interface HeldSettings {
  speedPercent: number | null
  pitchCents: number | null
  /** True for the trim view's hold. Time it plays is neither practice nor practice settings. */
  trimming: boolean
}

export interface PracticeOverlayHandle {
  /**
   * Opens practice for `id`, starting it in the player if it is not loaded.
   */
  open: (id: string) => void
  close: () => void
  /**
   * What practice plays for `id` ahead of the row, so a stored value landing late (its own
   * earlier write, say) never replaces what the musician is hearing. Null when nothing is held.
   */
  held: (id: string) => HeldSettings | null
  /** Records what practice is playing ahead of the row for `id`; null lets go. */
  hold: (id: string, settings: HeldSettings | null) => void
  /**
   * Holds a playing list at `id`'s natural end while a sheet over practice edits it, so the
   * list never moves practice, and the sheet with it, on to another recording. False lets go.
   */
  holdEnd: (id: string, holding: boolean) => void
  /** Calls `listener` whenever any hold changes; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
}

// A list or the dock rendered without the provider, as in a test that does not need
// practice, gets a no-op rather than a throw.
const detached: PracticeOverlayHandle = {
  open: () => {},
  close: () => {},
  held: () => null,
  hold: () => {},
  holdEnd: () => {},
  subscribe: () => () => {},
}

export const PracticeOverlayContext = createContext<PracticeOverlayHandle>(detached)

export function usePracticeOverlay(): PracticeOverlayHandle {
  return useContext(PracticeOverlayContext)
}

/**
 * The recording practice shows. The id outlives `open` through the closing animation, so
 * practice does not empty before it leaves. Each open counts up, so opening again starts
 * practice afresh when it keys on `opening`.
 */
export interface ShownRecording {
  id: string
  open: boolean
  opening: number
}

export interface PracticeOverlayShown {
  shown: ShownRecording | null
  /**
   * Practice has finished leaving: forgets it and returns focus to the control that opened
   * it. Practice opened again while it was still leaving keeps that newer open.
   */
  dismissed: () => void
}

// Apart from practice's own context, so a hold's readers do not re-render on every open.
export const PracticeOverlayShownContext = createContext<PracticeOverlayShown>({
  shown: null,
  dismissed: () => {},
})

export function usePracticeOverlayShown(): PracticeOverlayShown {
  return useContext(PracticeOverlayShownContext)
}
