import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router'
import { ShortcutsProvider } from '../features/keyboard/ShortcutsProvider'
import { PracticeOverlay } from '../features/practice/PracticeOverlay'
import { RecordSheet } from '../features/recording/RecordSheet'
import { Shell } from './Shell'
import { routes } from './routes'

// The shell wraps every route here, not in `routes`, so route tests need no shell. Practice
// wraps the shell, so the bar reaches its opener and practice reaches the router. The record
// sheet sits here too, so it can navigate and hold the browser's back, and the shortcuts, so
// they can navigate and reach each screen's search.
const shelled: RouteObject[] = [
  {
    element: (
      <ShortcutsProvider>
        <PracticeOverlay>
          <Shell />
          <RecordSheet />
        </PracticeOverlay>
      </ShortcutsProvider>
    ),
    children: routes,
  },
]

export interface AppRouterOptions {
  /** Present in tests: the router then lives in memory instead of the address bar. */
  initialEntries?: string[]
}

export function createAppRouter({ initialEntries }: AppRouterOptions = {}) {
  if (initialEntries) return createMemoryRouter(shelled, { initialEntries })
  return createBrowserRouter(shelled)
}

export type AppRouter = ReturnType<typeof createAppRouter>
