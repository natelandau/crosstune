import { appendChunk, beginCapture, cancelCapture, finishCapture } from '../../commands/recordings'
import { settingsId } from '../../commands/settings'
import { getStorage } from '../../db/meta'
import { AUDIO_BITRATES, CHUNK_MS, pickMimeType, storedAudioQuality } from '../../db/recordings'
import type { CrosstuneDb } from '../../db/schema'
import { createCapture, type Capture, type RecorderLike, type TrackLike } from './capture'

export type RecordingPhase =
  'starting' | 'recording' | 'interrupted' | 'saving' | 'saved' | 'denied' | 'failed'

export interface RecordingSnapshot {
  phase: RecordingPhase
  elapsedMs: number
  analyser: AnalyserNode | null
  error: string | null
}

export interface MediaStreamLike {
  getAudioTracks(): TrackLike[]
  getTracks(): { stop(): void }[]
}

export interface RecorderClass<S extends MediaStreamLike> {
  new (stream: S, options: MediaRecorderOptions): RecorderLike
  isTypeSupported(mimeType: string): boolean
}

export interface AudioContextLike<S extends MediaStreamLike> {
  createAnalyser(): AnalyserNode
  createMediaStreamSource(stream: S): {
    connect(node: AnalyserNode): unknown
    disconnect(): void
  }
}

export interface SessionClock {
  now(): number
  /** Call `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void
}

/** Generic over the stream type so the browser's own MediaStream and a test fake both fit. */
export interface RecordingSessionDeps<S extends MediaStreamLike> {
  db: CrosstuneDb
  userId: string
  recordingId: string
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<S>
  MediaRecorder: RecorderClass<S>
  acquireCaptureLock: (id: string) => Promise<() => void>
  holdWakeLock: () => () => void
  unlockAudioContext: () => AudioContextLike<S>
  /** Releases the iOS audio session once a recording ends, so it does not keep the mic indicator up. */
  suspendAudioContext: () => void
  persistStorage: () => void
  clock: SessionClock
}

export interface RecordingSession {
  /** Run the start sequence. Resolves once the recording is recording or has given up. */
  start(): Promise<void>
  snapshot(): RecordingSnapshot
  /** The listener is called on every change after subscribing, never immediately. */
  subscribe(listener: (snapshot: RecordingSnapshot) => void): () => void
  /** Stop and keep the recording. A no-op until the capture exists. */
  finish(): Promise<void>
  /** Stop and discard the recording, including a start still in progress. */
  cancel(): Promise<void>
  /** Stop reporting. A running recording is finished and kept; a start in progress backs out. */
  dispose(): void
}

const TICK_MS = 250

const MIC_DENIED =
  'Crosstune needs microphone access. Allow it in your browser or phone settings and try again.'
const MIC_FAILED = 'The microphone could not be started.'
const START_FAILED = 'The recording could not be started.'
const SAVE_FAILED =
  'The recording could not be saved. It will be recovered the next time the app syncs.'
const PARTIAL_SAVE = 'Part of this recording could not be saved.'
const DISCARD_FAILED = 'The recording could not be discarded.'
const SIZE_LIMIT = 'This recording reached the size limit and was saved.'

// Stopping short of the server's per-file cap leaves room for the chunk the recorder
// flushes on stop, so the finished recording can still upload.
const SIZE_LIMIT_FRACTION = 0.95

/** One recording from one microphone: start, interruptions, and exactly one finish or cancel. */
export function createRecordingSession<S extends MediaStreamLike>(
  deps: RecordingSessionDeps<S>,
): RecordingSession {
  const { db, recordingId, clock } = deps
  const listeners = new Set<(snapshot: RecordingSnapshot) => void>()
  let snapshot: RecordingSnapshot = {
    phase: 'starting',
    elapsedMs: 0,
    analyser: null,
    error: null,
  }
  let startCalled = false
  let disposed = false
  let media: MediaStreamLike | null = null
  let source: { disconnect(): void } | null = null
  let releaseLock: (() => void) | null = null
  let releaseWakeLock: (() => void) | null = null
  let stopTick: (() => void) | null = null
  let begun = false
  let recorder: RecorderLike | null = null
  let capture: Capture | null = null
  let ending: Promise<void> | null = null
  let startedAt = 0
  let activeMs = 0
  let recordedAt = ''
  let bytesWritten = 0
  let sizeLimited = false

  const emit = (patch: Partial<RecordingSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    if (disposed) return
    for (const listener of listeners) listener(snapshot)
  }

  const elapsed = () => activeMs + (startedAt ? clock.now() - startedAt : 0)

  const pauseClock = () => {
    activeMs = elapsed()
    startedAt = 0
  }

  // Each resource is cleared as it is released, so any number of calls release it once,
  // and a stream granted after an earlier call is still stopped by the next one.
  const releaseHardware = () => {
    stopTick?.()
    stopTick = null
    releaseWakeLock?.()
    releaseWakeLock = null
    source?.disconnect()
    source = null
    if (media) for (const t of media.getTracks()) t.stop()
    media = null
    deps.suspendAudioContext()
  }

  const unlock = () => {
    releaseLock?.()
    releaseLock = null
  }

  // Both run one microtask late so that capture.stop(), which can fire the recorder's
  // 'stop' event synchronously and so re-enter through onState, finds `ending` already set.
  const finishRecording = (): Promise<void> => {
    ending ??= Promise.resolve().then(async () => {
      pauseClock()
      emit({ phase: 'saving', elapsedMs: activeMs })
      // A rejected stop() means some chunk writes failed; the chunks that did write are
      // still the recording, so it only turns into a warning.
      const partial = (capture ? capture.stop() : Promise.resolve()).then(
        () => false,
        () => true,
      )
      // The microphone, screen, and waveform are done as soon as the recorder is, even
      // while the last chunk writes are still settling.
      await capture?.stopped
      releaseHardware()
      const writeFailed = await partial
      try {
        // Every recording begins unfiled; the recordings tab is where it is added to a song.
        const fields = {
          songId: null,
          // The recorder's own type names what it actually produced, codecs included.
          mime: recorder?.mimeType || 'audio/mp4',
          durationMs: activeMs,
          recordedAt,
        }
        // One retry covers a transient IndexedDB failure; past that the chunks stay put
        // and sync recovery finishes the recording.
        await finishCapture(db, recordingId, fields).catch(() =>
          finishCapture(db, recordingId, fields),
        )
      } catch {
        emit({ phase: 'failed', error: SAVE_FAILED })
        return
      } finally {
        unlock()
      }
      emit({ phase: 'saved', error: writeFailed ? PARTIAL_SAVE : sizeLimited ? SIZE_LIMIT : null })
    })
    return ending
  }

  const cancel = (): Promise<void> => {
    ending ??= Promise.resolve().then(async () => {
      pauseClock()
      await capture?.stop().catch(() => {})
      releaseHardware()
      try {
        if (begun) await cancelCapture(db, recordingId)
      } catch (err) {
        emit({ phase: 'failed', error: DISCARD_FAILED })
        throw err
      } finally {
        unlock()
      }
    })
    return ending
  }

  /** Undo a start that was cancelled or disposed before its capture existed. */
  const abandonStart = async () => {
    releaseHardware()
    try {
      if (begun) await cancelCapture(db, recordingId)
    } finally {
      unlock()
    }
  }
  const abandoned = () => disposed || ending !== null

  async function runStart(): Promise<void> {
    const [settings, storage] = await Promise.all([
      db.user_settings.get(settingsId(deps.userId)),
      getStorage(db),
    ])
    if (abandoned()) return abandonStart()
    const bitrate = AUDIO_BITRATES[storedAudioQuality(settings)]
    const sizeCap = storage?.max_file_bytes ? storage.max_file_bytes * SIZE_LIMIT_FRACTION : null

    let stream: S
    try {
      stream = await deps.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      media = stream
    } catch (err) {
      releaseHardware()
      const name = err instanceof Error ? err.name : ''
      emit({ phase: 'denied', error: name === 'NotAllowedError' ? MIC_DENIED : MIC_FAILED })
      return
    }
    if (abandoned()) return abandonStart()

    try {
      releaseLock = await deps.acquireCaptureLock(recordingId)
    } catch {
      releaseHardware()
      emit({ phase: 'failed', error: START_FAILED })
      return
    }
    if (abandoned()) return abandonStart()

    try {
      // unlockAudioContext also resumes a shared context an interruption left suspended.
      const context = deps.unlockAudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      const node = context.createMediaStreamSource(stream)
      node.connect(analyser)
      source = node
      emit({ analyser })
    } catch {
      // The waveform is only a visual cue; a recording must never depend on it.
    }

    const mime = pickMimeType((m) => deps.MediaRecorder.isTypeSupported(m))
    const created = new deps.MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      audioBitsPerSecond: bitrate,
    })
    recorder = created
    // Stamped before the row is written so recovery, which reads it from the row, files an
    // interrupted recording under the same start time a normal finish would use.
    recordedAt = new Date(clock.now()).toISOString()
    await beginCapture(db, recordingId, { songId: null, recordedAt })
    begun = true
    if (abandoned()) return abandonStart()
    // Asked only once there is a recording worth protecting from storage eviction.
    deps.persistStorage()

