import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { clamp } from '../../math'
import { useLatest } from '../../ui/useLatest'
import type { PlaybackEngine } from '../player/playbackEngine'
import { trimmedLengthMs } from './recordingRange'
import type { RecordingView } from '../recordings/useRecordings'
import type { Bounds, Span } from '../../domain/loopModel'
import { fitScale, MAX_PX_PER_S, minPxPerS, openingScale, zoomScale } from './practiceZoom'
import type { WaveformScrub } from './PracticeWaveform'

export interface PracticeTimeline {
  /** True once the engine knows the take's length. */
  loaded: boolean
  /** Loaded and not failed: offline, unavailable, or failed audio cannot place a loop by ear. */
  audioReady: boolean
  playing: boolean
  /** The trimmed take's length, from the row until the engine has loaded. */
  lengthMs: number
  /** The engine's position on the trimmed timeline. */
  positionMs: number
  /** Where the playhead shows on the trimmed timeline, a scrub under way included. */
  shownMs: number
  /** `shownMs` on the source timeline. */
  playheadMs: number
  /** The engine's position on the source timeline, which the waveform draws itself from. */
  enginePlayheadMs: number
  /** The waveform's scrub, for the commands to settle and read. */
  scrub: RefObject<WaveformScrub | null>
  /** The waveform reports a scrub's playhead here, or null when it lets go. */
  onScrubbing: (ms: number | null) => void
  /** Stops a glide under way where it shows. */
  settle: () => void
  /** The shown playhead on the trimmed timeline, which a playing engine can be ahead of. */
  shownPositionMs: () => number
  /** Stops a glide and returns the shown playhead on the source timeline. */
  settledPlayheadMs: () => number
  /** The trimmed take on the source timeline. */
  bounds: Bounds
  /** The scale at which the whole take fills the view. */
  minScale: number
  /** The scale the musician or the opening chose, before it is held to the frame. */
  scale: number | null
  /** The scale drawn, or null while there is none yet. */
  pxPerS: number | null
  /** What the view shows on the trimmed timeline, centered on the playhead. */
  visible: { startMs: number; endMs: number } | null
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
}: {
  view: RecordingView
  engine: PlaybackEngine
  size: { width: number }
}): PracticeTimeline {
  const { recording, file } = view
  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const trimStartMs = recording.trim_start_ms
  const loaded = state.lengthMs > 0
  const audioReady = loaded && !state.failed
  const lengthMs = loaded ? state.lengthMs : (trimmedLengthMs(recording, file) ?? 0)
  const positionMs = loaded ? state.positionMs : 0

  // Every command acts where the playhead shows, which a scrub or glide under way moves ahead
  // of the engine, and stops a glide first so it cannot carry the playhead off afterward.
  const scrub = useRef<WaveformScrub | null>(null)
  const [scrubbingMs, setScrubbingMs] = useState<number | null>(null)
  const shownMs = loaded ? (scrubbingMs ?? positionMs) : 0
  const playheadMs = trimStartMs + shownMs
  const settle = () => {
    scrub.current?.settleGlide()
  }
  const shownPositionMs = () => scrub.current?.shownMs() ?? engine.getState().positionMs
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
      setScale(openingScale(loop, playheadMs, widthPx))
      setOpenedAt(widthPx)
    }
  }
  // Held to the frame as it stands, so turning the phone keeps the scale wherever it still fits.
  const pxPerS = scale === null ? null : clamp(scale, minScale, MAX_PX_PER_S)
  const frameRef = useLatest({ widthPx, lengthMs })
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

  const half = pxPerS ? (widthPx / 2 / pxPerS) * 1000 : 0
  const visible = pxPerS ? { startMs: shownMs - half, endMs: shownMs + half } : null

  return {
    loaded,
    audioReady,
    playing: state.playing,
    lengthMs,
    positionMs,
    shownMs,
    playheadMs,
    enginePlayheadMs: trimStartMs + positionMs,
    scrub,
    onScrubbing: setScrubbingMs,
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
    visible,
    canZoomIn: !!pxPerS && pxPerS < MAX_PX_PER_S,
    canZoomOut: !!pxPerS && pxPerS > minScale,
    open,
    zoom,
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
