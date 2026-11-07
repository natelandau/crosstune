import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router'
import { ShortcutsProvider } from '../features/keyboard/ShortcutsProvider'
import { RecordingPageOpener } from '../features/recording/RecordingPageOpener'
import { RecordSheet } from '../features/capture/RecordSheet'
import { Shell } from './Shell'
import { routes } from './routes'

// The shell wraps every route here, not in `routes`, so route tests need no shell. The recording
// page's opener wraps the shell, so the bars and a tune's Practice reach it and it reaches the
// router. The record sheet sits here too, so it can navigate and hold the browser's back, and the
// shortcuts, so they can navigate and reach each screen's search.
const shellRoutes: RouteObject[] = [
  {
    element: (
      <ShortcutsProvider>
        <RecordingPageOpener>
          <Shell />
          <RecordSheet />
        </RecordingPageOpener>
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
  if (initialEntries) return createMemoryRouter(shellRoutes, { initialEntries })
  return createBrowserRouter(shellRoutes)
}

export type AppRouter = ReturnType<typeof createAppRouter>
