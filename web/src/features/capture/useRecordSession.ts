import { useCallback, useEffect, useRef } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { durationBucket } from '../../usage/buckets'
import type { Source } from '../../usage/events'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { useLatest } from '../../ui/useLatest'
import { RECORDING } from '../../text/format'
import {
  DISCARD,
  DISCARD_TITLE,
  INTERRUPTED,
  NOT_RECORDING,
  NOT_SAVED_MESSAGE,
  SAVED,
  SAVING,
  STARTING_MICROPHONE,
} from './recordCopy'
import { MIC_DENIED } from './recordingSession'
import { type CapturePhase, useCapture } from './useCapture'

const STATUS: Record<CapturePhase, string> = {
  starting: STARTING_MICROPHONE,
  recording: RECORDING,
  interrupted: INTERRUPTED,
  saving: SAVING,
  saved: SAVED,
  denied: NOT_RECORDING,
  failed: NOT_RECORDING,
}

export interface SavedRecording {
  tuneId: string | null
  recordingId: string
}

export interface RecordSessionOptions {
  tuneId: string | null
  /** The control that opened the recorder, reported with the start. */
  source: Source
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  /** A save that kept audio but has something to say about it, said on the way out. */
  toast: (message: string) => void
  /** The saved recording, or null when it was discarded or never started. */
  onDone: (saved: SavedRecording | null) => void
  /** The id Stop is about to save under, called before the recording is written, so a list can
   * know the new row as it appears. */
  onSaving?: (recordingId: string) => void
}

export interface RecordSession {
  phase: CapturePhase
  /** True once the microphone is capturing, so a discard has audio to ask about. */
  started: boolean
  /** True from the start until the capture ends, saved or not. */
  live: boolean
  showTimer: boolean
  elapsedMs: number
  /** The analyser the live waveform reads its levels from; null until the microphone is up. */
  levels: AnalyserNode | null
  error: string | null
  statusLabel: string
  /** Saves what is captured; does nothing until the microphone is up. */
  stop: () => Promise<void>
  /** Asks first once audio is captured; a refused or failed discard leaves the capture running. */
  discard: () => Promise<void>
  /** True while every dismissal short of Stop or a confirmed discard must be refused, and
   * through the save, so the recorder stays mounted until the save is reported. */
  refuseDismiss: boolean
}

/**
 * One recording from mount to save or discard: the capture, its status line, the discard
 * question, and the report once it ends. The caller draws the recorder and decides where a
 * save goes from `onDone`.
 */
export function useRecordSession({
  tuneId,
  source,
  confirm,
  toast,
  onDone,
  onSaving,
}: RecordSessionOptions): RecordSession {
  const analyticsRef = useLatest(useAnalytics())
  // A save is reported once, whether Stop, a size limit, or the recorder going away ended it.
  const reported = useRef(false)
  const reportSaved = useCallback(
    (recordingId: string, elapsedMs: number) => {
      if (reported.current) return
      reported.current = true
      analyticsRef.current.send('recording_saved', {
        duration_bucket: durationBucket(elapsedMs),
        filed: tuneId !== null,
        recording_id: recordingId,
        ...(tuneId === null ? {} : { tune_id: tuneId }),
      })
    },
    [analyticsRef, tuneId],
  )
  const {
    phase,
    elapsedMs,
    analyser,
    error,
    recordingId,
    stop: finish,
    cancel,
  } = useCapture({ tuneId, onKept: (kept) => reportSaved(kept.recordingId, kept.elapsedMs) })
  const elapsedRef = useLatest(elapsedMs)
  const confirmRef = useLatest(confirm)
  const toastRef = useLatest(toast)
  const onDoneRef = useLatest(onDone)
  const onSavingRef = useLatest(onSaving)
  // The save's hand-off to the caller happens once, however often the inputs change after it.
  const done = useRef(false)
  // Two presses in one tick both read the same committed state, so the guard is a ref.
  const ending = useRef(false)
  // Set by Stop in the same tick, before a render can clear `live` for a discard already queued.
  const stopped = useRef(false)
  const question = useRef<AbortController | null>(null)
  const live = phase === 'starting' || phase === 'recording' || phase === 'interrupted'
  const started = live && phase !== 'starting'
  const showTimer = started || phase === 'saving' || phase === 'saved'

  // A discard question outlives its point once the capture has ended or the recorder has gone.
  useEffect(() => {
    if (!live) question.current?.abort()
  }, [live])
  useEffect(() => () => question.current?.abort(), [])

  // Each attempt reports its start, or its denial, once.
  const attempted = useRef(false)
  useEffect(() => {
    if (attempted.current) return
    if (started) {
      attempted.current = true
      analyticsRef.current.send('recording_started', { source })
    } else if (phase === 'denied' && error === MIC_DENIED) {
      // A hardware failure is not a refusal, so only the browser's own denial reports.
      attempted.current = true
      analyticsRef.current.send('microphone_denied', { source })
    }
  }, [analyticsRef, error, phase, source, started])

  useEffect(() => {
    if (phase !== 'saved' || done.current) return
    done.current = true
    reportSaved(recordingId, elapsedRef.current)
    // A size limit or a partly written recording still saved audio, so it reports itself on
    // the way out rather than as a failure the musician has to answer.
    if (error) toastRef.current(error)
    onDoneRef.current({ tuneId, recordingId })
  }, [elapsedRef, error, onDoneRef, phase, recordingId, reportSaved, toastRef, tuneId])

  const startedRef = useLatest(started)
  const stop = useCallback(() => {
    // Before the microphone is up there is nothing to save, and Cancel must still work.
    if (!startedRef.current) return Promise.resolve()
    stopped.current = true
    onSavingRef.current?.(recordingId)
    return finish()
  }, [finish, onSavingRef, recordingId, startedRef])

  const discard = useCallback(async () => {
    // Once the capture has ended there is nothing left to discard, and a save still owes its report.
    if (ending.current || stopped.current || !live) return
    ending.current = true
    let ok = true
    if (started) {
      const controller = new AbortController()
      question.current = controller
      ok = await confirmRef.current({
        title: DISCARD_TITLE,
        message: NOT_SAVED_MESSAGE,
        action: DISCARD,
        signal: controller.signal,
      })
      if (question.current === controller) question.current = null
    }
    if (!ok || stopped.current) {
      ending.current = false
      return
    }
    try {
      await cancel()
    } catch {
      // A failed discard is reported through the capture's own error, with the recorder open.
      ending.current = false
      return
    }
    // Nothing was captured before the microphone came up, so there is nothing to report.
    if (started) {
      analyticsRef.current.send('recording_discarded', {
        duration_bucket: durationBucket(elapsedRef.current),
      })
    }
    onDoneRef.current(null)
  }, [analyticsRef, cancel, confirmRef, elapsedRef, live, onDoneRef, started])

  return {
    phase,
    started,
    live,
    showTimer,
    elapsedMs,
    levels: analyser,
    error,
    statusLabel: STATUS[phase],
    stop,
    discard,
    refuseDismiss: live || phase === 'saving',
  }
}
