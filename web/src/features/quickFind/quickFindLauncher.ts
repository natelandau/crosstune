import { createContext, useContext, type RefObject } from 'react'

export interface QuickFindLauncher {
  /** Shows Quick Find, or puts focus back in its field while it shows. */
  open: () => void
}

export interface QuickFindState extends QuickFindLauncher {
  shown: boolean
  close: () => void
  /** Quick Find's field, which a second open focuses. */
  fieldRef: RefObject<HTMLInputElement | null>
}

const NOTHING: QuickFindState = {
  open: () => {},
  close: () => {},
  shown: false,
  fieldRef: { current: null },
}

export const QuickFindContext = createContext<QuickFindState>(NOTHING)

export function useQuickFindLauncher(): QuickFindState {
  return useContext(QuickFindContext)
}
