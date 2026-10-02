import { IonButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/react'
import { ChevronLeft, Minus, Plus } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { RECORDING_RANGES } from '../../api/vocabulary'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import { useFrame } from '../../platform/frame'
import { getMode } from '../../platform/mode'
import { InlineError } from '../../ui/InlineError'
import { useToast } from '../../ui/Toast'
import { isTextEntry, isTopOverlay } from '../../ui/useShortcut'
import { PITCH_BADGE, SPEED_BADGE } from '../player/transportCopy'
import { useEngineState, usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { clampPitch, PANEL_ICON_BUTTON, SPEED_STEP, stepSpeed } from '../recording-screen/panel'
import { PITCH, PITCH_DOWN, PITCH_UP, PitchPanel } from '../recording-screen/PitchPanel'
import type { ShownPeaks } from '../recording-screen/recordingRange'
import { FASTER, SLOWER, SPEED, SpeedPanel } from '../recording-screen/SpeedPanel'
import { useEntryFocus } from '../recording-screen/useEntryFocus'
import { useRecordingScreen } from '../recording-screen/useRecordingScreen'
import { useSettledWrite } from '../recording-screen/useSettledWrite'
import { recordingTitle } from '../recordings/recordingRow'
import type { RecordingView } from '../recordings/useRecordings'
import type { Span } from './loopModel'
import { LoopList } from './LoopList'
import { PracticeLanes } from './PracticeLanes'
import { PracticeTransport } from './PracticeTransport'
import { useLoopMark, type LoopMark } from './useLoopMark'
import { useLoopPlayback, type LoopPlayback } from './useLoopPlayback'
import { useLoops } from './useLoops'
import { BACK, LOOPS_LABEL, PRACTICE } from './practiceCopy'
import { useLatest } from '../../ui/useLatest'

export const LANES_LABEL = 'Waveform'
export const SPEED_NOT_SAVED = 'The speed could not be saved.'
export const PITCH_NOT_SAVED = 'The pitch could not be saved.'
export const LOCKED_LOOPS_NOTICE = 'Loops repeat while the screen is on.'

const PITCH_STEP_CENTS = 100

/** `75% · +2`, the speed and pitch away from their defaults, or null at both defaults. */
export function PRACTICE_BADGE(speedPercent: number, pitchCents: number): string | null {
  const parts = [
    speedPercent !== 100 ? SPEED_BADGE(speedPercent) : null,
    pitchCents !== 0 ? PITCH_BADGE(pitchCents) : null,
  ].filter((part) => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** `Practice, 75%`, the name of the badge that opens Practice. */
export function PRACTICE_BADGE_LABEL(badge: string): string {
  return `${PRACTICE}, ${badge}`
}

/**
 * Where the musician works on a recording: the transport, speed and pitch, and room for the
 * loop lanes and the loop list. It drives the engine the dock loaded and holds speed and
 * pitch ahead of the row while a change settles.
 */
export function PracticeView({
  view,
  shown,
  modal,
  escapeRef,
  onBack,
}: {
  view: RecordingView
  /** The peaks for the recording's current trim range. */
  shown: ShownPeaks | null
  modal: RefObject<HTMLIonModalElement | null>
  /** Set to what Escape does in Practice before it leaves; true when it did something. */
  escapeRef?: RefObject<(() => boolean) | null>
  onBack: () => void
}) {
  const { recording } = view
  const db = useDb()
  const engine = usePlaybackEngine()
  const toast = useToast()
  const layout = useFrame()
  const pitchUnavailable = useEngineState(engine, (s) => s.pitchUnavailable)
  const title = recordingTitle({ ...view, tuneId: null })
  const [writeError, setWriteError] = useState<string | null>(null)
  const loopRows = useLoops(recording.id)
  const playback = useLoopPlayback(view, loopRows)
  const [announcement, setAnnouncement] = useState('')
  const announceFrame = useRef(0)
  // Emptied first and filled a frame later, so a message the region already holds is read again.
  const announce = useCallback((message: string) => {
    setAnnouncement('')
    cancelAnimationFrame(announceFrame.current)
    announceFrame.current = requestAnimationFrame(() => setAnnouncement(message))
  }, [])
  useEffect(() => () => cancelAnimationFrame(announceFrame.current), [])
  const mark = useLoopMark({
    view,
    loops: loopRows,
    playback,
    announce,
    onError: setWriteError,
  })
  const fitRef = useRef<((span: Span) => void) | null>(null)
  const cancelRename = useRef<(() => boolean) | null>(null)
  usePracticeKeys(modal, playback, mark, cancelRename, escapeRef)

  // What the controls show runs ahead of the row while a change settles, and follows the row
  // when it changes while nothing is settling. `sent` is the last value this view wrote or
  // took from the row: a control that differs from it holds a change of the musician's own,
  // which a row value landing meanwhile (such as this view's own earlier write) never undoes.
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

  const recordingScreen = useRecordingScreen()
  const recordingId = recording.id
  // Tells the dock what plays ahead of the row, so a stored value landing late re-applies
  // this view's value rather than the older one.
  useLayoutEffect(() => {
    recordingScreen.hold(
      recordingId,
      speed === rowSpeed && pitch === rowPitch
        ? null
        : {
            speedPercent: speed === rowSpeed ? null : speed,
            pitchCents: pitch === rowPitch ? null : pitch,
            shown: true,
          },
    )
  }, [recordingScreen, recordingId, speed, pitch, rowSpeed, rowPitch])

  const rowRef = useLatest(recording)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A write refused because the row is gone needs no word: the screen goes with the row. Any
  // other refusal shows in the view, or as a toast once the view has closed.
  const report = (message: string) => (error: unknown) => {
    if (error instanceof Error && error.message === RECORDING_NOT_FOUND) return
    if (mounted.current) setWriteError(message)
    else toast({ message })
  }
  const writing = useRef(new Set<Promise<void>>())
  const write = (patch: { speed_percent: number } | { pitch_cents: number }, message: string) => {
    const done = updateRecording(db, rowRef.current.id, patch).catch(report(message))
    writing.current.add(done)
    void done.finally(() => writing.current.delete(done))
  }
  // A value the row already holds, such as one adopted from another device, is not written back.
  useSettledWrite(speed, (value) => {
    setSent((current) => ({ ...current, speed: value }))
    if (value === rowRef.current.speed_percent) return
    write({ speed_percent: value }, SPEED_NOT_SAVED)
  })
  useSettledWrite(pitch, (value) => {
    setSent((current) => ({ ...current, pitch: value }))
    if (value === rowRef.current.pitch_cents) return
    write({ pitch_cents: value }, PITCH_NOT_SAVED)
  })
  // Declared after the settled writes, so their flush on leaving is already under way. The hold
  // outlives the view until every write has settled, so neither the screen nor the dock shows
  // an older value landing first; a hold a newer view has taken since is left to it.
  useEffect(() => {
    const pending = writing.current
    return () => {
      const left = recordingScreen.held(recordingId)
      void Promise.allSettled([...pending]).then(() => {
        if (recordingScreen.held(recordingId) === left) recordingScreen.hold(recordingId, null)
      })
    }
  }, [recordingScreen, recordingId])

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

  const back = useRef<HTMLIonButtonElement>(null)
  useEntryFocus(back, modal)

  const { min: minSpeed, max: maxSpeed } = RECORDING_RANGES.speed_percent
  const { min: minPitch, max: maxPitch } = RECORDING_RANGES.pitch_cents
  const steppers = (
    <div className="flex flex-col gap-3">
      <Stepper
        label={SPEED}
        value={SPEED_BADGE(speed)}
        less={{ label: SLOWER, disabled: speed <= minSpeed }}
        more={{ label: FASTER, disabled: speed >= maxSpeed }}
        onStep={(by) => changeSpeed(stepSpeed(speed, by * SPEED_STEP))}
      >
        <SpeedPanel value={speed} onChange={changeSpeed} />
      </Stepper>
      <Stepper
        label={PITCH}
        value={pitch === 0 ? '0' : PITCH_BADGE(pitch)}
        less={{ label: PITCH_DOWN, disabled: pitch <= minPitch }}
        more={{ label: PITCH_UP, disabled: pitch >= maxPitch }}
        onStep={(by) => changePitch(clampPitch(pitch + by * PITCH_STEP_CENTS))}
      >
        <PitchPanel value={pitch} onChange={changePitch} unavailable={pitchUnavailable} />
      </Stepper>
    </div>
  )
  const lanes = (
    <section aria-label={LANES_LABEL} data-practice-lanes>
      <PracticeLanes
        view={view}
        shown={shown}
        loops={loopRows}
        playback={playback}
        band={mark.band}
        modal={modal}
        fitRef={fitRef}
        onError={setWriteError}
      />
    </section>
  )
  // iOS suspends a page whose screen locks, and with it the timer that wraps a repeating loop.
  const transport = (
    <div className="flex flex-col gap-2">
      <PracticeTransport playback={playback} mark={mark} />
      {getMode() === 'ios' ? (
        <p className="type-footnote m-0 text-center text-(--ion-color-medium)">
          {LOCKED_LOOPS_NOTICE}
        </p>
      ) : null}
    </div>
  )
  const loops = (
    <section aria-label={LOOPS_LABEL} data-practice-loops>
      <LoopList
        view={view}
        loops={loopRows}
        playback={playback}
        modal={modal}
        cancelRef={cancelRename}
        onFit={(span) => fitRef.current?.(span)}
        onError={setWriteError}
      />
    </section>
  )

  return (
    <>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton ref={back} className="toolbar-control" aria-label={BACK} onClick={onBack}>
              <ChevronLeft aria-hidden="true" className="size-6" />
            </IonButton>
          </IonButtons>
          <IonTitle>
            <h2 className="type-headline m-0 truncate">{PRACTICE}</h2>
            <p className="type-footnote m-0 truncate text-(--ion-color-medium)">{title}</p>
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {layout === 'wide' ? (
          <div className="grid w-full grid-cols-2 gap-6 px-4 py-4">
            <div className="flex min-w-0 flex-col gap-5">
              {writeError ? <InlineError className="text-center">{writeError}</InlineError> : null}
              {lanes}
              {transport}
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              {steppers}
              {loops}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-(--measure) flex-col gap-5 px-4 py-4">
            {writeError ? <InlineError className="text-center">{writeError}</InlineError> : null}
            {lanes}
            {transport}
            {steppers}
            {loops}
          </div>
        )}
        <p aria-live="polite" className="sr-only" data-practice-announcer>
          {announcement}
        </p>
      </IonContent>
    </>
  )
}

/**
 * R toggles Repeat, and `[` and `]` mark a loop's start and end at the playhead, while Practice
 * holds the keyboard and no field does. Escape drops a pending A B mark or closes a loop's name
 * field before it can leave Practice; Space and the arrows belong to the screen's transport keys.
 */
function usePracticeKeys(
  modal: RefObject<HTMLIonModalElement | null>,
  playback: LoopPlayback,
  mark: LoopMark,
  cancelRename: RefObject<(() => boolean) | null>,
  escapeRef: RefObject<(() => boolean) | null> | undefined,
): void {
  const latestRef = useLatest({ playback, mark })
  useLayoutEffect(() => {
    if (!escapeRef) return
    escapeRef.current = () => latestRef.current.mark.cancel() || !!cancelRename.current?.()
    return () => {
      escapeRef.current = null
    }
  }, [escapeRef, cancelRename, latestRef])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.repeat) return
      const key = event.key
      const bracket = key === '[' || key === ']'
      // Some layouts type the brackets with AltGr, which reports Ctrl and Alt; R takes no
      // modifier but Shift, so Ctrl-R still reloads.
      if (!bracket && ((key !== 'r' && key !== 'R') || event.ctrlKey || event.altKey)) return
      if (isTextEntry(event.target) || !isTopOverlay(modal.current)) return
      event.preventDefault()
      const { playback, mark } = latestRef.current
      if (key === '[') mark.markStart()
      else if (key === ']') mark.markEnd()
      else playback.toggleRepeat()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, latestRef])
}

/**
 * One setting as a compact row: its value between a step down and a step up. The value
 * opens the setting's full panel in place of the steps.
 */
function Stepper({
  label,
  value,
  less,
  more,
  onStep,
  children,
}: {
  label: string
  value: string
  less: { label: string; disabled: boolean }
  more: { label: string; disabled: boolean }
  onStep: (by: -1 | 1) => void
  children: ReactNode
}) {
  const panelId = useId()
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          className="flex min-h-11 flex-1 items-center justify-between rounded-xl bg-(--fill-tertiary) px-4"
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="type-subheadline">{label}</span>{' '}
          <span className="type-headline tabular-nums">{value}</span>
        </button>
        {expanded ? null : (
          <>
            <button
              type="button"
              aria-label={less.label}
              className={PANEL_ICON_BUTTON}
              disabled={less.disabled}
              onClick={() => onStep(-1)}
            >
              <Minus aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              aria-label={more.label}
              className={PANEL_ICON_BUTTON}
              disabled={more.disabled}
              onClick={() => onStep(1)}
            >
              <Plus aria-hidden="true" className="size-5" />
            </button>
          </>
        )}
      </div>
      {expanded ? <div id={panelId}>{children}</div> : null}
    </div>
  )
}
