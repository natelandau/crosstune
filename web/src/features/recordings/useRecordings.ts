import { useLiveQuery } from 'dexie-react-hooks'
import {
  activeRecordingsForTune,
  waitingParentIds,
  waitingParentIdsIn,
} from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import { holdsSplitAudio } from '../../domain/recordingLimits'
import type { RecordingFile } from '../../db/recordings'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalPlace, LocalRecording, LocalTune } from '../../db/types'
import { shownPlaceName } from './place'

export interface RecordingView {
  recording: LocalRecording
  file: RecordingFile | undefined
  /** The recording's tune, when it still exists; null files a recording as unfiled
   * even if `recording.tune_id` still points at a tune deleted elsewhere. */
  tuneId: string | null
  tuneTitle: string | null
  /** A piece split from the recording still waits for its cut and plays from its audio, so the
   * recording cannot be deleted. */
  holdsSplitAudio: boolean
  /**
   * The location name the recording shows: its saved location's while that is live, else its
   * own. Left unset by a view built without the saved locations.
   */
  shownPlace?: string | null
}

const isImported = (view: RecordingView) => view.recording.origin !== 'own'

/** `tune` is the recording's tune only while it is live. */
function buildRecordingView(
  recording: LocalRecording,
  {
    file,
    tune,
    waiting,
    places,
  }: {
    file: RecordingFile | undefined
    tune: LocalTune | undefined
    waiting: ReadonlySet<string>
    places: ReadonlyMap<string, LocalPlace>
  },
): RecordingView {
  return {
    recording,
    file,
    tuneId: tune?.id ?? null,
    tuneTitle: tune?.title ?? null,
    holdsSplitAudio: holdsSplitAudio(recording, waiting),
    shownPlace: shownPlaceName(recording, places),
  }
}

/** Live recordings with their local file: a tune's own recordings before its imported ones,
 * each in position order; every recording unordered for the caller to arrange. A caller that
 * needs no file data passes `withFiles: false`, so a live query skips `recording_files` and
 * does not re-run on every chunk, upload, and download write. */
export async function readRecordingsWithFiles(
  db: CrosstuneDb,
  { tuneId, withFiles = true }: { tuneId?: string; withFiles?: boolean } = {},
): Promise<RecordingView[]> {
  let live: LocalRecording[]
  let waiting: Set<string>
  if (tuneId) {
    live = await activeRecordingsForTune(db, tuneId)
    waiting = await waitingParentIds(db)
  } else {
    const all = await db.recordings.toArray()
    live = all.filter((r) => !r.deleted_at)
    waiting = waitingParentIdsIn(all)
  }
  const files = withFiles ? await db.recording_files.bulkGet(live.map((r) => r.id)) : []
  const wantedTuneIds = [...new Set(live.map((r) => r.tune_id).filter((s): s is string => !!s))]
  const places = new Map<string, LocalPlace>((await db.places.toArray()).map((p) => [p.id, p]))
  const tunes = await db.tunes.bulkGet(wantedTuneIds)
  const liveTunes = new Map(
    tunes.filter((s): s is LocalTune => !!s && !s.deleted_at).map((s) => [s.id, s] as const),
  )
  const views = live.map((recording, i) =>
    buildRecordingView(recording, {
      file: files[i],
      tune: recording.tune_id ? liveTunes.get(recording.tune_id) : undefined,
      waiting,
      places,
    }),
  )
  // Array.sort is stable, so each group keeps its position order.
  if (tuneId) return views.sort((a, b) => Number(isImported(a)) - Number(isImported(b)))
  return views
}

/**
 * One recording with its local file, as `readRecordingsWithFiles` reads each. Null once it is
 * gone.
 */
export async function readRecordingView(
  db: CrosstuneDb,
  id: string,
): Promise<RecordingView | null> {
  const [recording, file, waiting] = await Promise.all([
    db.recordings.get(id),
    db.recording_files.get(id),
    waitingParentIds(db),
  ])
  if (!recording || recording.deleted_at) return null
  const [tune, place] = await Promise.all([
    recording.tune_id ? db.tunes.get(recording.tune_id) : undefined,
    recording.place_id ? db.places.get(recording.place_id) : undefined,
  ])
  return buildRecordingView(recording, {
    file,
    tune: tune && !tune.deleted_at ? tune : undefined,
    waiting,
    places: new Map(place ? [[place.id, place]] : []),
  })
}

/** `readRecordingsWithFiles`, kept live. */
export function useRecordingsWithFiles({ tuneId }: { tuneId?: string } = {}):
  RecordingView[] | undefined {
  const db = useDb()
  return useLiveQuery(() => readRecordingsWithFiles(db, { tuneId }), [db, tuneId])
}
