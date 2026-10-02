import { IonButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Ellipsis, X } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import { liveTune } from '../../db/tunes'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { useDialogName } from '../../ui/dialogName'
import { InlineError } from '../../ui/InlineError'
import { MORE_ACTIONS, useMenu } from '../../ui/Menu'
import { isControl, isTextEntry, isTopOverlay } from '../../ui/useShortcut'
import { ELAPSED_LABEL, REMAINING_LABEL } from '../player/Dock'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import type { PlaybackEngine } from '../player/playbackEngine'
import { useCurrentAudio } from '../player/useCurrentAudio'
import { useRecordingDownload } from '../player/useRecordingDownload'
import {
  DOWNLOAD_FAILED,
  DOWNLOADING,
  fileStateLabel,
  formatDuration,
  NOT_AVAILABLE,
} from '../recording/format'
import { PRACTICE_BADGE, PRACTICE_BADGE_LABEL, PracticeView } from '../practice/PracticeView'
import { PRACTICE } from '../practice/practiceCopy'
import { AddToTuneSheet } from '../recordings/AddToTuneSheet'
import { recordedAtLabel, recordingTitle } from '../recordings/recordingRow'
import { RenameRecordingSheet } from '../recordings/RenameRecordingSheet'
import { useRecordingActions } from '../recordings/useRecordingActions'
import type { RecordingView } from '../recordings/useRecordings'
import { shownPeaks, trimmedLengthMs, trimPending } from './recordingRange'
import { ToolStrip, type Tool, type ToolId } from './ToolStrip'
import { SKIP_MS, Transport } from './Transport'
import { TRIM, TrimView } from './TrimView'
import { useHeldSettings, useRecordingScreen } from './useRecordingScreen'
import { Waveform } from './Waveform'

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

/** Why Practice cannot be used right now, or undefined when it can. */
function practiceBlocker(file: RecordingFile | undefined, audio: AudioFetch): string | undefined {
  if (file?.local_state === 'capturing') return TRIM_WHILE_RECORDING
  if (audio === 'downloading') return TRIM_WHILE_DOWNLOADING
  return undefined
}

/**
 * Space plays and pauses, and the left and right arrows skip, while the screen holds the
 * keyboard. A field, a slider, and a button each keep those keys for themselves, so a focused
 * control still does what it says, and an overlay stacked on the screen takes them too. The
 * trim view has keys of its own, so these stand down while it shows.
 */
function useTransportKeys(
  engine: PlaybackEngine,
  modal: RefObject<HTMLIonModalElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key
      if (key !== ' ' && key !== 'ArrowLeft' && key !== 'ArrowRight') return
      if (key === ' ' && event.repeat) return
      if (isTextEntry(event.target) || isControl(event.target)) return
      if (!isTopOverlay(modal.current)) return
      const state = engine.getState()
      if (state.lengthMs === 0) return
      event.preventDefault()
      if (key === 'ArrowLeft') engine.seek(state.positionMs - SKIP_MS)
      else if (key === 'ArrowRight') engine.seek(state.positionMs + SKIP_MS)
      else if (state.playing) engine.pause()
      else engine.play()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine, modal, enabled])
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
 * The expanded player: the whole trimmed recording as a scrubber, the transport, and the
 * tools. It drives the one engine the dock loaded, so what plays here is what the dock plays.
 */
export function RecordingScreen({
  id,
  view: initialView,
  modal,
  onClose,
}: {
  id: string
  /** The view to open in rather than the recording's own. */
  view?: 'practice'
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
    <Loaded
      key={view.recording.id}
      view={view}
      initialView={initialView}
      title={title}
      modal={modal}
      onClose={onClose}
    />
  )
}

// Above Ionic's overlays (100), so the phone's Back leaves a view inside the screen before it
// closes the screen itself.
const VIEW_BACK_PRIORITY = 101

interface BackButtonDetail {
  register: (priority: number, handler: (next?: () => void) => void) => void
}

/**
 * Escape and the phone's Back leave a view inside the screen for the recording's own view,
 * rather than closing the whole screen, while nothing is stacked over it. The view gets each
 * Escape first through `escapeRef`, and one it uses for itself leaves nothing.
 */
function useLeaveView(
  modal: RefObject<HTMLIonModalElement | null>,
  enabled: boolean,
  leave: () => void,
  escapeRef?: RefObject<(() => boolean) | null>,
): void {
  const latest = useRef(leave)
  useLayoutEffect(() => {
    latest.current = leave
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopOverlay(modal.current)) return
      // Ionic dismisses the top overlay from a listener on the document, which this one,
      // capturing on the window, runs ahead of.
      event.preventDefault()
      event.stopPropagation()
      if (escapeRef?.current?.()) return
      latest.current()
    }
    const onBack = (event: Event) => {
      if (!isTopOverlay(modal.current)) return
      const { detail } = event as CustomEvent<BackButtonDetail>
      detail.register(VIEW_BACK_PRIORITY, () => latest.current())
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('ionBackButton', onBack)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('ionBackButton', onBack)
    }
  }, [modal, enabled, escapeRef])
}

type View = 'main' | 'trim' | 'practice'

