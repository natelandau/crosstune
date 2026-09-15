export type CaptureState = 'recording' | 'interrupted' | 'stopped'

export interface RecorderLike extends EventTarget {
  state: string
  mimeType: string
  start(timeslice?: number): void
  stop(): void
}

export interface TrackLike extends EventTarget {
  muted: boolean
  stop(): void
}

export interface CaptureOptions {
  timesliceMs: number
  onChunk: (idx: number, blob: Blob) => Promise<void>
  onState: (state: CaptureState) => void
}

export interface Capture {
  state(): CaptureState
  /**
   * Resolves once the recorder has flushed its last chunk, the microphone track has been
   * stopped, and every chunk write has settled. Rejects with the first chunk-write error,
   * if any, but only after that cleanup has already run.
   */
  stop(): Promise<void>
  /**
   * Resolves once the recorder itself has stopped, for any reason including the track
   * ending. The microphone track is released by `stop()`, not by this settling; chunk
   * writes may also still be settling, so await `stop()` for either.
   */
  stopped: Promise<void>
}

/**
 * Drives one MediaRecorder. The recorder's own state never reports a locked phone; the
 * microphone track's mute event does, so that is what marks an interruption.
 */
export function createCapture(
  recorder: RecorderLike,
  track: TrackLike,
  options: CaptureOptions,
): Capture {
  let state: CaptureState = 'recording'
  let idx = 0
  let writes: Promise<void> = Promise.resolve()
  let firstError: unknown
  let resolveStopped: () => void = () => {}
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve
  })
  let stopPromise: Promise<void> | null = null

  function setState(next: CaptureState) {
    if (state === next || state === 'stopped') return
    state = next
    options.onState(next)
  }

  recorder.addEventListener('dataavailable', (event) => {
    const data = (event as Event & { data?: Blob }).data
    if (!data || data.size === 0) return
    const mine = idx++
    // A rejected write must not break the chain, or every later chunk would be silently
    // dropped; remember only the first error and keep writing.
    writes = writes
      .then(() => options.onChunk(mine, data))
      .catch((error: unknown) => {
        firstError ??= error
      })
  })
  recorder.addEventListener('stop', () => {
    setState('stopped')
    resolveStopped()
  })
  track.addEventListener('mute', () => setState('interrupted'))
  track.addEventListener('unmute', () => setState('recording'))
  // stop() can reject with a chunk-write error; the caller's own stop() call returns the
  // same memoised promise and sees it, so this listener must not leave it unhandled.
  track.addEventListener('ended', () => {
    stop().catch(() => {})
  })

  recorder.start(options.timesliceMs)
  // If start() never moved the recorder off 'inactive', it failed to start and will never
  // fire its own 'stop' event, so a later stop() has to resolve on its own instead of waiting.
  const startFailed = recorder.state === 'inactive'

  function stop(): Promise<void> {
    // Memoised: a second concurrent call (or the track's 'ended' handler racing a manual
    // stop) must wait on the same completion rather than starting its own recorder.stop()
    // and resolving early just because recorder.state already flipped to 'inactive'.
    stopPromise ??= (async () => {
      if (startFailed) {
        resolveStopped()
      } else if (recorder.state !== 'inactive') {
        recorder.stop()
      }
      // Only the recorder's own 'stop' event (or the startFailed branch above) resolves
      // `stopped`; recorder.state can already read 'inactive' well before that event lands.
      await stopped
      // Release the microphone as soon as the recorder is confirmed done, independent of
      // whether queued chunk writes still need to flush.
      track.stop()
      await writes
      if (firstError !== undefined) throw firstError
    })()
    return stopPromise
  }

  return { state: () => state, stop, stopped }
}
