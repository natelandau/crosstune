import { createContext, useContext } from 'react'

export interface TuneFormOptions {
  /** The title typed into a search, carried into a new tune. */
  initialTitle?: string
  /** The tune to edit; without one the form adds a tune. */
  tuneId?: string
  /** The list a new tune joins. */
  listId?: string
  /** The recording a new tune takes. */
  recordingId?: string
}

export interface TuneFormLauncher {
  open: (options: TuneFormOptions) => void
}

const NOTHING: TuneFormLauncher = { open: () => {} }

/** Provided by the tune form; until it is mounted, opening the form does nothing. */
export const TuneFormLauncherContext = createContext<TuneFormLauncher>(NOTHING)

export const TuneFormLauncherProvider = TuneFormLauncherContext.Provider

export function useTuneFormLauncher(): TuneFormLauncher {
  return useContext(TuneFormLauncherContext)
}
