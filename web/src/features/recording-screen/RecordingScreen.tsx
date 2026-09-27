import { IonButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Ellipsis, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import { liveTune } from '../../db/tunes'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { useDialogName } from '../../ui/dialogName'
import { InlineError } from '../../ui/InlineError'
import { MORE_ACTIONS, useMenu } from '../../ui/Menu'
import { useToast } from '../../ui/Toast'
import { isControl, isTextEntry, isTopOverlay } from '../../ui/useShortcut'
import {
  ELAPSED_LABEL,
  PAUSE,
  PITCH_BADGE,
  PLAY,
  REMAINING_LABEL,
  SPEED_BADGE,
} from '../player/Dock'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import type { PlaybackEngine } from '../player/playbackEngine'
import { useCurrentAudio } from '../player/useCurrentAudio'
import {
  DOWNLOAD_FAILED,
  DOWNLOADING,
  fileStateLabel,
  formatDuration,
  NOT_AVAILABLE,
} from '../recording/format'
import { AddToTuneSheet } from '../recordings/AddToTuneSheet'
import { recordedAtLabel, recordingTitle } from '../recordings/recordingRow'
import { RenameRecordingSheet } from '../recordings/RenameRecordingSheet'
import { useRecordingActions } from '../recordings/useRecordingActions'
import type { RecordingView } from '../recordings/useRecordings'
import { PITCH, PitchPanel } from './PitchPanel'
import { shownPeaks, trimmedLengthMs, trimPending } from './recordingRange'
import { SPEED, SpeedPanel } from './SpeedPanel'
import { ToolStrip, type Tool, type ToolId } from './ToolStrip'
import { TRIM, TrimView } from './TrimView'
import { useSettledWrite } from './useSettledWrite'
import { useRecordingScreen } from './useRecordingScreen'
import { Waveform } from './Waveform'

export const CLOSE_RECORDING = 'Close'
export const SKIP_BACK = 'Skip back 15 seconds'
export const SKIP_FORWARD = 'Skip forward 15 seconds'
export const TRIM_BUSY = 'Trimming…'
export const TRIM_CHANGED_ELSEWHERE = "This recording's trim changed elsewhere."
export const TRIM_WHILE_RECORDING = 'Still recording'
export const TRIM_WHILE_DOWNLOADING = DOWNLOADING
export const SPEED_NOT_SAVED = 'The speed could not be saved.'
export const PITCH_NOT_SAVED = 'The pitch could not be saved.'

/** The same interval the Apple player skips by. */
export const SKIP_MS = 15_000

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
  const syncEngine = useSyncEngine()
  const online = useOnline()
  useCurrentAudio(recording, file)
  const needed = !file?.blob && recording.state === 'ready'
  const [fetched, setFetched] = useState<{ id: string; blob: Blob | null } | null>(null)
  useEffect(() => {
    if (!needed || !online) return
    let cancelled = false
    void syncEngine.download(recording.id).then((blob) => {
      if (!cancelled) setFetched({ id: recording.id, blob })
    })
    return () => {
      cancelled = true
    }
  }, [needed, online, syncEngine, recording.id])
  if (!file?.blob && recording.state !== 'ready') return 'unavailable'
  if (!needed) return 'held'
  if (!online) return 'offline'
  if (file?.local_state === 'downloading') return 'downloading'
  return fetched?.id === recording.id ? 'failed' : 'downloading'
}

