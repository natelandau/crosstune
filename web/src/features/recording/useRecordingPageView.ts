import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { waitingParentIds } from '../../commands/recordings'
import { useRecordingsPlayable } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import { holdsSplitAudio } from '../../domain/recordingLimits'
import { liveTune } from '../../db/tunes'
import { useSyncEngine } from '../../sync/SyncProvider'
import { loadAudioFile } from '../player/playbackWindow'
import { formatDuration, recordingDateLabel } from '../../text/format'
import { recordingTitle } from '../recordings/recordingRow'
import { LocationState, type PlacePoint } from '../recordings/stagedPlace'
import type { RecordingView } from '../recordings/useRecordings'
import { shownPeaks, trimmedLengthMs, type ShownPeaks } from '../practice/recordingRange'
import { TRIM_CHANGED_ELSEWHERE } from '../practice/trimViewCopy'
import { useAudioFetch, type AudioFetch } from '../practice/practiceAvailability'

/** The views that show in place of the page's own content. */
export type RecordingEditorKind = 'trim' | 'split'

/** What the page shows: its own content, or the trim or split view in its place. */
export type RecordingPageShows = 'main' | RecordingEditorKind

/** Where the recording was made, as the map under its Location row shows it. */
export interface RecordingLocation {
  point: PlacePoint
  /** A saved location's address, when it says more than the name. */
  address: string | null
}

export interface RecordingPageView {
  /** The recording and its tune, or null until the row is read and once it is gone. */
  view: RecordingView | null
  /** True once the row has read as gone, deleted here or on another device. */
  missing: boolean
  /** The tune's own name, not the row's heading, so a tune is never dropped. Empty until read. */
  title: string
  /** When it was recorded and how long it plays. Empty until read. */
  subtitle: string
  /** The peaks for the trimmed range, or null when there are none that line up. */
  peaks: ShownPeaks | null
  rowLengthMs: number
  audio: AudioFetch
  shows: RecordingPageShows
  /** Shows the trim or split view, clearing any notice an earlier one left. */
  openEditor: (kind: RecordingEditorKind) => void
  leaveEditor: () => void
  /** Leaves the trim or split view because a trim written elsewhere replaced the one being edited. */
  trimmedElsewhere: () => void
  trimNotice: string | null
  /** Practice's own error. A caller shows its recording actions' error ahead of it. */
  error: string | null
  setError: (error: string | null) => void
  /** Where the recording was made: its own point, else its saved location's. Null with neither. */
  location: RecordingLocation | null
}

/**
 * The recording page's state for recording `id`: the row and its tune, what the header reads,
 * the waveform's peaks, the state of the audio, and which view shows. Mount it keyed on each
 * open, so a fresh open starts on the page's own content.
 */
export function useRecordingPageView(id: string): RecordingPageView {
  const db = useDb()
  const syncEngine = useSyncEngine()
  // One read of the row with its file, so a trim never pairs a new row with an old file.
  const loaded = useLiveQuery(async () => {
    const [read, waiting] = await Promise.all([db.recordings.get(id), waitingParentIds(db)])
    const recording = read ?? null
    const [tune, place, file] = await Promise.all([
      recording?.tune_id ? db.tunes.get(recording.tune_id) : null,
      recording?.place_id ? db.places.get(recording.place_id) : undefined,
      loadAudioFile(db, recording),
    ])
    const live = liveTune(tune)
    return {
      place: place && !place.deleted_at ? place : null,
      recording: recording && !recording.deleted_at ? recording : null,
      file,
      tuneId: live?.id ?? null,
      tuneTitle: live?.title ?? null,
      holdsSplitAudio: recording ? holdsSplitAudio(recording, waiting) : false,
    }
  }, [db, id])
  const view = useMemo<RecordingView | null>(
    () =>
      loaded?.recording
        ? {
            recording: loaded.recording,
            file: loaded.file,
            tuneId: loaded.tuneId,
            tuneTitle: loaded.tuneTitle,
            holdsSplitAudio: loaded.holdsSplitAudio,
            shownPlace: loaded.place?.name ?? loaded.recording.place_name ?? null,
          }
        : null,
    [loaded],
  )
  const location = useMemo<RecordingLocation | null>(() => {
    if (!loaded?.recording) return null
    const state = new LocationState(null, loaded.recording, loaded.place ? [loaded.place] : [])
    return state.point ? { point: state.point, address: state.address } : null
  }, [loaded])
  const recording = view?.recording ?? null
  const file = view?.file

  const [trimNotice, setTrimNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shows, setShows] = useState<RecordingPageShows>('main')
  const audio = useAudioFetch(recording, file, useRecordingsPlayable())

  const read = recording !== null
  const peaksRev = recording?.peaks_rev ?? null
  useEffect(() => {
    if (!read) return
    // Stores the server's peaks when this device lacks them; the read above then shows them.
    void syncEngine.peaks(id)
  }, [syncEngine, id, read, peaksRev])
  const trimStartMs = recording?.trim_start_ms
  const trimEndMs = recording?.trim_end_ms
  const playbackStartMs = recording?.playback_start_ms
  const filePeaks = file?.peaks ?? null
  const filePeaksRev = file?.peaks_rev ?? null
  const peaks = useMemo(
    () =>
      trimStartMs === undefined
        ? null
        : shownPeaks(
            {
              trim_start_ms: trimStartMs,
              trim_end_ms: trimEndMs ?? null,
              playback_start_ms: playbackStartMs ?? null,
              peaks_rev: peaksRev,
            },
            { peaks: filePeaks, peaks_rev: filePeaksRev },
          ),
    [trimStartMs, trimEndMs, playbackStartMs, peaksRev, filePeaks, filePeaksRev],
  )
  const rowLengthMs = recording ? (trimmedLengthMs(recording, file) ?? 0) : 0

  const title = view ? recordingTitle({ ...view, tuneId: null }) : ''
  const subtitle = recording
    ? [recordingDateLabel(recording), formatDuration(rowLengthMs)].join(' · ')
    : ''

  return {
    view,
    missing: loaded !== undefined && loaded.recording === null,
    title,
    subtitle,
    peaks,
    rowLengthMs,
    audio,
    shows,
    openEditor: (kind) => {
      setTrimNotice(null)
      setShows(kind)
    },
    leaveEditor: () => setShows('main'),
    trimmedElsewhere: () => {
      setTrimNotice(TRIM_CHANGED_ELSEWHERE)
      setShows('main')
    },
    trimNotice,
    error,
    setError,
    location,
  }
}
