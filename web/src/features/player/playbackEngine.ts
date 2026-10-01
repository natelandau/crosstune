import { setAudioSessionType } from '../../platform/audioSession'
import { compensatedSemitones, createPitchStage, type PitchStage } from './pitchStage'
import type { PlaybackWindow } from './playbackWindow'

export interface PlaybackSettings {
  speedPercent: number
  pitchCents: number
}

export interface PlaybackMeta {
  title: string
}

export interface PlaybackState {
  playing: boolean
  positionMs: number
  lengthMs: number
  failed: boolean
  /** True once loading the pitch stage has failed; speed still works, pitch does not. */
  pitchUnavailable: boolean
  /** The loop Repeat plays, if one is chosen; its times stay inside the engine. */
  loop: { id: string; label: string } | null
  /** Whether reaching the end of the loop jumps back to its start. */
  repeat: boolean
}

/** A span of the loaded blob to repeat, in seconds like `PlaybackWindow`. */
export interface PlaybackLoop {
  id: string
  label: string
  fromS: number
  toS: number
}

/** Builds the pitch stage; swappable in tests, which never load the real worklet. */
export type CreateStage = (context: AudioContext, element: HTMLAudioElement) => Promise<PitchStage>

export interface EngineClock {
  /** Call `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void
  /** Call `fn` once after `ms` unless the returned function is called first. */
  after(ms: number, fn: () => void): () => void
}

/** How often the engine reports its position. */
export const TICK_MS = 50
/** How far short of the loop end, in seconds, the end timer may find the playhead and still
 * wrap; further short means playback stalled, and wrapping then would cut the loop. */
const LOOP_END_TOLERANCE_S = 0.03
/** Fallback jump, in seconds, for a lock-screen or headset seek button that reports no offset. */
const DEFAULT_SEEK_OFFSET_S = 10

const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Undeclared on HTMLMediaElement; only some Safari builds still read it. */
type LegacyPitchElement = HTMLAudioElement & { webkitPreservesPitch?: boolean }

function mediaSession(): MediaSession | undefined {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
    ? navigator.mediaSession
    : undefined
}

/** Not every browser supports every action, so registering or clearing one can throw. */
function setActionHandler(
  session: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    session.setActionHandler(action, handler)
  } catch {
    // Nothing to fall back to; the control just will not appear for this action.
  }
}

/**
 * The one thing that owns an `<audio>` element and plays a recording through its trim
 * range and speed. Every surface that plays a recording shares one instance so there is
 * never more than one thing driving the element.
 */
export class PlaybackEngine {
  private span: PlaybackWindow = { fromS: 0, toS: 0, lengthMs: 0 }
  #pitchCents = 0
  #speedPercent = 100
  #pitchStage: PitchStage | null = null
  #audioContext: AudioContext | null = null
  // Guards the async stage creation, which must run at most once for the element's life.
  #stageRequested = false
  #disposed = false
  private state: PlaybackState = {
    playing: false,
    positionMs: 0,
    lengthMs: 0,
    failed: false,
    pitchUnavailable: false,
    loop: null,
    repeat: false,
  }
  private loop: PlaybackLoop | null = null
  private repeat = false
  // Whether the playhead was inside the loop at the last tick or seek; a wrap only fires
  // for a playhead that reached the loop end from inside it.
  private insideLoop = false
  private cancelEndTimer: (() => void) | null = null
  private readonly listeners = new Set<(state: PlaybackState) => void>()
  private readonly jumpListeners = new Set<() => void>()
  private stopTick: (() => void) | null = null

  constructor(
    private readonly element: HTMLAudioElement,
    private readonly clock: EngineClock,
    private readonly createStage: CreateStage = createPitchStage,
  ) {
    this.listen()
  }

  get pitchCents(): number {
    return this.#pitchCents
  }

  get disposed(): boolean {
    return this.#disposed
  }

  /** The range last given to `setLoop`, or null when none is set or a `keepLoop` reload has
   * suspended it, which a caller holding the loop's source times answers with `setLoop`. */
  get loopRange(): Readonly<PlaybackLoop> | null {
    return this.loop ? { ...this.loop } : null
  }

