import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { waitingParentIds } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import { holdsSplitAudio } from '../../domain/recordingLimits'
import { liveTune } from '../../db/tunes'
import { useSyncEngine } from '../../sync/SyncProvider'
import { loadAudioFile } from '../player/playbackWindow'
import { formatDuration, recordingDateLabel } from '../../text/format'
import { shownPlaceName } from '../recordings/place'
import { recordingTitle } from '../recordings/recordingRow'
import type { RecordingView } from '../recordings/useRecordings'
import { shownPeaks, trimmedLengthMs, type ShownPeaks } from './recordingRange'
import { TRIM_CHANGED_ELSEWHERE } from './trimViewCopy'
import { useAudioFetch, type AudioFetch } from './practiceOverlayModel'
import { usePracticeOverlay, type PracticeOpensIn } from './usePracticeOverlay'

export type PracticeOverlayShows = 'main' | 'trim' | 'split'

export interface PracticeOverlayView {
  /** The recording and its tune, or null until the row is read and once it is gone. */
  view: RecordingView | null
  /** The tune's own name, not the row's heading, so a tune is never dropped. Empty until read. */
  title: string
  /** When it was recorded, how long it plays, and its players. Empty until read. */
  subtitle: string
  /** The location the recording shows, its saved location's name first; null when it has none. */
  location: string | null
  /** The peaks for the trimmed range, or null when there are none that line up. */
  peaks: ShownPeaks | null
  rowLengthMs: number
  audio: AudioFetch
  shows: PracticeOverlayShows
  openTrim: () => void
  leaveTrim: () => void
  openSplit: () => void
  leaveSplit: () => void
  /** Leaves the trim or split view because a trim written elsewhere replaced the one being edited. */
  trimmedElsewhere: () => void
  trimNotice: string | null
  /** Practice's own error. A caller shows its recording actions' error ahead of it. */
  error: string | null
  setError: (error: string | null) => void
  editing: RecordingView | null
  /** Opens the edit sheet on its form, or closes it with null. */
  setEditing: (view: RecordingView | null) => void
  /** Which page the edit sheet opens on; undefined for its form. */
  editPage: 'location' | undefined
  /** Opens the edit sheet on the location page. */
  openLocation: () => void
  filing: RecordingView | null
  setFiling: (view: RecordingView | null) => void
}

/**
 * Practice's state for recording `id`: the row and its tune, what the header reads,
 * the waveform's peaks, the state of the audio, and which view shows. Mount it keyed on each
 * open, so a fresh open starts on `opensIn`.
 */
export function usePracticeOverlayView(
  id: string,
  opensIn: PracticeOpensIn = 'main',
): PracticeOverlayView {
  const db = useDb()
  const syncEngine = useSyncEngine()
  const loaded = useLiveQuery(async () => {
    const recording = (await db.recordings.get(id)) ?? null
    const tune = recording?.tune_id ? await db.tunes.get(recording.tune_id) : null
    const live = liveTune(tune)
    const place = recording?.place_id ? await db.places.get(recording.place_id) : undefined
    return {
      place,
      recording: recording && !recording.deleted_at ? recording : null,
      file: await loadAudioFile(db, recording),
      tuneId: live?.id ?? null,
      tuneTitle: live?.title ?? null,
      holdsSplitAudio: recording ? holdsSplitAudio(recording, await waitingParentIds(db)) : false,
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
            shownPlace: shownPlaceName(
              loaded.recording,
              new Map(loaded.place ? [[loaded.place.id, loaded.place]] : []),
            ),
          }
        : null,
    [loaded],
  )
  const recording = view?.recording ?? null
  const file = view?.file

  const [editing, setEditingView] = useState<RecordingView | null>(null)
  const [editPage, setEditPage] = useState<'location' | undefined>(undefined)
  const setEditing = (next: RecordingView | null) => {
    setEditPage(undefined)
    setEditingView(next)
  }
  const [filing, setFiling] = useState<RecordingView | null>(null)
  const [trimNotice, setTrimNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shows, setShows] = useState<PracticeOverlayShows>(opensIn)
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
    ? [
        recordingDateLabel(recording),
        formatDuration(rowLengthMs),
        ...(recording.players ? [recording.players] : []),
      ].join(' · ')
    : ''

  return {
    view,
    title,
    subtitle,
    location: view?.shownPlace ?? null,
    peaks,
    rowLengthMs,
    audio,
    shows,
    openTrim: () => {
      setTrimNotice(null)
      setShows('trim')
    },
    leaveTrim: () => setShows('main'),
    openSplit: () => {
      setTrimNotice(null)
      setShows('split')
    },
    leaveSplit: () => setShows('main'),
    trimmedElsewhere: () => {
      setTrimNotice(TRIM_CHANGED_ELSEWHERE)
      setShows('main')
    },
    trimNotice,
    error,
    setError,
    editing,
    setEditing,
    editPage,
    openLocation: () => {
      if (!view) return
      setEditPage('location')
      setEditingView(view)
    },
    filing,
    setFiling,
  }
}
