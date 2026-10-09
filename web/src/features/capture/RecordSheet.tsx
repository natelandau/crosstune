import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import {
  NavigationType,
  useBlocker,
  useLocation,
  useNavigate,
  type BlockerFunction,
} from 'react-router'
import { useDb } from '../../db/DbProvider'
import { formatDuration } from '../../text/format'
import { LiveWaveform } from './LiveWaveform'
import { savedRecordingPath } from './savedRecordingPath'
import { DONE, FILING_UNDER, INTERRUPTED_MESSAGE, NEW_RECORDING, STOP } from './recordCopy'
import { type RecordTarget, useRecordState } from './RecordState'
import { type RecordSession, type SavedRecording, useRecordSession } from './useRecordSession'
import { CANCEL } from '../../ui/confirmCopy'
import { useLatest } from '../../ui/useLatest'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/Toast'

/** The Record control on screen, the disc or the capsule, which the sheet grows out of. */
function recordControl(): Element | null {
  return (
    [...document.querySelectorAll('[data-record-control]')].find(
      (control) => control.getBoundingClientRect().width > 0,
    ) ?? null
  )
}

/**
 * The recorder, opened by the disc, the capsule, or a tune page through
 * `RecordStateProvider`. It is an overlay, never a route. Mount it inside the router, which it
 * holds still while a take is live and moves on once one is saved.
 */
export function RecordSheet() {
  const { target } = useRecordState()
  // The take stays mounted through the sheet's exit, after the state has let it go. Each
  // target is a new take, so a new one remounts it.
  const [shown, setShown] = useState<{ target: RecordTarget; key: number } | null>(null)
  if (target && target !== shown?.target) setShown({ target, key: (shown?.key ?? 0) + 1 })
  const closed = useCallback(
    (mine: RecordTarget) => setShown((current) => (current?.target === mine ? null : current)),
    [],
  )
  if (!shown) return null
  return (
    <Take key={shown.key} target={shown.target} open={target === shown.target} onClosed={closed} />
  )
}

function Take({
  target,
  open,
  onClosed,
}: {
  target: RecordTarget
  open: boolean
  onClosed: (target: RecordTarget) => void
}) {
  const { close, saving } = useRecordState()
  const navigate = useNavigate()
  const pathRef = useLatest(useLocation().pathname)
  const confirm = useConfirm()
  const { show } = useToast()
  const toast = useCallback((message: string) => show(message), [show])
  const { tuneId, source } = target

  const onDone = useCallback(
    (saved: SavedRecording | null) => {
      close(saved)
      if (!saved) return
      const path = savedRecordingPath(tuneId, pathRef.current)
      if (path) void navigate(path)
    },
    [close, navigate, pathRef, tuneId],
  )
  const session = useRecordSession({
    tuneId,
    source,
    confirm,
    toast,
    onDone,
    onSaving: saving,
  })
  const { phase, live, refuseDismiss, discard } = session

  // The browser's back would leave the take behind the page it lands on, so it is refused.
  const refuseRef = useLatest(refuseDismiss)
  const refuseBack = useCallback<BlockerFunction>(
    ({ historyAction }) => historyAction === NavigationType.Pop && refuseRef.current,
    [refuseRef],
  )
  const blocker = useBlocker(refuseBack)
  useEffect(() => {
    if (blocker.state === 'blocked') blocker.reset()
  }, [blocker])

  const ended = phase === 'denied' || phase === 'failed'
  return (
    <Sheet
      isOpen={open}
      onOpenChange={(next) => {
        if (next) return
        if (live) void discard()
        else if (!refuseDismiss) close(null)
      }}
      title={NEW_RECORDING}
      // Part height leaves Stop under a phone's bottom edge once the filing line or an alert shows.
      height="full"
      locked={refuseDismiss}
      asksOnBack={live}
      origin={recordControl}
      leading={
        ended
          ? { label: DONE, onPress: () => close(null) }
          : { label: CANCEL, onPress: () => void discard(), isDisabled: !live }
      }
      onClosed={() => onClosed(target)}
    >
      <Recorder tuneId={tuneId} session={session} />
    </Sheet>
  )
}

function Recorder({ tuneId, session }: { tuneId: string | null; session: RecordSession }) {
  const { phase, live, showTimer, elapsedMs, levels, error, statusLabel, stop } = session
  const db = useDb()
  const title = useLiveQuery(
    async () => (tuneId ? ((await db.tunes.get(tuneId))?.title ?? null) : null),
    [db, tuneId],
  )
  return (
    <div className="flex flex-col items-center gap-4 pt-2 text-center">
      {title && (
        <p className="t-secondary text-ink-2">
          {FILING_UNDER} {title}
        </p>
      )}
      <p role="status" aria-live="polite" className="t-secondary text-ink-2">
        {statusLabel}
      </p>
      {live && (
        <LiveWaveform
          analyser={levels}
          paused={phase === 'interrupted'}
          active={live}
          className="text-record"
        />
      )}
      {showTimer && (
        <p role="timer" aria-live="off" className="t-timer">
          {formatDuration(elapsedMs)}
        </p>
      )}
      {phase === 'interrupted' && (
        <p role="alert" className="t-secondary text-warning">
          {INTERRUPTED_MESSAGE}
        </p>
      )}
      <ErrorLine error={phase === 'saved' ? null : error} place="stack" />
      {live && (
        <AriaButton
          isDisabled={phase === 'starting'}
          onPress={() => void stop()}
          className="bg-record mt-2 grid size-20 place-items-center rounded-full text-xl font-bold text-white transition-opacity duration-(--dur-short) ease-(--ease) data-[disabled]:opacity-40 data-[pressed]:opacity-60"
        >
          {STOP}
        </AriaButton>
      )}
    </div>
  )
}
