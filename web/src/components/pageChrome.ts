import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react'

export const SetPageActionsContext = createContext<(node: ReactNode) => void>(() => {})
export const PageActionsContext = createContext<ReactNode>(null)

/**
 * Publish trailing controls for the app bar while the calling page is mounted.
 *
 * The caller must memoize the node with `useMemo`, because publishing it re-renders the app
 * bar, and a fresh element on every render would publish again from inside that render pass.
 */
export function usePageActions(node: ReactNode): void {
  const setActions = useContext(SetPageActionsContext)
  useLayoutEffect(() => {
    setActions(node)
  }, [setActions, node])
  useLayoutEffect(() => () => setActions(null), [setActions])
}

export function useShownPageActions(): ReactNode {
  return useContext(PageActionsContext)
}
