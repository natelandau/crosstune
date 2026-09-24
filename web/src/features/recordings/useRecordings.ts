import { useLiveQuery } from 'dexie-react-hooks'
import { activeRecordingsForTune } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording, LocalTune } from '../../db/types'

export interface RecordingView {
  recording: LocalRecording
  file: RecordingFile | undefined
  /** The recording's tune, when it still exists; null files a recording as unfiled
   * even if `recording.tune_id` still points at a tune deleted elsewhere. */
  tuneId: string | null
  tuneTitle: string | null
}

/** Live recordings with their local file, newest first, unfiled ones first. */
export function useRecordingsWithFiles({ tuneId }: { tuneId?: string } = {}):
  RecordingView[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const live = tuneId
      ? await activeRecordingsForTune(db, tuneId)
      : (await db.recordings.toArray()).filter((r) => !r.deleted_at)
    const files = await db.recording_files.bulkGet(live.map((r) => r.id))
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
    if (tuneId) return views
    // Parsed, not compared as text: a row written here and one pulled from the server spell
    // the same instant with different fractional-second precision.
    return views.sort((a, b) => {
      const unfiled = Number(!!a.tuneId) - Number(!!b.tuneId)
      return unfiled || Date.parse(b.recording.recorded_at) - Date.parse(a.recording.recorded_at)
    })
  }, [db, tuneId])
}
