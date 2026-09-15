import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'

export interface SelectionChrome {
  bar: ReactNode
  actions: ReactNode
}

export const SetSelectionChromeContext = createContext<(chrome: SelectionChrome | null) => void>(
  () => {},
)
export const SelectionChromeContext = createContext<SelectionChrome | null>(null)

/** Publish a screen's selection bars to the app bar and Dock, or null to show the normal bars. */
export function useSelectionChrome(chrome: SelectionChrome | null): void {
  const setChrome = useContext(SetSelectionChromeContext)
  useLayoutEffect(() => {
    setChrome(chrome)
  }, [setChrome, chrome])
  useLayoutEffect(() => () => setChrome(null), [setChrome])
}

/** The published bars, holding the last content after it is withdrawn so the bars can animate out. */
export function useShownChrome(): { active: boolean; bar: ReactNode; actions: ReactNode } {
  const chrome = useContext(SelectionChromeContext)
  const [last, setLast] = useState<SelectionChrome | null>(chrome)
  if (chrome !== null && chrome !== last) setLast(chrome)
  const shown = chrome ?? last
  return { active: chrome !== null, bar: shown?.bar ?? null, actions: shown?.actions ?? null }
}
