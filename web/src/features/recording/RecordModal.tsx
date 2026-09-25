import {
  IonButton,
  IonContent,
  IonHeader,
  IonModal,
  IonTitle,
  IonToolbar,
  useIonRouter,
} from '@ionic/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm } from '../../ui/Confirm'
import { InlineError } from '../../ui/InlineError'
import { useToast } from '../../ui/Toast'
import { formatDuration, RECORDING } from './format'
import { LiveWaveform } from './LiveWaveform'
import { type CapturePhase, useCapture } from './useCapture'
import type { RecordTarget } from './useRecord'

export const NEW_RECORDING = 'New recording'
export const DISCARD_TITLE = 'Discard this recording?'
export const NOT_RECORDING = 'Not recording'
export const STARTING_MICROPHONE = 'Starting the microphone'

const STATUS: Record<CapturePhase, string> = {
  starting: STARTING_MICROPHONE,
  recording: RECORDING,
  interrupted: 'Interrupted',
  saving: 'Saving',
  saved: 'Saved',
  denied: NOT_RECORDING,
  failed: NOT_RECORDING,
}

/**
 * Recording is a modal over whatever tab is open, so finishing returns the musician to where
 * they were. A live recording refuses a swipe dismissal; Cancel and Stop are the ways out.
 */
export function RecordModal({
  target,
  onClose,
}: {
  /** Null means closed; the parent nulls it from onClose. */
  target: RecordTarget | null
  onClose: () => void
}) {
  const router = useIonRouter()
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState<RecordTarget | null>(null)
  const live = useRef(false)
  // The target the modal was presented for. Every way out ends here, including Escape and the
  // hardware back button, which dismiss with the backdrop role rather than through `closing`.
  const presentedFor = useRef<RecordTarget | null>(null)

  if (target !== openedFor) {
    setOpenedFor(target)
    if (target) setClosing(false)
  }

  useEffect(() => {
    if (target) presentedFor.current = target
  }, [target])

  const refuseGesture = async (_data?: unknown, role?: string) =>
    !(live.current && role === 'gesture')

  // A dismissal that ends after a new target opened belongs to the old one, so it closes nothing.
  const dismissed = () => {
    if (presentedFor.current !== null && presentedFor.current !== target) return
    presentedFor.current = null
    onClose()
  }

  const setLive = useCallback((value: boolean) => {
    live.current = value
  }, [])

  const tuneId = target?.tuneId ?? null
  const done = useCallback(
    (saved: boolean) => {
      setClosing(true)
      if (!saved) return
      const path = tuneId ? `/catalog/${tuneId}` : '/recordings'
      const here = router.routeInfo?.pathname ?? ''
      // A recording started from the page it would land on must not stack a second copy of
      // that page behind the one already open. A tune page lives in every tab's stack, so any
      // path ending in the tune's id is that page.
      const alreadyThere = tuneId ? here.endsWith(`/${tuneId}`) : here === path
      if (!alreadyThere) router.push(path, 'forward', 'push')
    },
    [router, tuneId],
  )

  return (
    <IonModal
      isOpen={target !== null && !closing}
      aria-label={NEW_RECORDING}
      canDismiss={refuseGesture}
      onDidDismiss={dismissed}
    >
      <IonHeader>
        <IonToolbar>
          <IonTitle>{NEW_RECORDING}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {/* Mounted only while open, so the capture starts with the modal and ends with it. */}
        {target ? <Capture tuneId={target.tuneId} onDone={done} onLive={setLive} /> : null}
      </IonContent>
    </IonModal>
  )
}

function Capture({
  tuneId,
  onDone,
  onLive,
}: {
  tuneId: string | null
  /** True once the recording is saved, false when it was discarded or never started. */
  onDone: (saved: boolean) => void
  onLive: (live: boolean) => void
}) {
  const { phase, elapsedMs, analyser, error, stop, cancel } = useCapture({ tuneId })
  const confirm = useConfirm()
  const toast = useToast()
  // Two presses in one tick both read the same committed state, so the guard is a ref.
  const ending = useRef(false)
  // The push below changes the route, which re-memoizes the router and so `onDone`; without
  // this latch the effect would run again and restack the toast it already showed.
  const reported = useRef(false)
  const live = phase === 'starting' || phase === 'recording' || phase === 'interrupted'
  const started = live && phase !== 'starting'
  const showTimer = started || phase === 'saving' || phase === 'saved'

  useEffect(() => {
    onLive(live)
  }, [live, onLive])
  // A capture that is gone can refuse nothing, whatever phase it was left in.
  useEffect(() => () => onLive(false), [onLive])

  useEffect(() => {
    if (phase !== 'saved' || reported.current) return
    reported.current = true
    // A size limit or a partly written recording still saved audio, so it reports itself on
    // the way out rather than as a failure the musician has to answer.
    if (error) toast({ message: error })
    onDone(true)
  }, [error, onDone, phase, toast])

  const discard = () => {
    if (ending.current) return
    ending.current = true
    const asked = started
      ? confirm({
          title: DISCARD_TITLE,
          message: 'The recording is not saved.',
          action: 'Discard',
        })
      : // Nothing has been captured yet, so there is nothing to ask about.
        Promise.resolve(true)
    void asked.then((ok) => {
      if (!ok) {
        ending.current = false
        return
      }
      // A failed discard is reported through the capture's own error, with the modal still open.
      return cancel().then(
        () => onDone(false),
        () => {
          ending.current = false
        },
      )
    })
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-between gap-6 p-4">
      <p role="status" aria-live="polite" className="type-subheadline">
        {STATUS[phase]}
      </p>

      <div className="flex w-full flex-col items-center gap-4">
        {live ? (
          <LiveWaveform analyser={analyser} paused={phase === 'interrupted'} active={live} />
        ) : null}
        {showTimer ? (
          <p role="timer" aria-live="off" className="type-timer">
            {formatDuration(elapsedMs)}
          </p>
        ) : null}
        {phase === 'interrupted' ? (
          <p role="alert" className="type-footnote text-center text-(--ion-color-warning-shade)">
            Recording interrupted. The phone locked or another app took the microphone. Stop to keep
            what you have, or wait for it to resume.
          </p>
        ) : null}
        {error && phase !== 'saved' ? (
          <InlineError className="text-center">{error}</InlineError>
        ) : null}
      </div>

      <div className="flex w-full flex-col items-center gap-4">
        {live ? (
          <IonButton
            className="size-24 text-2xl [--background:var(--color-record)] [--border-radius:50%] [--color:#ffffff]"
            disabled={phase === 'starting'}
            onClick={() => void stop()}
          >
            Stop
          </IonButton>
        ) : null}
        {phase === 'denied' || phase === 'failed' ? (
          <IonButton fill="clear" className="min-h-11" onClick={() => onDone(false)}>
            Done
          </IonButton>
        ) : (
          <IonButton fill="clear" className="min-h-11" disabled={!live} onClick={discard}>
            Cancel
          </IonButton>
        )}
      </div>
    </div>
  )
}
