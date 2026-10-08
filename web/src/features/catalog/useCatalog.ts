import type { Table } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { catalogEntries, type HeardEntry } from './filters'

/**
 * The ids of tunes holding a live recording or link. The `tune_id` index skips unfiled
 * recordings, and `keys()` returns the index keys without building an array of rows.
 */
async function heardTuneIds(db: CrosstuneDb): Promise<Set<string>> {
  const live = (table: Table<{ deleted_at: string | null }, string>) =>
    table
      .where('tune_id')
      .above('')
      .filter((row) => !row.deleted_at)
      .keys() as Promise<string[]>
  const [recordings, links] = await Promise.all([live(db.recordings), live(db.recording_links)])
  return new Set([...recordings, ...links])
}

/**
 * Every tune with its user row, live. A screen that only needs the catalog some of the time,
 * such as one behind a closed sheet, passes false to stand the query down until it does.
 * `heard` is only read, and its tables only watched, when asked for; without it every entry
 * reads as unheard.
 */
export function useCatalog(enabled = true, { heard = false } = {}): HeardEntry[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!enabled) return undefined
    const [tunes, userTunes, heardIds] = await Promise.all([
      db.tunes.toArray(),
      db.user_tunes.toArray(),
      heard ? heardTuneIds(db) : undefined,
    ])
    return catalogEntries(tunes, userTunes, heardIds)
  }, [db, enabled, heard])
}
