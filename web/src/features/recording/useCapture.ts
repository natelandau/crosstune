import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { newId } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import { acquireCaptureLock } from '../../sync/captureLock'
import { suspendAudioContext, unlockAudioContext } from './audioContext'
import {
  createTakeSession,
  type TakeClock,
  type TakePhase,
  type TakeSession,
  type TakeSnapshot,
} from './takeSession'
import { holdWakeLock } from './wakeLock'

export type CapturePhase = TakePhase

export interface CaptureHandle extends TakeSnapshot {
  recordingId: string
  stop: () => Promise<void>
  cancel: () => Promise<void>
}

const clock: TakeClock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
}

/**
 * Start capturing on mount and keep going until stop or cancel. One take per mount; a take
 * still running when the component unmounts is finished and kept, never discarded.
 */
export function useCapture({ songId }: { songId: string | null }): CaptureHandle {
  const db = useDb()
  const { userId } = useAuthSession()
  const [recordingId] = useState(newId)
  const [snapshot, setSnapshot] = useState<TakeSnapshot>(() => ({
    phase: 'starting',
    elapsedMs: 0,
    analyser: null,
    error: null,
    targetSongId: songId,
  }))
  const session = useRef<TakeSession | null>(null)
  // Read when the take finishes rather than captured when it starts, and kept out of the
  // session effect's dependencies so a change never restarts the microphone.
  const songIdRef = useRef(songId)
  useEffect(() => {
    songIdRef.current = songId
  }, [songId])

  useEffect(() => {
    const take = createTakeSession({
      db,
      userId,
      recordingId,
      songId: () => songIdRef.current,
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      MediaRecorder,
      acquireCaptureLock,
      holdWakeLock: () => holdWakeLock(),
      unlockAudioContext,
      suspendAudioContext,
      persistStorage: () => void navigator.storage?.persist?.().catch(() => {}),
      clock,
    })
    session.current = take
    const unsubscribe = take.subscribe(setSnapshot)
    void take.start()
    return () => {
      unsubscribe()
      session.current = null
      take.dispose()
    }
  }, [db, recordingId, userId])

  const stop = useCallback(() => session.current?.finish() ?? Promise.resolve(), [])
  const cancel = useCallback(() => session.current?.cancel() ?? Promise.resolve(), [])

  return { ...snapshot, recordingId, stop, cancel }
}
