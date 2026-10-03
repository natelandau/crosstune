import { IonButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Ellipsis, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import { liveTune } from '../../db/tunes'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { useDialogName } from '../../ui/dialogName'
import { InlineError } from '../../ui/InlineError'
import { MORE_ACTIONS, useMenu } from '../../ui/Menu'
import { isTopOverlay } from '../../ui/useShortcut'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { useCurrentAudio } from '../player/useCurrentAudio'
import { useRecordingDownload } from '../player/useRecordingDownload'
import {
  DOWNLOAD_FAILED,
  DOWNLOADING,
  fileStateLabel,
  formatDuration,
  NOT_AVAILABLE,
} from '../recording/format'
import { Practice } from '../practice/Practice'
import { AddToTuneSheet } from '../recordings/AddToTuneSheet'
import { recordedAtLabel, recordingTitle } from '../recordings/recordingRow'
import { RenameRecordingSheet } from '../recordings/RenameRecordingSheet'
import { useRecordingActions } from '../recordings/useRecordingActions'
import type { RecordingView } from '../recordings/useRecordings'
import { shownPeaks, trimmedLengthMs, trimPending } from './recordingRange'
import { TrimView } from './TrimView'
import { useRecordingScreen } from './useRecordingScreen'
import { useLatest } from '../../ui/useLatest'

export const CLOSE_RECORDING = 'Close'
export const TRIM_BUSY = 'Trimming…'
export const TRIM_CHANGED_ELSEWHERE = "This recording's trim changed elsewhere."
export const TRIM_WHILE_RECORDING = 'Still recording'
export const TRIM_WHILE_DOWNLOADING = DOWNLOADING

/** Where fetching the audio stands, for a recording this device does not hold yet.
 * `unavailable` is one the server has no playback file for yet, so there is nothing to fetch. */
type AudioFetch = 'held' | 'unavailable' | 'offline' | 'downloading' | 'failed'

/** Why Trim cannot be used right now, or undefined when it can. */
function trimBlocker(
  recording: LocalRecording,
  file: RecordingFile | undefined,
  audio: AudioFetch,
): string | undefined {
  if (file?.local_state === 'capturing') return TRIM_WHILE_RECORDING
  if (audio === 'unavailable') return fileStateLabel(recording, file) || NOT_AVAILABLE
  if (audio === 'offline') return OFFLINE
  if (audio === 'downloading') return TRIM_WHILE_DOWNLOADING
  if (audio === 'failed') return DOWNLOAD_FAILED
  if (trimPending(recording)) return TRIM_BUSY
  // An imported file whose length the browser could not read has no range to trim until the
  // server measures it.
  if (trimmedLengthMs(recording, file) === null) return NOT_AVAILABLE
  return undefined
}

/** Why the waveform, transport, and modes cannot be used right now, or undefined when they can. */
function screenBlocker(file: RecordingFile | undefined, audio: AudioFetch): string | undefined {
  if (file?.local_state === 'capturing') return TRIM_WHILE_RECORDING
  if (audio === 'downloading') return TRIM_WHILE_DOWNLOADING
  return undefined
}

/**
 * Where this device's copy of the audio stands. Asking the sync engine joins any download the
 * dock already started, so the two never fetch the same file twice.
 */
function useAudioFetch(recording: LocalRecording, file: RecordingFile | undefined): AudioFetch {
  const online = useOnline()
  useCurrentAudio(recording, file)
  const { blob, failed } = useRecordingDownload(recording, file)
  if (!file?.blob && recording.state !== 'ready') return 'unavailable'
  if (blob) return 'held'
  if (!online) return 'offline'
  if (file?.local_state === 'downloading') return 'downloading'
  return failed ? 'failed' : 'downloading'
}

/**
 * The expanded player: the recording's waveform, transport, and practice modes, with Trim in
 * its menu. It drives the one engine the dock loaded, so what plays here is what the dock plays.
 */
export function RecordingScreen({
  id,
  modal,
  onClose,
}: {
  id: string
  modal: RefObject<HTMLIonModalElement | null>
  onClose: () => void
}) {
  const db = useDb()
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
  // The screen stands on the tune's own name, not the row's heading, so a tune is never dropped.
  const title = view ? recordingTitle({ ...view, tuneId: null }) : ''
  useDialogName(modal, title)

  // Silent until the row is read, like every screen.
  if (!view) return null
  return (
    <Loaded key={view.recording.id} view={view} title={title} modal={modal} onClose={onClose} />
  )
}

// Above Ionic's overlays (100), so the phone's Back reaches the screen's own leave before Ionic
// dismisses the modal itself.
const VIEW_BACK_PRIORITY = 101

interface BackButtonDetail {
  register: (priority: number, handler: (next?: () => void) => void) => void
}

/**
 * Escape and the phone's Back run `leave` rather than Ionic's own dismissal, while nothing is
 * stacked over the screen. The view gets each Escape first through `escapeRef`, and one it uses
 * for itself leaves nothing.
 */
function useLeaveView(
  modal: RefObject<HTMLIonModalElement | null>,
  enabled: boolean,
  leave: () => void,
  escapeRef?: RefObject<(() => boolean) | null>,
): void {
  const latestRef = useLatest(leave)
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopOverlay(modal.current)) return
      // Ionic dismisses the top overlay from a listener on the document, which this one,
      // capturing on the window, runs ahead of.
      event.preventDefault()
      event.stopPropagation()
      if (escapeRef?.current?.()) return
      latestRef.current()
    }
    const onBack = (event: Event) => {
      if (!isTopOverlay(modal.current)) return
      const { detail } = event as CustomEvent<BackButtonDetail>
      detail.register(VIEW_BACK_PRIORITY, () => latestRef.current())
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('ionBackButton', onBack)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('ionBackButton', onBack)
    }
  }, [modal, enabled, escapeRef, latestRef])
}

