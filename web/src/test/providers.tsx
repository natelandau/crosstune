import type { ReactElement, ReactNode } from 'react'
import { AuthProvider, type AuthSession } from '../auth/AuthContext'
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

export interface ProviderOptions {
  db: CrosstuneDb
  engine?: SyncEngine
  session?: AuthSession
}

/**
 * The data a hook or component reads from context, with no router and no Ionic. Pass it to
 * `renderHook` or `render` as `wrapper`.
 */
export function dataProviders({
  db,
  engine = fakeEngine(),
  session = testSession,
}: ProviderOptions): ({ children }: { children: ReactNode }) => ReactElement {
  return function Providers({ children }) {
    return (
      <AuthProvider value={session}>
        <DbContext.Provider value={db}>
          <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>
        </DbContext.Provider>
      </AuthProvider>
    )
  }
}
