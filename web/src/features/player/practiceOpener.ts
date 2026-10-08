import { createContext, useContext } from 'react'

/** Opens practice for a loaded recording. */
export type OpenPractice = (recordingId: string) => void

/**
 * What a press on the now-playing bar, or its Expand, calls. Null while no practice is
 * mounted, which leaves the bar's body inert and Expand disabled.
 */
export const PracticeOpenerContext = createContext<OpenPractice | null>(null)

export function useOpenPractice(): OpenPractice | null {
  return useContext(PracticeOpenerContext)
}
