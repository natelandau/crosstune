import * as Sentry from '@sentry/react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { countBucket } from '../../usage/buckets'
import { activeItems, deleteList, removeFromList } from '../../commands/lists'
import { useDb } from '../../db/DbProvider'

export interface ListActions {
  /** Deletes the list, reporting it with how many tunes it held. */
  remove: (listId: string) => Promise<void>
  /** Takes one tune out of a list, reporting it and resolving to what puts it back. */
  removeItem: (listId: string, itemId: string) => Promise<() => Promise<void>>
}

/** The writes the list screens share, with the reports they owe. */
export function useListActions(): ListActions {
  const db = useDb()
  const analytics = useAnalytics()
  return {
    remove: async (listId) => {
      // Counted first, because the delete tombstones every item. A failed read costs the
      // report, never the delete.
      const size = await activeItems(db, listId).then(
        (items) => items.length,
        (error: unknown) => {
          Sentry.captureException(error)
          return null
        },
      )
      await deleteList(db, listId)
      if (size === null) return
      analytics.send('list_deleted', { list_id: listId, count_bucket: countBucket(size) })
    },
    removeItem: async (listId, itemId) => {
      const undo = await removeFromList(db, itemId)
      analytics.send('tunes_removed_from_list', { list_id: listId, count_bucket: countBucket(1) })
      return undo
    },
  }
}
