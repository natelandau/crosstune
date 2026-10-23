import { createContext } from 'react'
import type { DataRouter } from 'react-router'

/**
 * The app's own router. React commits a navigation in a transition, after the router has
 * moved, so a control that must answer to where the router is going reads it here.
 */
export const AppRouterContext = createContext<DataRouter | null>(null)
