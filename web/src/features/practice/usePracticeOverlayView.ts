import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useDb } from '../../db/DbProvider'
import { liveTune } from '../../db/tunes'
import { useSyncEngine } from '../../sync/SyncProvider'
import { formatDuration, recordingDateLabel } from '../../text/format'
import { recordingTitle } from '../recordings/recordingRow'
import type { RecordingView } from '../recordings/useRecordings'
import { shownPeaks, trimmedLengthMs, type ShownPeaks } from './recordingRange'
import { TRIM_CHANGED_ELSEWHERE } from './trimViewCopy'
import { useAudioFetch, type AudioFetch } from './practiceOverlayModel'
import { usePracticeOverlay } from './usePracticeOverlay'

export type PracticeOverlayShows = 'main' | 'trim'

export interface PracticeOverlayView {
  /** The recording and its tune, or null until the row is read and once it is gone. */
  view: RecordingView | null
  /** The tune's own name, not the row's heading, so a tune is never dropped. Empty until read. */
  title: string
  /** When it was recorded and how long it plays. Empty until read. */
  subtitle: string
  /** The peaks for the trimmed range, or null when there are none that line up. */
  peaks: ShownPeaks | null
  rowLengthMs: number
  audio: AudioFetch
  shows: PracticeOverlayShows
  openTrim: () => void
  leaveTrim: () => void
  /** Leaves the trim view because a trim written elsewhere replaced the one being edited. */
  trimmedElsewhere: () => void
  trimNotice: string | null
  /** Practice's own error. A caller shows its recording actions' error ahead of it. */
  error: string | null
  setError: (error: string | null) => void
  editing: RecordingView | null
  setEditing: (view: RecordingView | null) => void
  filing: RecordingView | null
  setFiling: (view: RecordingView | null) => void
}

/**
 * Practice's state for recording `id`: the row and its tune, what the header reads,
 * the waveform's peaks, where the audio stands, and which view shows. Mount it keyed on each
 * open, so a fresh open starts on the main view.
 */
export function usePracticeOverlayView(id: string): PracticeOverlayView {
  const db = useDb()
  const syncEngine = useSyncEngine()
  const loaded = useLiveQuery(async () => {
    const recording = (await db.recordings.get(id)) ?? null
    const tune = recording?.tune_id ? await db.tunes.get(recording.tune_id) : null
    const live = liveTune(tune)
    return {
      recording: recording && !recording.deleted_at ? recording : null,
      file: await db.recording_files.get(id),
      tuneId: live?.id ?? null,
      tuneTitle: live?.title ?? null,
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
          }
        : null,
    [loaded],
  )
  const recording = view?.recording ?? null
  const file = view?.file

  const [editing, setEditing] = useState<RecordingView | null>(null)
  const [filing, setFiling] = useState<RecordingView | null>(null)
  const [trimNotice, setTrimNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shows, setShows] = useState<PracticeOverlayShows>('main')
  // A playing list can move practice to its next recording; nothing said or open about the
  // last one carries over.
  const [shownId, setShownId] = useState(id)
  if (shownId !== id) {
    setShownId(id)
    setEditing(null)
    setFiling(null)
    setTrimNotice(null)
    setError(null)
    setShows('main')
  }
  const audio = useAudioFetch(recording, file)

  // A list moving on would take practice, and a sheet's typed work with it, to its next
  // recording.
  const { holdEnd } = usePracticeOverlay()
  const sheetOpen = editing !== null || filing !== null
  useLayoutEffect(() => {
    if (!sheetOpen) return
    holdEnd(id, true)
    return () => holdEnd(id, false)
  }, [holdEnd, id, sheetOpen])

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
    ? `${recordingDateLabel(recording)} · ${formatDuration(rowLengthMs)}`
    : ''

  return {
    view,
    title,
    subtitle,
    peaks,
    rowLengthMs,
    audio,
    shows,
    openTrim: () => {
      setTrimNotice(null)
      setShows('trim')
    },
    leaveTrim: () => setShows('main'),
    trimmedElsewhere: () => {
      setTrimNotice(TRIM_CHANGED_ELSEWHERE)
      setShows('main')
    },
    trimNotice,
    error,
    setError,
    editing,
    setEditing,
    filing,
    setFiling,
  }
}
