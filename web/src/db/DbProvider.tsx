import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { openDatabase, type CrosstuneDb } from './schema'

// Exported so tests can inject a database without going through DbProvider.
// eslint-disable-next-line react-refresh/only-export-components
export const DbContext = createContext<CrosstuneDb | null>(null)

export function DbProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const db = useMemo(() => openDatabase(userId), [userId])
  // Dexie reopens a closed database on its next operation, so a StrictMode
  // remount after this cleanup still works.
  useEffect(() => () => db.close(), [db])
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}

// This file pairs a provider component with its hook, the point of a context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useDb(): CrosstuneDb {
  const db = useContext(DbContext)
  if (!db) throw new Error('useDb must be used inside DbProvider')
  return db
}
