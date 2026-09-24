import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { catalogEntries, type CatalogEntry } from './filters'

/**
 * Every tune with its user row, live. A screen that only needs the catalog some of the time,
 * such as one behind a closed sheet, passes false to stand the query down until it does.
 */
export function useCatalog(enabled = true): CatalogEntry[] | undefined {
  const db = useDb()
  return useLiveQuery(
    async () =>
      enabled ? catalogEntries(await db.tunes.toArray(), await db.user_tunes.toArray()) : undefined,
    [db, enabled],
  )
}