/**
 * The expanded player: the whole trimmed recording as a scrubber, the transport, and the
 * tools. It drives the one engine the dock loaded, so what plays here is what the dock plays.
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
  const db = useDb()
  const syncEngine = useSyncEngine()
  const engine = usePlaybackEngine()
  const toast = useToast()
  const openMenu = useMenu()
  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const panelId = useId()
  const [screen, setScreen] = useState<'main' | 'trim'>('main')
  const [tool, setTool] = useState<ToolId | null>(null)
  const [renaming, setRenaming] = useState<RecordingView | null>(null)
  const [filing, setFiling] = useState<RecordingView | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [trimNotice, setTrimNotice] = useState<string | null>(null)
  const actions = useRecordingActions({
    onRename: setRenaming,
    onAddToTune: setFiling,
    onDeleted: onClose,
  })
  const audio = useAudioFetch(recording, file)
  useTransportKeys(engine, modal, screen === 'main')

  // What the controls show runs ahead of the row while a change settles, and follows the row
  // when it changes while nothing is settling. `sent` is the last value this screen wrote or
  // took from the row: a control that differs from it holds a change of the musician's own,
  // which a row value landing meanwhile (such as this screen's own earlier write) never undoes.
  const [speed, setSpeed] = useState(recording.speed_percent)
  const [pitch, setPitch] = useState(recording.pitch_cents)
  const [sent, setSent] = useState({ speed: recording.speed_percent, pitch: recording.pitch_cents })
  const [rowSettings, setRowSettings] = useState({
    speed: recording.speed_percent,
    pitch: recording.pitch_cents,
  })
  const rowSpeed = recording.speed_percent
  const rowPitch = recording.pitch_cents
  if (rowSettings.speed !== rowSpeed || rowSettings.pitch !== rowPitch) {
    setRowSettings({ speed: rowSpeed, pitch: rowPitch })
    const adoptSpeed = rowSettings.speed !== rowSpeed && speed === sent.speed
    const adoptPitch = rowSettings.pitch !== rowPitch && pitch === sent.pitch
    if (adoptSpeed) setSpeed(rowSpeed)
    if (adoptPitch) setPitch(rowPitch)
    if (adoptSpeed || adoptPitch) {
      setSent({
        speed: adoptSpeed ? rowSpeed : sent.speed,
        pitch: adoptPitch ? rowPitch : sent.pitch,
      })
    }
  }

  // The trim view plays at 100% and no pitch shift, so what is heard is exactly what is cut.
  const trimming = screen === 'trim'
  const recordingScreen = useRecordingScreen()
  const recordingId = recording.id
  // Tells the dock what plays ahead of the row, so a stored value landing late re-applies
  // this screen's value rather than the older one.
  useLayoutEffect(() => {
    recordingScreen.hold(
      recordingId,
      trimming
        ? { speedPercent: 100, pitchCents: 0 }
        : speed === rowSpeed && pitch === rowPitch
          ? null
          : {
              speedPercent: speed === rowSpeed ? null : speed,
              pitchCents: pitch === rowPitch ? null : pitch,
            },
    )
  }, [recordingScreen, recordingId, trimming, speed, pitch, rowSpeed, rowPitch])
  useEffect(() => () => recordingScreen.hold(recordingId, null), [recordingScreen, recordingId])
  const settings = useRef({ speed, pitch })
  useLayoutEffect(() => {
    settings.current = { speed, pitch }
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

  const row = useRef(recording)
  const mounted = useRef(true)
  useLayoutEffect(() => {
    row.current = recording
  })
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A write refused because the row is gone needs no word: the screen goes with the row. Any
  // other refusal shows on the screen, or as a toast once the screen has closed.
  const report = (message: string) => (error: unknown) => {
    if (error instanceof Error && error.message === RECORDING_NOT_FOUND) return
    if (mounted.current) setWriteError(message)
    else toast({ message })
  }
  // A value the row already holds, such as one adopted from another device, is not written back.
  useSettledWrite(speed, (value) => {
    setSent((current) => ({ ...current, speed: value }))
    if (value === row.current.speed_percent) return
    updateRecording(db, row.current.id, { speed_percent: value }).catch(report(SPEED_NOT_SAVED))
  })
  useSettledWrite(pitch, (value) => {
    setSent((current) => ({ ...current, pitch: value }))
    if (value === row.current.pitch_cents) return
    updateRecording(db, row.current.id, { pitch_cents: value }).catch(report(PITCH_NOT_SAVED))
  })

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

  const changeSpeed = (percent: number) => {
    setSpeed(percent)
    setWriteError(null)
    engine.setSpeed(percent)
  }
  const changePitch = (cents: number) => {
    setPitch(cents)
    setWriteError(null)
    // Inside the tap that changed it, so iOS grants the audio context a pitch stage needs.
    engine.setPitch(cents)
  }

  const tools: Tool[] = [
    { id: 'trim', label: TRIM, disabled: trimBlocker(recording, file, audio) },
    {
      id: 'speed',
      label: SPEED,
      value: speed !== 100 ? SPEED_BADGE(speed) : undefined,
      controls: panelId,
    },
    {
      id: 'pitch',
      label: PITCH,
      value: pitch !== 0 ? PITCH_BADGE(pitch) : undefined,
      controls: panelId,
    },
  ]
  const select = (id: ToolId) => {
    if (id === 'trim') {
      setTrimNotice(null)
      setScreen('trim')
      return
    }
    setTool((current) => (current === id ? null : id))
  }

  // Coming back from the trim view puts focus back on the tool that opened it.
  const content = useRef<HTMLDivElement>(null)
  const backFromTrim = useRef(false)
  useEffect(() => {
    if (screen !== 'main' || !backFromTrim.current) return
    // One frame on, once the trim view's Cancel has left the page and let go of focus.
    const frame = requestAnimationFrame(() => {
      backFromTrim.current = false
      content.current?.querySelector<HTMLElement>('[data-tool="trim"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [screen])

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
          onDone={() => {
            backFromTrim.current = true
            setScreen('main')
          }}
          onTrimmedElsewhere={() => {
            backFromTrim.current = true
            setTrimNotice(TRIM_CHANGED_ELSEWHERE)
            setScreen('main')
          }}
        />
        {sheets}
      </>
    )
  }

  const error = writeError ?? actions.error
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
          <p className="type-footnote text-center text-(--ion-color-medium)">
            {recordedAtLabel(recording.recorded_at)} · {formatDuration(rowLengthMs)}
          </p>
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
          <div className="flex items-center justify-center gap-6">
            <IonButton
              fill="clear"
              aria-label={SKIP_BACK}
              disabled={!loadedAudio}
              onClick={() => engine.seek(engine.getState().positionMs - SKIP_MS)}
            >
              <RotateCcw aria-hidden="true" className="size-7" />
            </IonButton>
            <IonButton
              shape="round"
              className="size-16"
              aria-label={state.playing ? PAUSE : PLAY}
              disabled={!loadedAudio}
              onClick={() => (state.playing ? engine.pause() : engine.play())}
            >
              {state.playing ? (
                <Pause aria-hidden="true" fill="currentColor" className="size-7" />
              ) : (
                <Play aria-hidden="true" fill="currentColor" className="ml-0.5 size-7" />
              )}
            </IonButton>
            <IonButton
              fill="clear"
              aria-label={SKIP_FORWARD}
              disabled={!loadedAudio}
              onClick={() => engine.seek(engine.getState().positionMs + SKIP_MS)}
            >
              <RotateCw aria-hidden="true" className="size-7" />
            </IonButton>
          </div>
          <ToolStrip tools={tools} selected={tool} onSelect={select} />
          {tool ? (
            <div id={panelId}>
              {tool === 'speed' ? <SpeedPanel value={speed} onChange={changeSpeed} /> : null}
              {tool === 'pitch' ? (
                <PitchPanel
                  value={pitch}
                  onChange={changePitch}
                  unavailable={state.pitchUnavailable}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </IonContent>
      {sheets}
    </>
  )
}
