import {
  createMemoryHistory,
  type RouterHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { StrictMode, type ReactElement } from 'react'
import { AuthProvider, type AuthSession } from '../auth/AuthContext'
import { PageChromeProvider } from '../components/PageChromeProvider'
import { ToastProvider } from '../components/Toast'
import { DbContext } from '../db/DbProvider'
import type { CrosstuneDb } from '../db/schema'
import { routeTree } from '../routeTree.gen'
import { SyncContext } from '../sync/SyncProvider'
import type { SyncEngine } from '../sync/types'

export function fakeEngine(overrides: Partial<SyncEngine> = {}): SyncEngine {
  return {
    sync: async () => {},
    status: () => 'idle',
    lastSyncedAt: () => null,
    subscribe: () => () => {},
    transfer: async () => {},
    transferStatus: () => 'idle',
    subscribeTransfer: () => () => {},
    resolveLink: async () => null,
    download: async () => null,
    retry: async () => {},
    stop: () => {},
    resume: () => {},
    ...overrides,
  }
}

/** A signed-in, online session for tests that do not care who is signed in. */
export const testSession: AuthSession = {
  userId: 'user_1',
  getToken: async () => 't',
  offline: false,
}

export function renderWithProviders(
  ui: ReactElement,
  {
    db,
    engine = fakeEngine(),
    path = '/',
    session = testSession,
  }: { db: CrosstuneDb; engine?: SyncEngine; path?: string; session?: AuthSession },
) {
  const rootRoute = createRootRoute({
    component: () => (
      <AuthProvider value={session}>
        <DbContext.Provider value={db}>
          <SyncContext.Provider value={engine}>
            <ToastProvider>
              <PageChromeProvider>
                <Outlet />
              </PageChromeProvider>
            </ToastProvider>
          </SyncContext.Provider>
        </DbContext.Provider>
      </AuthProvider>
    ),
  })
  const page = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => ui })
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return { ...render(<RouterProvider router={router} />), router }
}

/** Renders the real route tree, for tests that navigate between screens. */
export function renderApp({
  db,
  path = '/',
  history = createMemoryHistory({ initialEntries: [path] }),
  engine = fakeEngine(),
  session = testSession,
  strict = false,
}: {
  db: CrosstuneDb
  path?: string
  history?: RouterHistory
  engine?: SyncEngine
  session?: AuthSession
  /** Render inside StrictMode, which double-invokes effects the way the app's dev build does. */
  strict?: boolean
}) {
  const router = createRouter({ routeTree, history })
  const app = (
    <AuthProvider value={session}>
      <DbContext.Provider value={db}>
        <SyncContext.Provider value={engine}>
          <RouterProvider router={router} />
        </SyncContext.Provider>
      </DbContext.Provider>
    </AuthProvider>
  )
  const view = render(strict ? <StrictMode>{app}</StrictMode> : app)
  return { router, unmount: view.unmount }
}
