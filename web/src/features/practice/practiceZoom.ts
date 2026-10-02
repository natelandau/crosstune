import type { Span } from './loopModel'
import { clamp } from '../../math'

/**
 * The zoomed view as a scale and the time at its center, both on the trimmed timeline. A scale
 * rather than a window, so a wider screen (a phone turned on its side) shows more seconds at
 * the same detail.
 */
export type ZoomState = { pxPerS: number; centerMs: number }

/** What a zoom is held inside: the view's width and the trimmed recording's length. */
export type ZoomFrame = { widthPx: number; lengthMs: number }

/** Four pixels for each 20 ms peak, past which the bars only repeat themselves. */
export const MAX_PX_PER_S = 200

/** How much of the recording the view shows when there is no loop to fit. */
export const OPENING_SPAN_MS = 30_000

/** The margin a fitted span keeps on each side, as a share of its length. */
const FIT_MARGIN = 0.1

/** The scale at which the whole recording fills the view. */
export function minPxPerS(widthPx: number, lengthMs: number): number {
  if (widthPx <= 0 || lengthMs <= 0) return MAX_PX_PER_S
  return Math.min(MAX_PX_PER_S, widthPx / (lengthMs / 1000))
}

export function visibleSpan(state: ZoomState, widthPx: number): Span {
  const half = ((widthPx / state.pxPerS) * 1000) / 2
  return { startMs: state.centerMs - half, endMs: state.centerMs + half }
}

/** The state held to the scale limits, with the view kept inside the recording. */
export function clampZoom(state: ZoomState, { widthPx, lengthMs }: ZoomFrame): ZoomState {
  const pxPerS = clamp(state.pxPerS, minPxPerS(widthPx, lengthMs), MAX_PX_PER_S)
  const half = ((widthPx / pxPerS) * 1000) / 2
  const centerMs =
    half * 2 >= lengthMs ? lengthMs / 2 : clamp(state.centerMs, half, lengthMs - half)
  return pxPerS === state.pxPerS && centerMs === state.centerMs ? state : { pxPerS, centerMs }
}

/** Zooms by `factor`, keeping `anchorMs` at the same place on screen. */
export function zoomBy(
  state: ZoomState,
  factor: number,
  anchorMs: number,
  frame: ZoomFrame,
): ZoomState {
  const pxPerS = clamp(
    state.pxPerS * factor,
    minPxPerS(frame.widthPx, frame.lengthMs),
    MAX_PX_PER_S,
  )
  const applied = pxPerS / state.pxPerS
  return clampZoom({ pxPerS, centerMs: anchorMs + (state.centerMs - anchorMs) / applied }, frame)
}

/** Pans by `deltaMs`, returning `state` itself when the view's ends refuse the pan. */
export function panBy(state: ZoomState, deltaMs: number, frame: ZoomFrame): ZoomState {
  const panned = clampZoom({ ...state, centerMs: state.centerMs + deltaMs }, frame)
  return panned.centerMs === state.centerMs && panned.pxPerS === state.pxPerS ? state : panned
}

/** Frames `span` with a tenth of its length as margin on each side. Not clamped. */
export function fitSpan(span: Span, widthPx: number): ZoomState {
  const length = span.endMs - span.startMs
  const shownMs = length * (1 + 2 * FIT_MARGIN)
  return {
    pxPerS: shownMs > 0 ? widthPx / (shownMs / 1000) : MAX_PX_PER_S,
    centerMs: span.startMs + length / 2,
  }
}

/**
 * The view to show once the playhead has moved: unchanged while the playhead is inside it, so
 * a repeating loop never moves the screen, or turned to the page that starts at the playhead
 * once it leaves. Not clamped.
 */
export function pageToKeep(state: ZoomState, playheadMs: number, widthPx: number): ZoomState {
  const { startMs, endMs } = visibleSpan(state, widthPx)
  if (playheadMs >= startMs && playheadMs <= endMs) return state
  return { ...state, centerMs: playheadMs + (endMs - startMs) / 2 }
}

/** Where Practice opens: fitted to the selected loop, or 30 seconds around the playhead. */
export function openingZoom(loop: Span | null, playheadMs: number, frame: ZoomFrame): ZoomState {
  if (loop) return clampZoom(fitSpan(loop, frame.widthPx), frame)
  return clampZoom(
    { pxPerS: frame.widthPx / (OPENING_SPAN_MS / 1000), centerMs: playheadMs },
    frame,
  )
}

/** Where the zoomed view sits, for mapping between the source timeline and its pixels. */
export interface LaneView {
  /** The view's left edge, on the trimmed timeline. */
  startMs: number
  pxPerS: number
  widthPx: number
  /** Where the trimmed timeline starts on the source timeline. */
  trimStartMs: number
}

/** The x of a source time, in pixels from the view's left edge. */
export function xOfMs(view: LaneView, sourceMs: number): number {
  return ((sourceMs - view.trimStartMs - view.startMs) / 1000) * view.pxPerS
}

/** The source time at `x` pixels from the view's left edge. */
export function msAtX(view: LaneView, x: number): number {
  return view.trimStartMs + view.startMs + (x / view.pxPerS) * 1000
}
