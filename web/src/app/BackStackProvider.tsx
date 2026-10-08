import { useEffect, type ReactNode } from 'react'
import { installBackHandler, webBackAdapter, type BackAdapter } from '../platform/backHandler'
import { readBackEntries } from '../ui/backEntries'

/**
 * Answers the device's back from the app's back stack: the top overlay, then the top screen
 * state, then history. Mounted once, at the app's root. The web adapter never hears a press,
 * since the browser's own back is history and Escape closes overlays.
 */
export function BackStackProvider({
  adapter = webBackAdapter,
  children,
}: {
  adapter?: BackAdapter
  children: ReactNode
}) {
  useEffect(() => installBackHandler(adapter, readBackEntries), [adapter])
  return children
}
