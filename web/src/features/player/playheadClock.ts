import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { clamp } from '../../math'
import { TICK_MS, type PlaybackEngine, type PlaybackState } from './playbackEngine'

/** Schedules work for the next frame; swappable so a test steps frames itself. */
export interface FrameSource {
  request: (fn: () => void) => number
  cancel: (id: number) => void
}

export const animationFrames: FrameSource = {
  request: (fn) => requestAnimationFrame(fn),
  cancel: (id) => cancelAnimationFrame(id),
}

/** A value that changes outside React: read it with `get` whenever `subscribe` calls back. */
export interface Moving<T> {
  get: () => T
  subscribe: (fn: () => void) => () => void
}

export type ClockEngine = Pick<PlaybackEngine, 'getState' | 'subscribe' | 'onJump'>

export interface ClockOptions {
  frames?: FrameSource
  now?: () => number
}

/** How far past the engine's last report the playhead runs on before it waits for the next,
 * so a stalled element never lets it run away. */
const MAX_LEAD_MS = 2 * TICK_MS
/** A report at most this far behind what was drawn is the element's clock jittering, which is
 * held rather than drawn as a step back. */
const JITTER_MS = TICK_MS

interface Sample {
  ms: number
  at: number
  rate: number
  /** True once reports arrive while playing, the only time the playhead runs on between them. */
  running: boolean
}

/**
 * Where the playhead is drawn, on the trimmed timeline. The engine reports its position
 * at its tick, so between reports a playing playhead runs on from the last one at the playing
 * speed, published once a frame. A seek, pause, wrap, or load snaps it to the engine. A scrub
 * under way takes its place, unclamped, so a pull past either end draws there.
 *
 * Frames run only while the engine plays, someone listens, and the page shows.
 */
export class PlayheadClock implements Moving<number> {
  #ms: number
  #scrubMs: number | null = null
  #state: PlaybackState
  #sample: Sample
  /** The last playing frame drawn, below which a jittering report is held. */
  #floor: number | null = null
  #frame: number | null = null
  readonly #listeners = new Set<() => void>()
  readonly #frames: FrameSource
  readonly #now: () => number

  constructor(
    private readonly engine: ClockEngine,
    { frames = animationFrames, now = () => performance.now() }: ClockOptions = {},
  ) {
    this.#frames = frames
    this.#now = now
    this.#state = engine.getState()
    this.#sample = this.sampleOf(this.#state, false)
    this.#ms = this.#sample.ms
  }

  /** The playhead as last published, which is what is drawn. */
  get ms(): number {
    return this.#ms
  }

  get = (): number => this.#ms

  /** True while frames are running, so a listener can tell a frame from a jump. */
  get running(): boolean {
    return this.#frame !== null
  }

  /** The playhead now, which a playing engine has moved on from since the last frame. */
  live = (): number => this.#scrubMs ?? this.shownAt(this.#now())

  /** A scrub's playhead, or null once it lets go. */
  setScrub = (ms: number | null): void => {
    this.#scrubMs = ms
    this.publish()
    this.run()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn)
    this.run()
    return () => {
      this.#listeners.delete(fn)
      if (this.#listeners.size === 0) this.stop()
    }
  }

  /** Starts following the engine and the page's visibility; returns how to stop. */
  connect(): () => void {
    this.onState(this.engine.getState())
    const offState = this.engine.subscribe(this.onState)
    const offJump = this.engine.onJump(this.onJump)
    document.addEventListener('visibilitychange', this.run)
    return () => {
      offState()
      offJump()
      document.removeEventListener('visibilitychange', this.run)
      this.stop()
    }
  }

  private sampleOf(state: PlaybackState, running: boolean): Sample {
    return { ms: state.positionMs, at: this.#now(), rate: state.speedPercent / 100, running }
  }

  private readonly onState = (state: PlaybackState): void => {
    const prev = this.#state
    this.#state = state
    if (
      state.positionMs === prev.positionMs &&
      state.playing === prev.playing &&
      state.speedPercent === prev.speedPercent &&
      state.lengthMs === prev.lengthMs
    ) {
      return
    }
    const tick =
      state.playing &&
      prev.playing &&
      state.speedPercent === prev.speedPercent &&
      state.positionMs !== prev.positionMs
    this.#sample = this.sampleOf(state, tick)
    if (!state.playing) {
      this.#floor = null
      this.stop()
      this.publish()
      return
    }
    this.run()
  }

  private readonly onJump = (): void => {
    this.#floor = null
    this.#sample = this.sampleOf(this.#state, false)
    this.publish()
  }

  private shownAt(t: number): number {
    const { ms, at, rate, running } = this.#sample
    const lead = running ? clamp(t - at, 0, MAX_LEAD_MS) * rate : 0
    let shown = clamp(ms + lead, 0, this.#state.lengthMs)
    const floor = this.#floor
    if (floor !== null && shown < floor && floor - shown <= JITTER_MS) shown = floor
    return shown
  }

  private publish(ms = this.#scrubMs ?? this.shownAt(this.#now())): void {
    if (ms === this.#ms) return
    this.#ms = ms
    for (const fn of this.#listeners) fn()
  }

  private readonly run = (): void => {
    if (this.#frame !== null || !this.shouldRun()) return
    this.#frame = this.#frames.request(this.onFrame)
  }

  private stop(): void {
    if (this.#frame === null) return
    this.#frames.cancel(this.#frame)
    this.#frame = null
  }

  private shouldRun(): boolean {
    return (
      this.#state.playing &&
      this.#scrubMs === null &&
      this.#listeners.size > 0 &&
      document.visibilityState !== 'hidden'
    )
  }

  private readonly onFrame = (): void => {
    this.#frame = null
    if (!this.shouldRun()) return
    const ms = this.shownAt(this.#now())
    this.#floor = ms
    // Requested first, so a listener reading `running` sees a frame, not a jump.
    this.#frame = this.#frames.request(this.onFrame)
    this.publish(ms)
  }
}

/** One clock for `engine`, following it while the calling component is mounted. */
export function usePlayheadClock(engine: ClockEngine, options?: ClockOptions): PlayheadClock {
  const frames = options?.frames
  const now = options?.now
  const clock = useMemo(() => new PlayheadClock(engine, { frames, now }), [engine, frames, now])
  useEffect(() => clock.connect(), [clock])
  return clock
}

/**
 * One fact about the playhead, such as the time as text. `select` must return a primitive, so
 * the caller renders only when that fact changes rather than every frame.
 */
export function usePlayhead<T>(clock: Moving<number>, select: (ms: number) => T): T {
  return useSyncExternalStore(clock.subscribe, () => select(clock.get()))
}

/**
 * The playhead's time as of the last change of `key`, for a component that needs the time only
 * for what `key` decides from it, such as which loop is next. It renders when that changes
 * rather than every frame.
 */
export function usePlayheadWhere(clock: Moving<number>, key: (ms: number) => string): number {
  const cache = useRef<{ key: string; ms: number } | null>(null)
  const snapshot = useSyncExternalStore(clock.subscribe, () => {
    const ms = clock.get()
    const at = key(ms)
    if (cache.current?.key !== at) cache.current = { key: at, ms }
    return cache.current
  })
  return snapshot.ms
}
