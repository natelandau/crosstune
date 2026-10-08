import {
  useRef,
  useState,
  type KeyboardEvent,
  type TransitionEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { clamp } from '../../math'
import { formatDuration } from '../recording/format'
import {
  DRAG_THRESHOLD_PX,
  resizeSpan,
  snapMs,
  type Bounds,
  type Draft,
  type Span,
} from './loopModel'
import { msAtX, xOfMs, type LaneView } from './practiceZoom'
import { useAutoPan } from './useAutoPan'
import { capturePointer } from '../../platform/pointer'
import { useLatest } from '../../ui/useLatest'

export const LOOP_START = 'Loop start'
export const LOOP_END = 'Loop end'

/** `B part start, 0:58`, a handle's place on the trimmed timeline. */
export function HANDLE_TEXT(name: string, edge: 'start' | 'end', trimmedMs: number): string {
  return `${name} ${edge}, ${formatDuration(trimmedMs)}`
}

/** The handle's own move along the timeline, not a transition inside it or of another property. */
const isSettle = (event: TransitionEvent<HTMLDivElement>) =>
  event.target === event.currentTarget && event.propertyName === 'left'

const NUDGE_MS = 100
const NUDGE_LARGE_MS = 1000
const KEY_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-NUDGE_MS, -NUDGE_LARGE_MS],
  ArrowDown: [-NUDGE_MS, -NUDGE_LARGE_MS],
  ArrowRight: [NUDGE_MS, NUDGE_LARGE_MS],
  ArrowUp: [NUDGE_MS, NUDGE_LARGE_MS],
}

/**
 * One edge of the selected loop on the zoomed waveform: a slider a pointer drags and the
 * arrows nudge. Either way the loop is written once, when the drag or the key lets go.
 */
