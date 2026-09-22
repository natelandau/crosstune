import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createApiClient } from '../api/client'
import { useAuthSession } from '../auth/AuthContext'
import { API_ORIGIN } from '../config'
import { useDb } from '../db/DbProvider'
import { APP_VERSION } from '../version'
import { createSyncEngine } from './engine'
import { startSyncTriggers } from './triggers'
import type { SyncEngine, SyncStatus, TransferStatus } from './types'

// Exported so tests can inject a fake engine without going through SyncProvider.
// eslint-disable-next-line react-refresh/only-export-components
export const SyncContext = createContext<SyncEngine | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useDb()
  const { getToken, offline } = useAuthSession()
  const engine = useMemo(
    () =>
      createSyncEngine({
        db,
        api: createApiClient({
          baseUrl: API_ORIGIN,
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
  // A session admitted without Clerk has no token, so every run until Clerk loads fails as
  // offline and the engine sits in its backoff, which can hold the first real sync for a minute.
  const wasOffline = useRef(offline)
  useEffect(() => {
    if (wasOffline.current && !offline) void engine.sync()
    wasOffline.current = offline
  }, [engine, offline])
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
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine)
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncStatus(): SyncStatus {
  const engine = useSyncEngine()
  const status = useSyncExternalStore(engine.subscribe, engine.status)
  return useOnline() ? status : 'offline'
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTransferStatus(): TransferStatus {
  const engine = useSyncEngine()
  const status = useSyncExternalStore(engine.subscribeTransfer, engine.transferStatus)
  return useOnline() ? status : 'offline'
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLastSyncedAt(): string | null {
  const engine = useSyncEngine()
  return useSyncExternalStore(engine.subscribe, engine.lastSyncedAt)
}