    const track = stream.getAudioTracks()[0]
    if (!track) throw new Error('No microphone track')
    capture = createCapture(created, track, {
      timesliceMs: CHUNK_MS,
      onChunk: (idx, blob) => {
        bytesWritten += blob.size
        if (sizeCap !== null && bytesWritten >= sizeCap && !ending) {
          sizeLimited = true
          void finishRecording()
        }
        return appendChunk(db, recordingId, idx, blob)
      },
      onState: (state) => {
        if (ending) return
        if (state === 'interrupted') {
          // The recorder itself keeps running through a mute, capturing silence rather
          // than pausing, so the clock keeps ticking too instead of freezing here.
          emit({ phase: 'interrupted', elapsedMs: elapsed() })
        } else if (state === 'recording') {
          emit({ phase: 'recording', elapsedMs: elapsed() })
        } else {
          // The recorder stopped without a tap on Stop (the track ended, or the
          // recorder failed): keep what it captured, exactly as Stop would.
          void finishRecording()
        }
      },
    })
    startedAt = clock.now()
    emit({ phase: 'recording' })
  }

  return {
    async start() {
      if (startCalled || disposed) return
      startCalled = true
      releaseWakeLock = deps.holdWakeLock()
      stopTick = clock.every(TICK_MS, () => {
        if (startedAt) emit({ elapsedMs: elapsed() })
      })
      try {
        await runStart()
      } catch {
        await abandonStart().catch(() => {})
        emit({ phase: 'failed', error: START_FAILED })
      }
    },
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    finish: () => (capture ? finishRecording() : Promise.resolve()),
    cancel,
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      if (capture) void finishRecording()
      else releaseHardware()
    },
  }
}
