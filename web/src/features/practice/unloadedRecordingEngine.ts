import { PlaybackEngine, type CreateStage, type EngineClock } from '../player/playbackEngine'
import type { PlayStart } from '../player/usePlayer'

/** Holds a playhead and nothing more: it never loads, plays, or reaches the audio hardware. */
class SilentAudio extends EventTarget {
  src = ''
  currentTime = 0
  duration = Number.NaN
  playbackRate = 1
  preservesPitch = true
  paused = true
  ended = false

  play(): Promise<void> {
    return Promise.resolve()
  }

  pause(): void {}
}

const IDLE_CLOCK: EngineClock = { every: () => () => {}, after: () => () => {} }
const NO_STAGE: CreateStage = () =>
  Promise.reject(new Error('The engine for an unloaded recording has no stage.'))

/**
 * Practice's engine for a recording the player has not loaded. The playhead, the loop, and
 * repeat behave as on the real engine, but nothing reaches the player, the lock screen, or the
 * audio: Play hands the playhead to `onPlay`.
 */
export class UnloadedRecordingEngine extends PlaybackEngine {
  #play: ((start: PlayStart) => void) | null = null

  constructor() {
    super(new SilentAudio() as unknown as HTMLAudioElement, IDLE_CLOCK, NO_STAGE, {
      mediaSession: () => undefined,
    })
  }

  /** Has Play call `fn` with where to start, until the returned call. */
  onPlay = (fn: (start: PlayStart) => void): (() => void) => {
    this.#play = fn
    return () => {
      if (this.#play === fn) this.#play = null
    }
  }

  /** Starts at the playhead, repeating the loop chosen here. A recording of no known length
   * starts at its trim start, since its playhead could have been moved past its end. */
  override play(): void {
    const { positionMs, lengthMs, repeat } = this.getState()
    this.#play?.({ at: lengthMs > 0 ? positionMs : 0, loop: repeat ? this.loopRange : null })
  }

  // Speed, pitch, and isolate reach the row through practice's settings; an audio context
  // here would take the device's audio from the recording that plays.
  override prime(): void {}
  override setPitch(): void {}
  override setIsolate(): void {}
}
