import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { DbContext } from '../db/DbProvider'
import type { CrosstuneDb } from '../db/schema'
import { SyncContext } from '../sync/SyncProvider'
import type { SyncEngine } from '../sync/types'

export function fakeEngine(overrides: Partial<SyncEngine> = {}): SyncEngine {
  return {
    sync: async () => {},
    status: () => 'idle',
    lastSyncedAt: () => null,
    subscribe: () => () => {},
    resolveLink: async () => null,
    stop: () => {},
    resume: () => {},
    ...overrides,
  }
}

export function renderWithProviders(
  ui: ReactElement,
  {
    db,
    engine = fakeEngine(),
    path = '/',
  }: { db: CrosstuneDb; engine?: SyncEngine; path?: string },
) {
  const rootRoute = createRootRoute({
    component: () => (
      <DbContext.Provider value={db}>
        <SyncContext.Provider value={engine}>
          <Outlet />
        </SyncContext.Provider>
      </DbContext.Provider>
    ),
  })
  const page = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => ui })
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return render(<RouterProvider router={router} />)
}
