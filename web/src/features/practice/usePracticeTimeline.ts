import { animate, useReducedMotionConfig, type AnimationPlaybackControls } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { clamp } from '../../math'
import { useLatest } from '../../ui/useLatest'
import type { PlaybackEngine } from '../player/playbackEngine'
import { useEngineState } from '../player/PlaybackEngineProvider'
import { usePlayheadClock, type FrameSource, type PlayheadClock } from '../player/playheadClock'
import { trimmedLengthMs } from './recordingRange'
import type { RecordingView } from '../recordings/useRecordings'
import type { Bounds, Span } from '../../domain/loopModel'
import {
  fitScale,
  MAX_PX_PER_S,
  minPxPerS,
  openingScale,
  stretchedScale,
  zoomScale,
} from './practiceZoom'
import { SPRING } from '../../theme/motion'
import type { WaveformScrub } from './PracticeWaveform'

export interface PracticeTimeline {
  /** True once the engine knows the take's length. */
  loaded: boolean
  /** Loaded and not failed: offline, unavailable, or failed audio cannot place a loop by ear. */
  audioReady: boolean
  playing: boolean
  /** The trimmed take's length, from the row until the engine has loaded. */
  lengthMs: number
  /**
   * Where the playhead is drawn on the trimmed timeline, a scrub under way included, which moves
   * every frame outside React. Read a fact of it with `usePlayhead`.
   */
  playhead: PlayheadClock
  /** The drawn playhead held to the take, on the source timeline. */
  playheadMs: () => number
  /** The waveform's scrub, for the commands to settle and read. */
  scrub: RefObject<WaveformScrub | null>
  /** Stops a momentum scroll under way where it shows. */
  settle: () => void
  /** The playhead now on the trimmed timeline, a scrub under way included, which a playing
   * engine has moved on from since the last frame. */
  shownPositionMs: () => number
  /** Stops a momentum scroll and returns the shown playhead on the source timeline. */
  settledPlayheadMs: () => number
  /** The trimmed take on the source timeline. */
  bounds: Bounds
  /** The scale at which the whole take fills the view. */
  minScale: number
  /** The scale the musician or the opening chose, before it is held to the frame. */
  scale: number | null
  /** The scale drawn, or null while there is none yet. */
  pxPerS: number | null
  /** Half the time the view shows, or null while there is no scale. */
  halfSpanMs: number | null
  /** False once zooming in can go no further, or while there is no scale. */
  canZoomIn: boolean
  /** False once the whole take shows, or while there is no scale. */
  canZoomOut: boolean
  /**
   * Frames the opening view on `loop` (the selected loop's span), or 30 seconds around the
   * playhead without one; it does nothing after the musician sets a scale. It sets this hook's
   * state while rendering, so its caller must render in the same component, after this hook.
   * `usePracticeLoops` calls it once the loops are read.
   */
  open: (loop: Span | null) => void
  /** Multiplies the scale by `factor`, held between the whole take and the maximum. */
  zoom: (factor: number) => void
  /**
   * Multiplies the scale by `factor` for a pinch under way, which stretches past either limit
   * with resistance until `endPinch` springs it back.
   */
  pinchZoom: (factor: number) => void
  endPinch: () => void
  /**
   * Frames `loop` and brings the playhead into it, or shows the whole take. Prefer
   * `usePracticeLoops`'s `fit`, which passes the selected loop as drawn.
   */
  fit: (loop: Span | null) => void
  togglePlay: () => void
  /** Moves the playhead by `deltaMs` from where it shows. */
  skip: (deltaMs: number) => void
  /** Moves the playhead to `ms` on the trimmed timeline, from where it shows. */
  seek: (ms: number) => void
  /** Says `text` through practice's live region. */
  announce: (text: string) => void
  announcement: string
}

/**
 * Practice's playhead, zoom, and transport. The zoom is a scale only: the playhead is always
 * the view's center. `size` is the waveform's measured slot.
 */
