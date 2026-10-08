import { useMemo, useState, type ReactNode } from 'react'
import { createSearchTargets, SearchTargetContext } from './searchTarget'
import {
  ShortcutSheetContext,
  type ShortcutSheetState,
  type ShortcutSheetLauncher,
} from './shortcutSheetLauncher'
import { useShortcuts } from './useShortcuts'

/** Runs the single-key shortcuts and holds the slot each screen registers its search in. */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [targets] = useState(createSearchTargets)
  useShortcuts(targets.focus)
  return <SearchTargetContext.Provider value={targets}>{children}</SearchTargetContext.Provider>
}

/** Whether the shortcut sheet shows, and the `?` shortcut's way to show it. */
export function ShortcutSheetProvider({
  launcher,
  children,
}: {
  /** Stands in for the sheet, for a test that watches what opens it. */
  launcher?: ShortcutSheetLauncher
  children: ReactNode
}) {
  const [shown, setShown] = useState(false)
  const sheet = useMemo<ShortcutSheetState>(
    () => ({
      shown,
      open: launcher?.open ?? (() => setShown(true)),
      close: () => setShown(false),
    }),
    [launcher, shown],
  )
  return <ShortcutSheetContext.Provider value={sheet}>{children}</ShortcutSheetContext.Provider>
}
