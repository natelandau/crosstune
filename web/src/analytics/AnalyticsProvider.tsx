import { createContext, useContext, type ReactNode } from 'react'
import { noopAnalytics, type AnalyticsClient } from './client'

const AnalyticsContext = createContext<AnalyticsClient>(noopAnalytics)

export function AnalyticsProvider({
  client,
  children,
}: {
  client: AnalyticsClient
  children: ReactNode
}) {
  return <AnalyticsContext value={client}>{children}</AnalyticsContext>
}

/** The analytics client, which does nothing in a tree with no provider. */
// A context module pairs its provider component with the hook that reads it.
// eslint-disable-next-line react-refresh/only-export-components
export function useAnalytics(): AnalyticsClient {
  return useContext(AnalyticsContext)
}
