import { useCallback, useEffect, useRef, useState } from 'react'
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
export function useCapture({ songId }: { songId: string | null }): CaptureHandle {
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
      songId,
    })
    session.current = capture
    const unsubscribe = capture.subscribe(setSnapshot)
    void capture.start()
    return () => {
      unsubscribe()
      session.current = null
      capture.dispose()
    }
  }, [db, recordingId, userId, songId])

  const stop = useCallback(() => session.current?.finish() ?? Promise.resolve(), [])
  const cancel = useCallback(() => session.current?.cancel() ?? Promise.resolve(), [])

  return { ...snapshot, recordingId, stop, cancel }
}
