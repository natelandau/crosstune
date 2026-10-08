import { createContext, useContext } from 'react'

export interface ShortcutSheetLauncher {
  open: () => void
}

export interface ShortcutSheetState extends ShortcutSheetLauncher {
  /** Whether the sheet is asked to show. */
  shown: boolean
  close: () => void
}

const NOTHING: ShortcutSheetState = { open: () => {}, close: () => {}, shown: false }

export const ShortcutSheetContext = createContext<ShortcutSheetState>(NOTHING)

export function useShortcutSheet(): ShortcutSheetState {
  return useContext(ShortcutSheetContext)
}
