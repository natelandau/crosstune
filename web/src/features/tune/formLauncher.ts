import { createContext, useContext } from 'react'

export interface TuneFormOptions {
  /** The tune to edit. */
  tuneId: string
  /** The field that takes focus as the form opens, in place of the title. */
  focus?: 'lyrics'
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
