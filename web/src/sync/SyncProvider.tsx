import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createApiClient } from '../api/client'
import { useAuthSession } from '../auth/AuthContext'
import { useDb } from '../db/DbProvider'
import { APP_VERSION } from '../version'
import { createSyncEngine } from './engine'
import { startSyncTriggers } from './triggers'
import type { SyncEngine, SyncStatus } from './types'

// Exported so tests can inject a fake engine without going through SyncProvider.
// eslint-disable-next-line react-refresh/only-export-components
export const SyncContext = createContext<SyncEngine | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useDb()
  const { getToken } = useAuthSession()
  const engine = useMemo(
    () =>
      createSyncEngine({
        db,
        api: createApiClient({
          baseUrl: '',
          getToken,
          clientVersion: APP_VERSION,
        }),
      }),
    [db, getToken],
  )
  useEffect(() => {
    engine.resume()
    const stopTriggers = startSyncTriggers(engine, db)
    return () => {
      stopTriggers()
      engine.stop()
    }
  }, [engine, db])
  return <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>
}

// This file pairs a provider component with its hooks, the point of a context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useSyncEngine(): SyncEngine {
  const engine = useContext(SyncContext)
  if (!engine) throw new Error('useSyncEngine must be used inside SyncProvider')
  return engine
}

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncStatus(): SyncStatus {
  const engine = useSyncEngine()
  const status = useSyncExternalStore(engine.subscribe, engine.status)
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  return online ? status : 'offline'
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLastSyncedAt(): string | null {
  const engine = useSyncEngine()
  return useSyncExternalStore(engine.subscribe, engine.lastSyncedAt)
}
