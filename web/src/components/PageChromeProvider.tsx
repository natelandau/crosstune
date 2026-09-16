import { useState, type ReactNode } from 'react'
import { PageActionsContext, SetPageActionsContext } from './pageChrome'

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null)
  return (
    <SetPageActionsContext.Provider value={setActions}>
      <PageActionsContext.Provider value={actions}>{children}</PageActionsContext.Provider>
    </SetPageActionsContext.Provider>
  )
}
