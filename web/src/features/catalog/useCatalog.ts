import type { Table } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { catalogEntries } from './filters'
import type { CatalogEntry, CatalogEntryWithAudio } from '../../db/types'

/**
 * The ids of tunes holding a live recording or link. The `tune_id` index skips unfiled
 * recordings, and `keys()` returns the index keys without building an array of rows.
 */
async function tuneIdsWithAudio(db: CrosstuneDb): Promise<Set<string>> {
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
 * such as one behind a closed sheet, passes false to pause the query until it does.
 * Recordings and links are only read, and their tables only watched, with `withAudio`; without
 * it, entries carry no audio field.
 */
export function useCatalog(
  enabled: boolean,
  options: { withAudio: true },
): CatalogEntryWithAudio[] | undefined
export function useCatalog(enabled?: boolean): CatalogEntry[] | undefined
export function useCatalog(enabled = true, { withAudio = false } = {}): CatalogEntry[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!enabled) return undefined
    const [tunes, userTunes, idsWithAudio] = await Promise.all([
      db.tunes.toArray(),
      db.user_tunes.toArray(),
      withAudio ? tuneIdsWithAudio(db) : undefined,
    ])
    return idsWithAudio
      ? catalogEntries(tunes, userTunes, idsWithAudio)
      : catalogEntries(tunes, userTunes)
  }, [db, enabled, withAudio])
}
