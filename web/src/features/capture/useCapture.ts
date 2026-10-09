import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatest } from '../../ui/useLatest'
import { useAuthSession } from '../../auth/AuthContext'
import { newId } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import { persistStorage } from '../../platform/storage'
import { holdScreenAwake } from '../../platform/wakeLock'
import { acquireCaptureLock } from '../../sync/captureLock'
import { suspendAudioContext, unlockAudioContext } from './audioContext'
import {
  createRecordingSession,
  type SessionClock,
  type RecordingPhase,
  type RecordingSession,
  type RecordingSnapshot,
} from './recordingSession'

export type CapturePhase = RecordingPhase

export interface CaptureHandle extends RecordingSnapshot {
  recordingId: string
  stop: () => Promise<void>
  cancel: () => Promise<void>
}

const clock: SessionClock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
}

/**
 * Start capturing on mount and keep going until stop or cancel. One recording per mount; a recording
 * still running when the component unmounts is finished and kept, never discarded.
 */
export function useCapture({
  tuneId,
  onKept,
}: {
  tuneId: string | null
  /** Runs when the component went away mid-take and the take was kept all the same. */
  onKept?: (kept: { recordingId: string; elapsedMs: number }) => void
}): CaptureHandle {
  const onKeptRef = useLatest(onKept)
  const keep = useCallback(
    (kept: { recordingId: string; elapsedMs: number }) => onKeptRef.current?.(kept),
    [onKeptRef],
  )
  const db = useDb()
  const { userId } = useAuthSession()
  const [recordingId] = useState(newId)
  const [snapshot, setSnapshot] = useState<RecordingSnapshot>(() => ({
    phase: 'starting',
    elapsedMs: 0,
    analyser: null,
    error: null,
  }))
  const session = useRef<RecordingSession | null>(null)

  useEffect(() => {
    const capture = createRecordingSession({
      db,
      userId,
      recordingId,
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      MediaRecorder,
      acquireCaptureLock,
      holdWakeLock: holdScreenAwake,
      unlockAudioContext,
      suspendAudioContext,
      persistStorage,
      clock,
      tuneId,
    })
    session.current = capture
    const unsubscribe = capture.subscribe(setSnapshot)
    void capture.start()
    return () => {
      unsubscribe()
      session.current = null
      void capture.dispose().then(() => {
        const { phase, elapsedMs } = capture.snapshot()
        if (phase === 'saved') keep({ recordingId, elapsedMs })
      })
    }
  }, [db, recordingId, userId, tuneId, keep])

  const stop = useCallback(() => session.current?.finish() ?? Promise.resolve(), [])
  const cancel = useCallback(() => session.current?.cancel() ?? Promise.resolve(), [])

  return { ...snapshot, recordingId, stop, cancel }
}