  /** Brings a disposed engine back, listening to its element and the lock-screen controls
   * again, for a React StrictMode remount that disposes the engine and then keeps it. Does
   * nothing to a live engine. */
  revive(): void {
    if (!this.#disposed) return
    this.#disposed = false
    this.#stageRequested = false
    this.listen()
  }

  // Arrow fields, not prototype methods, so `useSyncExternalStore` can take them unbound.
  subscribe = (fn: (state: PlaybackState) => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Calls `fn` whenever the playhead moves other than by playing on: a seek, a wrap, a load,
   * or the return to the start at the end of the trim range. */
  onJump = (fn: () => void): (() => void) => {
    this.jumpListeners.add(fn)
    return () => this.jumpListeners.delete(fn)
  }

  /** A stable reference between changes, for `useSyncExternalStore`. */
  getState = (): PlaybackState => {
    return this.state
  }

  /** `keepLoop` keeps Repeat and the chosen loop for a reload of the same recording. The
   * loop's range is in the old blob's seconds, so it is suspended (no wrapping) until
   * `setLoop` supplies offsets for the new blob. */
  load(
    src: string,
    span: PlaybackWindow,
    settings: PlaybackSettings,
    meta: PlaybackMeta,
    options: { keepLoop?: boolean } = {},
  ): void {
    this.stopTick?.()
    if (options.keepLoop) {
      this.cancelTimer()
      this.loop = null
      this.insideLoop = false
    } else {
      this.clearLoop()
    }
    this.span = this.withKnownEnd(span)
    this.#pitchCents = settings.pitchCents
    this.element.src = src
    this.element.currentTime = span.fromS
    this.applySpeed(settings.speedPercent)
    this.updateTranspose()
    this.applyMetadata(meta)
    this.setState({ playing: false, positionMs: 0, lengthMs: this.span.lengthMs, failed: false })
    this.stopTick = this.clock.every(TICK_MS, this.tick)
    this.reportPosition()
    this.jumped()
  }

  play(): void {
    this.setState({ failed: false })
    this.enterLoopIfOutside()
    // A context already built for a stage can be suspended by iOS (backgrounding, a call)
    // even while the stored pitch is 0, so this runs regardless of pitch.
    this.resumeAudioContext()
    // A recording since the graph was built can have reset the session to 'auto'; resuming
    // playback reclaims it.
    if (this.#pitchStage) setAudioSessionType('playback')
    if (this.#pitchCents !== 0) this.ensurePitchStage()
    const result = this.element.play()
    // Autoplay policy or a missing source rejects rather than throws; either way playback
    // never started, so no 'play' event follows and only failed needs setting here.
    void result?.catch?.(() => this.setState({ failed: true }))
  }

  pause(): void {
    this.cancelTimer()
    this.element.pause()
  }

  /** Picks the loop Repeat plays, or none. Never moves the playhead unless Repeat is on and
   * the playhead is outside the new range. Only the part inside the trim window repeats. */
  setLoop(loop: PlaybackLoop | null): void {
    this.cancelTimer()
    this.loop = loop ? { ...loop } : null
    this.setState({ loop: loop ? { id: loop.id, label: loop.label } : null })
    this.enterLoopIfOutside()
    this.insideLoop = this.isInside(this.element.currentTime)
  }

  setRepeat(on: boolean): void {
    if (!on) this.cancelTimer()
    this.repeat = on
    this.setState({ repeat: on })
    if (on) this.enterLoopIfOutside()
    this.insideLoop = this.isInside(this.element.currentTime)
  }

  /** `ms` is on the trimmed timeline, zero at the trim start. */
  seek(ms: number): void {
    this.jumpTo(clamp(this.span.fromS + ms / 1000, this.span.fromS, this.span.toS))
  }

  setSpeed(percent: number): void {
    this.applySpeed(percent)
    this.updateTranspose()
    this.reportPosition()
  }

  setPitch(cents: number): void {
    this.#pitchCents = cents
    if (cents !== 0) this.ensurePitchStage()
    this.updateTranspose()
  }

  setWindow(span: PlaybackWindow): void {
    this.span = this.withKnownEnd(span)
    const time = clamp(this.element.currentTime, this.span.fromS, this.span.toS)
    if (time !== this.element.currentTime) {
      this.cancelTimer()
      this.element.currentTime = time
    }
    // The loop's repeating part is cut to the window, so the playhead may have left it.
    this.insideLoop = this.isInside(this.element.currentTime)
    this.setState({
      lengthMs: this.span.lengthMs,
      positionMs: this.positionMsFor(this.element.currentTime),
    })
    this.reportPosition()
  }

  /** Updates only what the lock screen shows, for a rename that changes neither the audio
   * nor its position. */
  setMetadata(meta: PlaybackMeta): void {
    this.applyMetadata(meta)
  }

  /**
   * Creates (or resumes) the AudioContext synchronously, inside the tap that is about to ask
   * to play a recording, so iOS has already granted it by the time a pitch stage needs one.
   * Builds no stage itself.
   */
  prime(): void {
    try {
      this.#audioContext ??= new AudioContext()
    } catch {
      return
    }
    this.resumeAudioContext()
  }

  /** Stops and releases the current recording. The engine itself stays live: its element
   * listeners and Media Session handlers stay registered, ready for the next `load()`. */
  unload(): void {
    this.stopTick?.()
    this.stopTick = null
    this.element.pause()
    this.element.src = ''
    this.span = { fromS: 0, toS: 0, lengthMs: 0 }
    this.setState({ playing: false, positionMs: 0, lengthMs: 0, failed: false })
    this.clearLoop()
    // Suspending, not closing, lets prime() or play() resume it cheaply for the next
    // recording while releasing whatever exclusive hold it has on iOS's audio hardware.
    if (this.#audioContext?.state === 'running') void this.#audioContext.suspend().catch(() => {})
  }

  /** Tears the engine down: nothing after this reaches its element or lock-screen controls
   * unless `revive()` brings it back. Only for retiring the engine itself, never for closing a
   * recording it can later reload. */
  dispose(): void {
    this.#disposed = true
    this.unload()
    this.element.removeEventListener('play', this.onElementPlay)
    this.element.removeEventListener('pause', this.onElementPause)
    this.element.removeEventListener('ended', this.onElementEnded)
    this.element.removeEventListener('durationchange', this.onElementDuration)
    this.clearActionHandlers()
    this.#pitchStage?.dispose()
    this.#pitchStage = null
    if (this.#audioContext) {
      void this.#audioContext.close().catch(() => {})
      this.#audioContext = null
    }
  }

  private listen(): void {
    // A lock-screen control, media key, or headset disconnect can pause or resume the
    // element without going through play()/pause() below, so playing is derived from what
    // the element itself reports rather than assumed from the call that started it.
    this.element.addEventListener('play', this.onElementPlay)
    this.element.addEventListener('pause', this.onElementPause)
    this.element.addEventListener('ended', this.onElementEnded)
    this.element.addEventListener('durationchange', this.onElementDuration)
    this.registerActionHandlers()
  }

  private readonly onElementPlay = (): void => {
    // Covers every way playback can (re)start, lock-screen and media-key controls included,
    // not just this engine's own play() call. A refused start() falls back to a direct
    // connection on its own; this only needs to reflect that back into the state.
    this.#pitchStage?.start().catch(this.onStageStartFailed)
    this.setState({ playing: true, failed: false })
    this.reportPosition()
  }

  private readonly onElementPause = (): void => {
    this.cancelTimer()
    // Stops the worklet from processing silence while nothing is playing.
    this.#pitchStage?.stop()
    this.setState({ playing: false })
    this.reportPosition()
  }

  private readonly onElementEnded = (): void => {
    // A loop ending where the media ends stops the element before any wrap can run.
    const loop = this.activeLoop()
    if (this.repeat && loop && this.insideLoop) {
      this.jumpTo(loop.fromS)
      void this.element.play()?.catch?.(() => this.setState({ failed: true }))
      return
    }
    this.setState({ playing: false })
    this.reportPosition()
  }

  private readonly onElementDuration = (): void => {
    if (Number.isFinite(this.span.toS)) return
    this.span = this.withKnownEnd(this.span)
    this.setState({ lengthMs: this.span.lengthMs })
    this.reportPosition()
  }

  /** A window with no known end ends where the loaded audio does, once the element knows. */
  private withKnownEnd(span: PlaybackWindow): PlaybackWindow {
    const duration = this.element.duration
    if (Number.isFinite(span.toS) || !Number.isFinite(duration)) return span
    const toS = Math.max(span.fromS, duration)
    return { fromS: span.fromS, toS, lengthMs: Math.round((toS - span.fromS) * 1000) }
  }

  /** A stage that refused to start has already routed the element straight to the output, so
   * the element takes back correcting pitch for speed. */
  private readonly onStageStartFailed = (): void => {
    this.setState({ pitchUnavailable: true })
    this.applySpeed(this.#speedPercent)
  }

  private readonly tick = (): void => {
    this.advanceLoop()
    if (this.element.currentTime >= this.span.toS) {
      this.element.pause()
      this.element.currentTime = this.span.fromS
      this.setState({ positionMs: 0 })
      this.jumped()
    } else {
      this.setState({ positionMs: this.positionMsFor(this.element.currentTime) })
    }
    this.reportPosition()
  }

  /** Wraps a playhead that reached the loop end from inside. The tick is too coarse to land
   * on the end, so the last stretch is a timer, scaled by speed to wall-clock time. */
  private advanceLoop(): void {
    const loop = this.activeLoop()
    if (!loop) return
    const t = this.element.currentTime
    if (this.repeat && this.insideLoop && t >= loop.toS) {
      this.cancelTimer()
      this.element.currentTime = loop.fromS
      if (this.element.ended) void this.element.play()?.catch?.(() => {})
      this.jumped()
    } else if (
      this.repeat &&
      this.insideLoop &&
      !this.element.paused &&
      !this.cancelEndTimer &&
      this.wallMsTo(loop.toS) < TICK_MS
    ) {
      this.armEndTimer(loop)
    }
    this.insideLoop = this.isInside(this.element.currentTime)
  }

  /** Wall-clock milliseconds until the playhead reaches `s` at the current speed. */
  private wallMsTo(s: number): number {
    return ((s - this.element.currentTime) * 1000) / (this.#speedPercent / 100)
  }

  private armEndTimer(loop: PlaybackLoop): void {
    this.cancelEndTimer = this.clock.after(this.wallMsTo(loop.toS), () => {
      this.cancelEndTimer = null
      this.wrapIfInside()
    })
  }

  private wrapIfInside(): void {
    const loop = this.activeLoop()
    if (!this.repeat || !loop || !this.insideLoop) return
    if (this.element.currentTime < loop.toS - LOOP_END_TOLERANCE_S) {
      if (!this.element.paused) this.armEndTimer(loop)
      return
    }
    this.jumpTo(loop.fromS)
  }

  /** The loop cut to the trim window, or null when none is set or none of it is inside. */
  private activeLoop(): PlaybackLoop | null {
    const loop = this.loop
    if (!loop) return null
    const fromS = Math.max(loop.fromS, this.span.fromS)
    const toS = Math.min(loop.toS, this.span.toS)
    return toS > fromS ? { ...loop, fromS, toS } : null
  }

  private isInside(t: number): boolean {
    const loop = this.activeLoop()
    return !!loop && t >= loop.fromS && t < loop.toS
  }

  private enterLoopIfOutside(): void {
    const loop = this.activeLoop()
    if (this.repeat && loop && !this.isInside(this.element.currentTime)) {
      this.jumpTo(loop.fromS)
    }
  }

  /** Moves the playhead to `target`, in seconds into the loaded blob. */
  private jumpTo(target: number): void {
    this.cancelTimer()
    this.element.currentTime = target
    this.insideLoop = this.isInside(target)
    this.setState({ positionMs: this.positionMsFor(target) })
    this.reportPosition()
    this.jumped()
  }

  private jumped(): void {
    for (const fn of this.jumpListeners) fn()
  }

  private cancelTimer(): void {
    this.cancelEndTimer?.()
    this.cancelEndTimer = null
  }

  private clearLoop(): void {
    this.cancelTimer()
    this.loop = null
    this.repeat = false
    this.insideLoop = false
    this.setState({ loop: null, repeat: false })
  }

  private positionMsFor(currentTime: number): number {
    return Math.max(0, Math.round((currentTime - this.span.fromS) * 1000))
  }

  private applySpeed(percent: number): void {
    this.#speedPercent = percent
    this.element.playbackRate = percent / 100
    // Once a working pitch stage exists it owns the pitch shift, so the element must stop
    // correcting for speed on its own or the two corrections would compound.
    const preserves = this.#pitchStage === null || this.state.pitchUnavailable
    this.element.preservesPitch = preserves
    const legacy = this.element as LegacyPitchElement
    if ('webkitPreservesPitch' in legacy) legacy.webkitPreservesPitch = preserves
  }

  private updateTranspose(): void {
    this.#pitchStage?.setTranspose(compensatedSemitones(this.#pitchCents, this.#speedPercent))
  }

  /** Resumes an already-built AudioContext synchronously (iOS requires this inside the tap
   * that called play), regardless of the stored pitch: a stage built earlier can still be
   * suspended by iOS (backgrounding, a call) after the pitch was set back to 0. Calls
   * resume() unconditionally rather than only when the state already reads 'suspended':
   * unload()'s own suspend() is async and the state does not flip until the browser
   * processes it, so a play() or prime() landing in that window would otherwise see
   * 'running' and skip resuming, leaving playback silently suspended once that pending
   * suspend does land. Queuing a resume regardless orders it after any pending suspend,
   * per spec, so it always wins. */
  private resumeAudioContext(): void {
    const context = this.#audioContext
    if (!context || context.state === 'closed') return
    void context.resume().catch(() => {})
  }

  /** Creates the AudioContext synchronously (iOS requires this inside the tap that called
   * setPitch/play), then kicks off the async stage load at most once. */
  private ensurePitchStage(): void {
    let context: AudioContext
    try {
      this.#audioContext ??= new AudioContext()
      context = this.#audioContext
    } catch {
      this.setState({ pitchUnavailable: true })
      return
    }
    this.resumeAudioContext()
    if (this.#pitchStage || this.#stageRequested) return
    this.#stageRequested = true
    // Claimed only once the graph actually builds, not on every resume above, so a plain
    // resume never blocks a recording that starts afterward from reclaiming the session.
    setAudioSessionType('playback')
    this.createStage(context, this.element)
      .then((stage) => {
        this.#pitchStage = stage
        this.setState({ pitchUnavailable: false })
        this.applySpeed(this.#speedPercent)
        this.updateTranspose()
        if (!this.element.paused) {
          stage.start().catch(this.onStageStartFailed)
        }
      })
      .catch(() => this.setState({ pitchUnavailable: true }))
  }

  private applyMetadata(meta: PlaybackMeta): void {
    const session = mediaSession()
    if (!session || typeof MediaMetadata === 'undefined') return
    session.metadata = new MediaMetadata({ title: meta.title })
  }

  private registerActionHandlers(): void {
    const session = mediaSession()
    if (!session) return
    setActionHandler(session, 'play', () => this.play())
    setActionHandler(session, 'pause', () => this.pause())
    setActionHandler(session, 'seekbackward', (details) => {
      const offsetMs = (details.seekOffset ?? DEFAULT_SEEK_OFFSET_S) * 1000
      this.seek(this.positionMsFor(this.element.currentTime) - offsetMs)
    })
    setActionHandler(session, 'seekforward', (details) => {
      const offsetMs = (details.seekOffset ?? DEFAULT_SEEK_OFFSET_S) * 1000
      this.seek(this.positionMsFor(this.element.currentTime) + offsetMs)
    })
    setActionHandler(session, 'seekto', (details) => {
      if (details.seekTime === undefined) return
      this.seek(details.seekTime * 1000)
    })
  }

  private clearActionHandlers(): void {
    const session = mediaSession()
    if (!session) return
    for (const action of MEDIA_SESSION_ACTIONS) setActionHandler(session, action, null)
  }

  private reportPosition(): void {
    const session = mediaSession()
    if (!session?.setPositionState) return
    const duration = this.span.lengthMs / 1000
    if (!Number.isFinite(duration) || duration <= 0) return
    const position = clamp(this.element.currentTime - this.span.fromS, 0, duration)
    try {
      session.setPositionState({ duration, position, playbackRate: this.element.playbackRate })
    } catch {
      // Some browsers refuse a position outside [0, duration] mid-seek; the next tick retries.
    }
  }

  private setState(patch: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn(this.state)
  }
}
