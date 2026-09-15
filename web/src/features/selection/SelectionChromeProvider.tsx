import { useState, type ReactNode } from 'react'
import {
  SelectionChromeContext,
  SetSelectionChromeContext,
  type SelectionChrome,
} from './selectionChrome'

export function SelectionChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<SelectionChrome | null>(null)
  return (
    <SetSelectionChromeContext.Provider value={setChrome}>
      <SelectionChromeContext.Provider value={chrome}>{children}</SelectionChromeContext.Provider>
    </SetSelectionChromeContext.Provider>
  )
}