export function usePracticeTimeline({
  view,
  engine,
  size,
  frames,
}: {
  view: RecordingView
  engine: PlaybackEngine
  size: { width: number }
  /** What the playhead's frames run on, for a test to step them. */
  frames?: FrameSource
}): PracticeTimeline {
  const { recording, file } = view
  // Only discrete facts render; the position moves through `playhead`.
  const engineLengthMs = useEngineState(engine, (s) => s.lengthMs)
  const failed = useEngineState(engine, (s) => s.failed)
  const playing = useEngineState(engine, (s) => s.playing)
  const playhead = usePlayheadClock(engine, { frames })
  const trimStartMs = recording.trim_start_ms
  const loaded = engineLengthMs > 0
  const audioReady = loaded && !failed
  const lengthMs = loaded ? engineLengthMs : (trimmedLengthMs(recording, file) ?? 0)

  // Every command acts where the playhead shows, which a scrub or momentum scroll under way
  // moves ahead of the engine, and stops a momentum scroll first so it cannot carry the
  // playhead off afterward.
  const scrub = useRef<WaveformScrub | null>(null)
  // Held to the take: a scrub pulled past an end is drawn there by the waveform alone.
  const playheadMs = () => trimStartMs + (loaded ? clamp(playhead.ms, 0, lengthMs) : 0)
  const settle = () => {
    scrub.current?.settleMomentumScroll()
  }
  const shownPositionMs = () => playhead.live()
  const bounds = useMemo(
    () => ({ startMs: trimStartMs, endMs: trimStartMs + lengthMs }),
    [trimStartMs, lengthMs],
  )

  const [announcement, setAnnouncement] = useState('')
  const announceFrame = useRef(0)
  // Emptied first and filled a frame later, so a message the region already holds is read again.
  const announce = useCallback((message: string) => {
    setAnnouncement('')
    cancelAnimationFrame(announceFrame.current)
    announceFrame.current = requestAnimationFrame(() => setAnnouncement(message))
  }, [])
  useEffect(() => () => cancelAnimationFrame(announceFrame.current), [])

  const widthPx = size.width
  const minScale = minPxPerS(widthPx, lengthMs)
  const [scale, setScale] = useState<number | null>(null)
  // The width the opening scale was taken at, null once the musician sets a scale. Until then
  // the opening view follows the frame, which can still be settling while practice presents.
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  const open = (loop: Span | null) => {
    if (
      (scale === null || (openedAt !== null && openedAt !== widthPx)) &&
      widthPx > 0 &&
      lengthMs > 0
    ) {
      setScale(openingScale(loop, playheadMs(), widthPx))
      setOpenedAt(widthPx)
    }
  }
  // How far a pinch has stretched the drawn scale past a limit, as a factor of it.
  const [stretch, setDrawnStretch] = useState(1)
  // The stretch as last set, since a pinch's lift can arrive before its last move has rendered.
  const stretchNow = useRef(1)
  const setStretch = (next: number) => {
    stretchNow.current = next
    setDrawnStretch(next)
  }
  // Held to the current frame, so turning the phone keeps the scale wherever it still fits.
  const heldScale = scale === null ? null : clamp(scale, minScale, MAX_PX_PER_S)
  const pxPerS = heldScale === null ? null : heldScale * stretch
  const frameRef = useLatest({ widthPx, lengthMs })
  const pxPerSRef = useLatest(pxPerS)
  const reduceMotionRef = useLatest(useReducedMotionConfig() ?? false)
  // The scale the pinch's fingers ask for, before the limits; null between pinches.
  const pinchRaw = useRef<number | null>(null)
  const unstretch = useRef<AnimationPlaybackControls | null>(null)
  useEffect(() => () => unstretch.current?.stop(), [])
  const pinchZoom = (factor: number) => {
    const from = pinchRaw.current ?? pxPerSRef.current
    if (from === null) return
    unstretch.current?.stop()
    unstretch.current = null
    setOpenedAt(null)
    const raw = from * factor
    pinchRaw.current = raw
    const held = zoomScale(raw, 1, frameRef.current)
    setScale(held)
    setStretch(stretchedScale(raw, frameRef.current) / held)
  }
  const endPinch = () => {
    pinchRaw.current = null
    const from = stretchNow.current
    if (from === 1) return
    if (reduceMotionRef.current) {
      setStretch(1)
      return
    }
    unstretch.current = animate(from, 1, {
      ...SPRING,
      onUpdate: setStretch,
      onComplete: () => {
        unstretch.current = null
      },
    })
  }
  const zoom = (factor: number) => {
    setOpenedAt(null)
    setScale((current) =>
      current === null ? current : zoomScale(current, factor, frameRef.current),
    )
  }
  const fit = (loop: Span | null) => {
    settle()
    setOpenedAt(null)
    if (!loop) {
      setScale(minScale)
      return
    }
    const atMs = trimStartMs + shownPositionMs()
    setScale(Math.max(minScale, fitScale(loop, atMs, widthPx)))
    // The playhead is the view's center, so a loop it sits outside of is brought to it.
    if (atMs < loop.startMs || atMs >= loop.endMs) engine.seek(loop.startMs - trimStartMs)
  }

  return {
    loaded,
    audioReady,
    playing,
    lengthMs,
    playhead,
    playheadMs,
    scrub,
    settle,
    shownPositionMs,
    settledPlayheadMs: () => {
      settle()
      return trimStartMs + shownPositionMs()
    },
    bounds,
    minScale,
    scale,
    pxPerS,
    halfSpanMs: pxPerS ? (widthPx / 2 / pxPerS) * 1000 : null,
    canZoomIn: !!pxPerS && pxPerS < MAX_PX_PER_S,
    canZoomOut: !!pxPerS && pxPerS > minScale,
    open,
    zoom,
    pinchZoom,
    endPinch,
    fit,
    togglePlay: () => (engine.getState().playing ? engine.pause() : engine.play()),
    skip: (deltaMs) => {
      settle()
      engine.seek(shownPositionMs() + deltaMs)
    },
    seek: (ms) => {
      settle()
      engine.seek(ms)
    },
    announce,
    announcement,
  }
}
