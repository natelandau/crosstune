import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLoop } from '../../db/types'

/** The recording's live loops in timeline order; undefined until the first read. */
export function useLoops(recordingId: string): LocalRecordingLoop[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const rows = await db.recording_loops.where('recording_id').equals(recordingId).toArray()
    return rows
      .filter((l) => !l.deleted_at)
      .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms)
  }, [db, recordingId])
}
