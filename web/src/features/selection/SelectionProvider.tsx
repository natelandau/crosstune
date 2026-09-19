import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface SelectionChrome {
  /** True while a screen's own selection chrome stands in for the tab bar. */
  selecting: boolean
  /** A claim, not an assignment: every `true` is released by a matching `false`. */
  setSelecting: (next: boolean) => void
}

const SelectionContext = createContext<SelectionChrome | null>(null)

// This file pairs a provider component with its hook, the point of a context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useSelectionChrome(): SelectionChrome {
  const chrome = useContext(SelectionContext)
  if (!chrome) throw new Error('useSelectionChrome must be used inside SelectionProvider')
  return chrome
}

/**
 * One flag, held above the tab bar and the screens: whether the screen on top has put a
 * selection toolbar where the tab bar would be. The screen that selects never reads it, and
 * nothing outside the tab bar acts on it.
 *
 * It counts claims rather than holding a boolean, because an Ionic transition keeps the
 * outgoing page mounted beside the incoming one: for those few hundred milliseconds two
 * screens hold the flag, and the one leaving must not lower it under the one arriving.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState(0)
  const setSelecting = useCallback((next: boolean) => {
    setClaims((current) => Math.max(0, current + (next ? 1 : -1)))
  }, [])
  const value = useMemo<SelectionChrome>(
    () => ({ selecting: claims > 0, setSelecting }),
    [claims, setSelecting],
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}
