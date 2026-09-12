import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { catalogEntries, type CatalogEntry } from './filters'

export function useCatalog(): CatalogEntry[] | undefined {
  const db = useDb()
  return useLiveQuery(
    async () => catalogEntries(await db.songs.toArray(), await db.user_songs.toArray()),
    [db],
  )
}
