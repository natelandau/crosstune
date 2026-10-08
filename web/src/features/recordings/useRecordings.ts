import { useLiveQuery } from 'dexie-react-hooks'
import { activeRecordingsForTune } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecording, LocalTune } from '../../db/types'

export interface RecordingView {
  recording: LocalRecording
  file: RecordingFile | undefined
  /** The recording's tune, when it still exists; null files a recording as unfiled
   * even if `recording.tune_id` still points at a tune deleted elsewhere. */
  tuneId: string | null
  tuneTitle: string | null
}

const isImported = (view: RecordingView) => view.recording.origin !== 'own'

/** Live recordings with their local file: a tune's own recordings before its imported ones,
 * each in position order; every recording unordered for the caller to arrange. A caller that
 * needs no file data passes `withFiles: false`, so a live query skips `recording_files` and
 * does not re-run on every chunk, upload, and download write. */
export async function readRecordingsWithFiles(
  db: CrosstuneDb,
  { tuneId, withFiles = true }: { tuneId?: string; withFiles?: boolean } = {},
): Promise<RecordingView[]> {
  const live = tuneId
    ? await activeRecordingsForTune(db, tuneId)
    : (await db.recordings.toArray()).filter((r) => !r.deleted_at)
  const files = withFiles ? await db.recording_files.bulkGet(live.map((r) => r.id)) : []
  const wantedTuneIds = [...new Set(live.map((r) => r.tune_id).filter((s): s is string => !!s))]
  const tunes = await db.tunes.bulkGet(wantedTuneIds)
  const liveTunes = new Map(
    tunes.filter((s): s is LocalTune => !!s && !s.deleted_at).map((s) => [s.id, s] as const),
  )
  const views = live.map((recording, i) => {
    const tune = recording.tune_id ? liveTunes.get(recording.tune_id) : undefined
    return {
      recording,
      file: files[i],
      tuneId: tune?.id ?? null,
      tuneTitle: tune?.title ?? null,
    }
  })
  // Array.sort is stable, so each group keeps its position order.
  if (tuneId) return views.sort((a, b) => Number(isImported(a)) - Number(isImported(b)))
  return views
}

/** `readRecordingsWithFiles`, kept live. */
export function useRecordingsWithFiles({ tuneId }: { tuneId?: string } = {}):
  RecordingView[] | undefined {
  const db = useDb()
  return useLiveQuery(() => readRecordingsWithFiles(db, { tuneId }), [db, tuneId])
}
