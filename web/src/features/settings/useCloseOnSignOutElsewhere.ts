import { useEffect } from 'react'
import { isForgotten, onForgottenElsewhere } from '../../auth/session'
import { useAuthSession } from '../../auth/AuthContext'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'

/**
 * Closes this tab's database for good and stops sync when another tab signs this user out, so
 * neither a query nor a sync can recreate the database that sign-out deletes.
 */
export function useCloseOnSignOutElsewhere(): void {
  const db = useDb()
  const engine = useSyncEngine()
  const { userId } = useAuthSession()
  useEffect(() => {
    const close = () => {
      engine.stop()
      db.close()
    }
    // Dexie's own handler closes with auto-open on. Returning false skips it, so a delete that
    // reaches this tab before the storage event still leaves the database closed. An upgrade,
    // which has a new version, is left to Dexie.
    const onVersionChange = (event: IDBVersionChangeEvent) => {
      if (event.newVersion !== null || !isForgotten(userId)) return
      close()
      return false
    }
    db.on('versionchange', onVersionChange)
    const stopListening = onForgottenElsewhere(userId, close)
    return () => {
      stopListening()
      db.on('versionchange').unsubscribe(onVersionChange)
    }
  }, [db, engine, userId])
}