type View = 'main' | 'trim'

function Loaded({
  view,
  title,
  modal,
  onClose,
}: {
  view: RecordingView
  title: string
  modal: RefObject<HTMLIonModalElement | null>
  onClose: () => void
}) {
  const { recording, file } = view
  const syncEngine = useSyncEngine()
  const engine = usePlaybackEngine()
  const openMenu = useMenu()
  const [renaming, setRenaming] = useState<RecordingView | null>(null)
  const [filing, setFiling] = useState<RecordingView | null>(null)
  const [trimNotice, setTrimNotice] = useState<string | null>(null)
  const [practiceError, setPracticeError] = useState<string | null>(null)
  const audio = useAudioFetch(recording, file)
  const [screen, setScreen] = useState<View>('main')
  const openTrim = () => {
    setTrimNotice(null)
    setScreen('trim')
  }
  // Switching views in place keeps the screen, and the control that opened it, as they are.
  const actions = useRecordingActions({
    onTrim: openTrim,
    trimBlocked: trimBlocker(recording, file, audio),
    onRename: setRenaming,
    onAddToTune: setFiling,
    onDeleted: onClose,
  })

  // The trim view plays at 100% and no pitch shift, so what is heard is exactly what is cut.
  const trimming = screen === 'trim'
  const recordingScreen = useRecordingScreen()
  const recordingId = recording.id
  useLayoutEffect(() => {
    if (!trimming) return
    recordingScreen.hold(recordingId, { speedPercent: 100, pitchCents: 0, shown: false })
    return () => recordingScreen.hold(recordingId, null)
  }, [recordingScreen, recordingId, trimming])
  const settingsRef = useLatest({ speed: recording.speed_percent, pitch: recording.pitch_cents })
  useEffect(() => {
    if (!trimming) return
    engine.setSpeed(100)
    engine.setPitch(0)
    // Leaving the trim view, or the whole screen from inside it, gives back what was playing.
    return () => {
      // The settings as they stand when trimming ends, not as they were when it began.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const { speed, pitch } = settingsRef.current
      engine.setSpeed(speed)
      engine.setPitch(pitch)
    }
  }, [trimming, engine, settingsRef])

  const peaksRev = recording.peaks_rev
  const filePeaks = file?.peaks ?? null
  const filePeaksRev = file?.peaks_rev ?? null
  useEffect(() => {
    // Stores the server's peaks when this device lacks them; the read above then shows them.
    void syncEngine.peaks(recording.id)
  }, [syncEngine, recording.id, peaksRev])
  const shown = useMemo(
    () =>
      shownPeaks(
        {
          trim_start_ms: recording.trim_start_ms,
          trim_end_ms: recording.trim_end_ms,
          playback_start_ms: recording.playback_start_ms,
          peaks_rev: peaksRev,
        },
        { peaks: filePeaks, peaks_rev: filePeaksRev },
      ),
    [
      recording.trim_start_ms,
      recording.trim_end_ms,
      recording.playback_start_ms,
      peaksRev,
      filePeaks,
      filePeaksRev,
    ],
  )
  const rowLengthMs = trimmedLengthMs(recording, file) ?? 0

  // Coming back from the trim view puts focus back on the menu that opened it.
  const more = useRef<HTMLIonButtonElement>(null)
  const returning = useRef(false)
  useEffect(() => {
    if (screen !== 'main' || !returning.current) return
    // One frame on, once the trim view's own controls have left the page and let go of focus.
    let live = true
    const frame = requestAnimationFrame(() => {
      returning.current = false
      const button = more.current
      void Promise.resolve(button?.componentOnReady?.()).then(() => {
        if (live) button?.shadowRoot?.querySelector('button')?.focus()
      })
    })
    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [screen])
  const leaveTrim = () => {
    returning.current = true
    setScreen('main')
  }
  const escape = useRef<(() => boolean) | null>(null)
  useLeaveView(modal, screen === 'main', onClose, escape)

  const sheets = (
    <>
      <RenameRecordingSheet view={renaming} onClose={() => setRenaming(null)} />
      <AddToTuneSheet view={filing} onClose={() => setFiling(null)} />
    </>
  )

  if (screen === 'trim') {
    return (
      <>
        <TrimView
          recording={recording}
          file={file}
          shown={shown}
          modal={modal}
          onDone={leaveTrim}
          onTrimmedElsewhere={() => {
            setTrimNotice(TRIM_CHANGED_ELSEWHERE)
            leaveTrim()
          }}
        />
        {sheets}
      </>
    )
  }

  const error = actions.error ?? practiceError
  return (
    <>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="toolbar-control" aria-label={CLOSE_RECORDING} onClick={onClose}>
              <X aria-hidden="true" className="size-6" />
            </IonButton>
          </IonButtons>
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end">
            <IonButton
              ref={more}
              className="toolbar-control"
              aria-label={MORE_ACTIONS}
              onClick={(event) => openMenu(event, MORE_ACTIONS, actions.menuFor(view))}
            >
              <Ellipsis aria-hidden="true" className="size-6" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="practice-screen flex h-full w-full flex-col gap-3 px-4 py-4">
          <p className="type-footnote m-0 text-center text-(--ion-color-medium)">
            {recordedAtLabel(recording.recorded_at)} · {formatDuration(rowLengthMs)}
          </p>
          {error ? <InlineError className="text-center">{error}</InlineError> : null}
          {trimNotice ? (
            <p role="status" className="type-footnote m-0 text-center">
              {trimNotice}
            </p>
          ) : null}
          <Practice
            view={view}
            shown={shown}
            modal={modal}
            blocked={screenBlocker(file, audio)}
            escapeRef={escape}
            onError={setPracticeError}
          />
        </div>
      </IonContent>
      {sheets}
    </>
  )
}
