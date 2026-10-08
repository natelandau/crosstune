import { createContext, useContext } from 'react'

export const RECORD_UNAVAILABLE = "Recording isn't available yet."

export interface RecordLauncher {
  /** Opens the recorder. A tune id files the recording under that tune. */
  start: (tuneId?: string) => void
  available: boolean
}

const UNAVAILABLE: RecordLauncher = { start: () => {}, available: false }

/** Provided by the recording feature; until it exists the controls read as unavailable. */
export const RecordLauncherContext = createContext<RecordLauncher>(UNAVAILABLE)

export function useRecordLauncher(): RecordLauncher {
  return useContext(RecordLauncherContext)
}
