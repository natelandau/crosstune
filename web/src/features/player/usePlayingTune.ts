import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { usePlayer } from './usePlayer'

/** The tune whose recording or link the player has loaded, or null. */
export function usePlayingTune(): string | null {
  const db = useDb()
  const { item } = usePlayer()
  const read = useLiveQuery(async () => {
    if (item === null) return null
    const row =
      item.kind === 'recording'
        ? await db.recordings.get(item.id)
        : await db.recording_links.get(item.id)
    return { item, tuneId: row && !row.deleted_at ? row.tune_id : null }
  }, [db, item])
  // A read for the item before is never taken as the answer for the one loaded now.
  return read?.item === item ? (read.tuneId ?? null) : null
}