export function LoopHandle({
  edge,
  id,
  name,
  color,
  span,
  view,
  bounds,
  playheadMs,
  surface,
  onDraft,
  onCommit,
  onPan,
  onReveal,
  onTap,
  pinches,
}: {
  edge: 'start' | 'end'
  id: string
  name: string
  color: number
  /** The loop as shown, a draft ahead of its row included. */
  span: Span
  view: LaneView
  /** The free span around the loop on the source timeline, which the edge never leaves. */
  bounds: Bounds
  /** On the source timeline. */
  playheadMs: number
  /** The element the view's pixels are measured from. */
  surface: RefObject<HTMLDivElement | null>
  /** A draft while the handle moves; null when a drag ends without a write. */
  onDraft: (draft: Draft | null) => void
  onCommit: (draft: Draft) => void
  onPan: (deltaMs: number) => void
  /** Brings a handle the keyboard reached from outside the view into it. */
  onReveal: (sourceMs: number) => void
  /**
   * A press that let go without moving, `x` px from the surface's left edge. The target reaches
   * past the loop's edge, so a tap on it is a tap on the waveform there.
   */
  onTap: (x: number) => void
  /** Counts pinches; a drag that gave way to one puts the loop back and writes nothing. */
  pinches: RefObject<number>
}) {
  const latestRef = useLatest(span)
  const press = useRef<{
    pointerId: number
    startX: number
    span: Span
    moved: boolean
    lastX: number
    alt: boolean
    pinch: number
  } | null>(null)
  const nudged = useRef(false)
  // Whether the drag rests on a snap target, so an app can settle the handle onto it. Kept
  // until a settling transition ends, so letting go mid-settle does not cut it short.
  const [snapped, setSnapped] = useState(false)
  const settling = useRef(false)
  const unsnap = () => {
    if (!settling.current) setSnapped(false)
  }
  const settled = () => {
    settling.current = false
    if (!press.current) setSnapped(false)
  }

  const ms = span[edge === 'start' ? 'startMs' : 'endMs']
  const x = xOfMs(view, ms)
  const inView = x >= 0 && x <= view.widthPx

  const localX = (clientX: number) => clientX - (surface.current?.getBoundingClientRect().left ?? 0)

  /** Moves the edge to the pointer, snapped to the playhead unless Alt or Option is held. */
  const dragTo = (clientX: number) => {
    const pressed = press.current
    if (!pressed) return
    const raw = msAtX(view, localX(clientX))
    const targets = pressed.alt
      ? [bounds.startMs, bounds.endMs]
      : [playheadMs, bounds.startMs, bounds.endMs]
    const to = snapMs(raw, targets, 1000 / view.pxPerS)
    setSnapped(to !== raw)
    const next = resizeSpan(pressed.span, edge, Math.round(to), bounds)
    latestRef.current = next
    onDraft({ id, ...next })
    autoPan.track(localX(clientX))
  }
  const autoPan = useAutoPan({
    view,
    onPan,
    follow: () => {
      if (press.current) dragTo(press.current.lastX)
    },
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps = KEY_STEPS[event.key]
    if (!steps) return
    event.preventDefault()
    const current = latestRef.current
    const at = edge === 'start' ? current.startMs : current.endMs
    const next = resizeSpan(current, edge, at + steps[event.shiftKey ? 1 : 0], bounds)
    latestRef.current = next
    nudged.current = true
    onDraft({ id, ...next })
    onReveal(edge === 'start' ? next.startMs : next.endMs)
  }
  const commitNudge = () => {
    if (!nudged.current) return
    nudged.current = false
    onCommit({ id, ...latestRef.current })
  }
  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (KEY_STEPS[event.key]) commitNudge()
  }

  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current
    if (pressed?.pointerId !== event.pointerId) return
    press.current = null
    autoPan.stop()
    unsnap()
    if (pressed.moved) onDraft(null)
  }

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current
    if (!pressed || pressed.pointerId !== event.pointerId) return
    press.current = null
    autoPan.stop()
    unsnap()
    if (!pressed.moved) {
      if (pinches.current === pressed.pinch) onTap(localX(event.clientX))
      return
    }
    if (pinches.current === pressed.pinch) onCommit({ id, ...latestRef.current })
    else onDraft(null)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      data-handle={edge}
      aria-label={edge === 'start' ? LOOP_START : LOOP_END}
      aria-valuemin={bounds.startMs - view.trimStartMs}
      aria-valuemax={bounds.endMs - view.trimStartMs}
      aria-valuenow={ms - view.trimStartMs}
      aria-valuetext={HANDLE_TEXT(name, edge, ms - view.trimStartMs)}
      data-color={color}
      data-snapped={snapped || undefined}
      onTransitionRun={(event) => {
        if (isSettle(event)) settling.current = true
      }}
      onTransitionEnd={(event) => {
        if (isSettle(event)) settled()
      }}
      onTransitionCancel={(event) => {
        if (isSettle(event)) settled()
      }}
      // A 44 px target around the edge and its tab; off the view it stays reachable by keyboard.
      className={`loop-color absolute inset-y-0 z-10 flex w-11 -translate-x-1/2 cursor-ew-resize touch-none justify-center rounded-md outline-offset-0 select-none ${inView ? '' : 'pointer-events-none opacity-0'}`}
      style={{ left: clamp(x, 0, view.widthPx) }}
      onFocus={() => {
        if (!inView) onReveal(ms)
      }}
      // A key let go elsewhere never reaches this handle's keyup.
      onBlur={commitNudge}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        event.stopPropagation()
        capturePointer(event.currentTarget, event.pointerId)
        press.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          span: latestRef.current,
          moved: false,
          lastX: event.clientX,
          alt: event.altKey,
          pinch: pinches.current,
        }
      }}
      onPointerMove={(event) => {
        const pressed = press.current
        if (!pressed || pressed.pointerId !== event.pointerId) return
        event.stopPropagation()
        if (!pressed.moved && Math.abs(event.clientX - pressed.startX) < DRAG_THRESHOLD_PX) return
        pressed.moved = true
        pressed.lastX = event.clientX
        pressed.alt = event.altKey
        dragTo(event.clientX)
      }}
      onPointerUp={finish}
      onPointerCancel={cancel}
      // After a pointerup the press is already gone, so only a capture taken away mid-drag lands.
      onLostPointerCapture={cancel}
    >
      <span className="h-full w-0.5 bg-(--loop-handle)" />
      {/* The tab sits outside the loop so it never covers the audio being looped. */}
      <span
        data-grip
        className={`absolute top-1/2 flex h-11 w-4 -translate-y-1/2 items-center justify-center gap-0.5 bg-(--loop-handle) ${edge === 'start' ? 'right-1/2 rounded-l-md' : 'left-1/2 rounded-r-md'}`}
      >
        <span className="h-4 w-px bg-white/90" />
        <span className="h-4 w-px bg-white/90" />
      </span>
    </div>
  )
}
