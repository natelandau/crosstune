import type { Span } from '../../domain/loopModel'
import { clamp } from '../../math'

/** What a zoom is held inside: the view's width and the trimmed recording's length. */
export type ZoomFrame = { widthPx: number; lengthMs: number }

/** Four pixels for each 20 ms peak, past which the bars only repeat themselves. */
export const MAX_PX_PER_S = 200

/** The time constant of a released drag's exponential glide. */
export const GLIDE_TAU_MS = 325

/** How much of the recording the view shows when there is no loop to fit. */
export const OPENING_SPAN_MS = 30_000

/** The margin a fitted span keeps on each side, as a share of its length. */
const FIT_MARGIN = 0.1

/** The scale at which the whole recording fills the view. */
export function minPxPerS(widthPx: number, lengthMs: number): number {
  if (widthPx <= 0 || lengthMs <= 0) return MAX_PX_PER_S
  return Math.min(MAX_PX_PER_S, widthPx / (lengthMs / 1000))
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

/** How far past an end a drag can pull the audio, however far the pointer goes. */
export const RUBBER_REACH_PX = 120
/** How much past a zoom limit a pinch can stretch the scale, as a factor of the limit. */
const RUBBER_REACH_ZOOM = 1.25
// The give at the limit: 1 follows the pointer at first, smaller pulls back harder from the start.
const RUBBER_GIVE = 0.55

/**
 * `overshoot` past a limit, drawn with the rubber band iOS scroll views use: it gives less the
 * farther it is pulled and never reaches `reach`.
 */
export function rubberBand(overshoot: number, reach: number): number {
  const over = Math.abs(overshoot)
  return Math.sign(overshoot) * (1 - 1 / ((over * RUBBER_GIVE) / reach + 1)) * reach
}

/** The overshoot that `rubberBand` draws at `drawn`, its inverse. */
export function unRubberBand(drawn: number, reach: number): number {
  const over = Math.min(Math.abs(drawn), reach * 0.999)
  return Math.sign(drawn) * (reach / RUBBER_GIVE) * (1 / (1 - over / reach) - 1)
}

/**
 * The unstretched time that `scrubMs` draws at `shownMs`, so a press that catches the audio
 * springing back past an end drags on from where it is drawn without a jump.
 */
export function unstretchedMs(shownMs: number, pxPerS: number, lengthMs: number): number {
  const heldMs = clamp(shownMs, 0, lengthMs)
  const drawnPx = ((shownMs - heldMs) / 1000) * pxPerS
  return heldMs + (unRubberBand(drawnPx, RUBBER_REACH_PX) / pxPerS) * 1000
}

/**
 * The playhead time after dragging `dxPx`; dragging right moves back in time. Past either end
 * of the recording the drag pulls on with resistance, and the caller springs it back.
 */
export function scrubMs(fromMs: number, dxPx: number, pxPerS: number, lengthMs: number): number {
  const rawMs = fromMs - (dxPx / pxPerS) * 1000
  const heldMs = clamp(rawMs, 0, lengthMs)
  return heldMs + (rubberBand(((rawMs - heldMs) / 1000) * pxPerS, RUBBER_REACH_PX) / pxPerS) * 1000
}

/** The distance in ms a release at `velocityPxPerS` still travels, from exponential decay. */
export function glideMs(velocityPxPerS: number, pxPerS: number): number {
  return (-velocityPxPerS * GLIDE_TAU_MS) / pxPerS
}

/** A view centered on `centerMs` (trimmed timeline). Never clamped, so the ends show blank. */
export function viewAt(
  pxPerS: number,
  centerMs: number,
  widthPx: number,
  trimStartMs: number,
): LaneView {
  return { startMs: centerMs - (widthPx / 2 / pxPerS) * 1000, pxPerS, widthPx, trimStartMs }
}

/**
 * The scale that frames `span` around a centered playhead at `playheadMs` (source timeline),
 * with the fit margin past its farther end. A playhead outside the span is taken at the span's
 * start, where Fit moves it. Held to the maximum; the caller applies the minimum.
 */
export function fitScale(span: Span, playheadMs: number, widthPx: number): number {
  const atMs = playheadMs >= span.startMs && playheadMs < span.endMs ? playheadMs : span.startMs
  const reachMs =
    Math.max(atMs - span.startMs, span.endMs - atMs) + FIT_MARGIN * (span.endMs - span.startMs)
  return clamp(reachMs > 0 ? widthPx / 2 / (reachMs / 1000) : MAX_PX_PER_S, 0, MAX_PX_PER_S)
}

/** The scale Practice opens at: Fit's for the selected loop, or 30 seconds wide. */
export function openingScale(loop: Span | null, playheadMs: number, widthPx: number): number {
  if (loop) return fitScale(loop, playheadMs, widthPx)
  return widthPx / (OPENING_SPAN_MS / 1000)
}

/** A scale multiplied by `factor` and held between the whole-recording fit and the maximum. */
export function zoomScale(pxPerS: number, factor: number, frame: ZoomFrame): number {
  return clamp(pxPerS * factor, minPxPerS(frame.widthPx, frame.lengthMs), MAX_PX_PER_S)
}

/**
 * A scale a pinch has pulled past a zoom limit, drawn stretched past that limit with
 * resistance. Measured in ratios, so zooming in and out past a limit feel alike.
 */
export function stretchedScale(rawPxPerS: number, frame: ZoomFrame): number {
  const held = clamp(rawPxPerS, minPxPerS(frame.widthPx, frame.lengthMs), MAX_PX_PER_S)
  return held * Math.exp(rubberBand(Math.log(rawPxPerS / held), Math.log(RUBBER_REACH_ZOOM)))
}