function Loaded({
  view,
  initialView,
  title,
  modal,
  onClose,
}: {
  view: RecordingView
  initialView: 'practice' | undefined
  title: string
  modal: RefObject<HTMLIonModalElement | null>
  onClose: () => void
}) {
  const { recording, file } = view
  const syncEngine = useSyncEngine()
  const engine = usePlaybackEngine()
  const openMenu = useMenu()
  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const [renaming, setRenaming] = useState<RecordingView | null>(null)
  const [filing, setFiling] = useState<RecordingView | null>(null)
  const [trimNotice, setTrimNotice] = useState<string | null>(null)
  const audio = useAudioFetch(recording, file)
  const practiceDisabled = practiceBlocker(file, audio)
  // Switching views in place keeps the screen, and the control that opened it, as they are.
  const actions = useRecordingActions({
    onRename: setRenaming,
    onPractice: practiceDisabled ? undefined : () => select('practice'),
    onAddToTune: setFiling,
    onDeleted: onClose,
  })
  // A Practice that cannot run yet opens on the recording's own view, which says why.
  const [screen, setScreen] = useState<View>(() =>
    initialView === 'practice' && !practiceDisabled ? 'practice' : 'main',
  )
  useTransportKeys(engine, modal, screen !== 'trim')

  // The trim view plays at 100% and no pitch shift, so what is heard is exactly what is cut.
  const trimming = screen === 'trim'
  const recordingScreen = useRecordingScreen()
  const recordingId = recording.id
  useLayoutEffect(() => {
    if (!trimming) return
    recordingScreen.hold(recordingId, { speedPercent: 100, pitchCents: 0, shown: false })
    return () => recordingScreen.hold(recordingId, null)
  }, [recordingScreen, recordingId, trimming])
  const settings = useRef({ speed: recording.speed_percent, pitch: recording.pitch_cents })
  useLayoutEffect(() => {
    settings.current = { speed: recording.speed_percent, pitch: recording.pitch_cents }
  })
  useEffect(() => {
    if (!trimming) return
    engine.setSpeed(100)
    engine.setPitch(0)
    // Leaving the trim view, or the whole screen from inside it, gives back what was playing.
    return () => {
      engine.setSpeed(settings.current.speed)
      engine.setPitch(settings.current.pitch)
    }
  }, [trimming, engine])

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
  const loadedAudio = state.lengthMs > 0
  const lengthMs = loadedAudio ? state.lengthMs : rowLengthMs
  const positionMs = loadedAudio ? state.positionMs : 0
  const remainingMs = Math.max(0, lengthMs - positionMs)

  // Practice's last speed and pitch show while their writes land, so leaving it never flashes
  // the row's older values.
  const pending = useHeldSettings(recordingId)
  const shownHold = pending?.shown ? pending : null
  const badge = PRACTICE_BADGE(
    shownHold?.speedPercent ?? recording.speed_percent,
    shownHold?.pitchCents ?? recording.pitch_cents,
  )
  const tools: Tool[] = [
    { id: 'trim', label: TRIM, disabled: trimBlocker(recording, file, audio) },
    { id: 'practice', label: PRACTICE, value: badge ?? undefined, disabled: practiceDisabled },
  ]

  // Coming back from a view puts focus back on the tool that opened it.
  const content = useRef<HTMLDivElement>(null)
  const returnTo = useRef<ToolId | null>(null)
  useEffect(() => {
    if (screen !== 'main' || !returnTo.current) return
    const tool = returnTo.current
    // One frame on, once the view's own controls have left the page and let go of focus.
    const frame = requestAnimationFrame(() => {
      returnTo.current = null
      content.current?.querySelector<HTMLElement>(`[data-tool="${tool}"]`)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [screen])
  const leave = (from: ToolId) => {
    returnTo.current = from
    setScreen('main')
  }
  const select = (id: ToolId) => {
    if (id === 'trim') setTrimNotice(null)
    setScreen(id)
  }
  const practiceEscape = useRef<(() => boolean) | null>(null)
  useLeaveView(modal, screen === 'practice', () => leave('practice'), practiceEscape)

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
          onDone={() => leave('trim')}
          onTrimmedElsewhere={() => {
            setTrimNotice(TRIM_CHANGED_ELSEWHERE)
            leave('trim')
          }}
        />
        {sheets}
      </>
    )
  }

  if (screen === 'practice') {
    return (
      <>
        <PracticeView
          view={view}
          shown={shown}
          modal={modal}
          escapeRef={practiceEscape}
          onBack={() => leave('practice')}
        />
        {sheets}
      </>
    )
  }

  const error = actions.error
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
        <div
          ref={content}
          className="mx-auto flex w-full max-w-(--measure) flex-col gap-5 px-4 py-4"
        >
          <div className="flex flex-col items-center gap-2">
            <p className="type-footnote text-center text-(--ion-color-medium)">
              {recordedAtLabel(recording.recorded_at)} · {formatDuration(rowLengthMs)}
            </p>
            {badge && !practiceDisabled ? (
              <button
                type="button"
                aria-label={PRACTICE_BADGE_LABEL(badge)}
                className="type-footnote min-h-11 rounded-full bg-(--fill-tertiary) px-4 tabular-nums"
                onClick={() => select('practice')}
              >
                {badge}
              </button>
            ) : null}
          </div>
          {error ? <InlineError className="text-center">{error}</InlineError> : null}
          {trimNotice ? (
            <p role="status" className="type-footnote text-center">
              {trimNotice}
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            <Waveform
              peaks={shown?.peaks ?? null}
              loudest={shown?.loudest}
              lengthMs={lengthMs}
              positionMs={positionMs}
              disabled={!loadedAudio}
              onSeek={(ms) => engine.seek(ms)}
            />
            <div className="type-footnote flex justify-between tabular-nums">
              <p
                role="timer"
                aria-live="off"
                aria-label={`${ELAPSED_LABEL} ${formatDuration(positionMs)}`}
              >
                {formatDuration(positionMs)}
              </p>
              <p
                role="timer"
                aria-live="off"
                aria-label={`${REMAINING_LABEL} ${formatDuration(remainingMs)}`}
              >
                -{formatDuration(remainingMs)}
              </p>
            </div>
          </div>
          <Transport />
          <ToolStrip tools={tools} onSelect={select} />
        </div>
      </IonContent>
      {sheets}
    </>
  )
}
