import { useEffect } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { useAuthSession } from '../../auth/AuthContext'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { forgetDeletedAccount } from './deleteAccount'

/** Wipes this device's copy, as if it had made the delete, when another device deletes the account. */
export function useForgetAccountDeletedElsewhere(signOut: () => Promise<unknown>): void {
  const db = useDb()
  const engine = useSyncEngine()
  const { userId } = useAuthSession()
  const analytics = useAnalytics()
  useEffect(
    () =>
      engine.onAccountDeleted(
        () =>
          void forgetDeletedAccount({
            db,
            userId,
            engine,
            signOut: async () => void (await signOut()),
            analytics,
          }),
      ),
    [engine, db, userId, signOut, analytics],
  )
}
