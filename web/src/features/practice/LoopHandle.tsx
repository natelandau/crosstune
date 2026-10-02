import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { clamp } from '../../math'
import { formatDuration } from '../recording/format'
import { DRAG_THRESHOLD_PX, resizeSpan, snapMs, type Bounds, type Span } from './loopModel'
import { msAtX, xOfMs, type LaneView } from './practiceZoom'
import { useAutoPan } from './useAutoPan'
import type { Draft } from './useLoopGestures'
import { capturePointer } from '../../platform/pointer'

export const LOOP_START = 'Loop start'
export const LOOP_END = 'Loop end'

/** `B part start, 0:58`, a handle's place on the trimmed timeline. */
export function HANDLE_TEXT(name: string, edge: 'start' | 'end', trimmedMs: number): string {
  return `${name} ${edge}, ${formatDuration(trimmedMs)}`
}

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
  snapTargets,
  surface,
  onDraft,
  onCommit,
  onPan,
  onReveal,
  pinches,
}: {
  edge: 'start' | 'end'
  id: string
  name: string
  color: number
  /** The loop as shown, a draft ahead of its row included. */
  span: Span
  view: LaneView
  bounds: Bounds
  snapTargets: readonly number[]
  /** The element the view's pixels are measured from. */
  surface: RefObject<HTMLDivElement | null>
  /** A draft while the handle moves; null when a drag ends without a write. */
  onDraft: (draft: Draft | null) => void
  onCommit: (draft: Draft) => void
  onPan: (deltaMs: number) => void
  /** Brings a handle the keyboard reached from outside the view into it. */
  onReveal: (sourceMs: number) => void
  /** Counts pinches; a drag that gave way to one puts the loop back and writes nothing. */
  pinches: RefObject<number>
}) {
  const latest = useRef(span)
  useLayoutEffect(() => {
    latest.current = span
  })
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

  const ms = span[edge === 'start' ? 'startMs' : 'endMs']
  const x = xOfMs(view, ms)
  const inView = x >= 0 && x <= view.widthPx

  const localX = (clientX: number) => clientX - (surface.current?.getBoundingClientRect().left ?? 0)

  /** Moves the edge to the pointer, snapped unless Alt or Option is held. */
  const dragTo = (clientX: number) => {
    const pressed = press.current
    if (!pressed) return
    const raw = msAtX(view, localX(clientX))
    const to = pressed.alt ? raw : snapMs(raw, snapTargets, 1000 / view.pxPerS)
    const next = resizeSpan(pressed.span, edge, Math.round(to), bounds)
    latest.current = next
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
    const current = latest.current
    const at = edge === 'start' ? current.startMs : current.endMs
    const next = resizeSpan(current, edge, at + steps[event.shiftKey ? 1 : 0], bounds)
    latest.current = next
    nudged.current = true
    onDraft({ id, ...next })
    onReveal(edge === 'start' ? next.startMs : next.endMs)
  }
  const commitNudge = () => {
    if (!nudged.current) return
    nudged.current = false
    onCommit({ id, ...latest.current })
  }
  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (KEY_STEPS[event.key]) commitNudge()
  }

  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current
    if (pressed?.pointerId !== event.pointerId) return
    press.current = null
    autoPan.stop()
    if (pressed.moved) onDraft(null)
  }

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current
    if (!pressed || pressed.pointerId !== event.pointerId) return
    press.current = null
    autoPan.stop()
    if (!pressed.moved) return
    if (pinches.current === pressed.pinch) onCommit({ id, ...latest.current })
    else onDraft(null)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      data-handle={edge}
      aria-label={edge === 'start' ? LOOP_START : LOOP_END}
      aria-valuemin={0}
      aria-valuemax={bounds.endMs - bounds.startMs}
      aria-valuenow={ms - bounds.startMs}
      aria-valuetext={HANDLE_TEXT(name, edge, ms - bounds.startMs)}
      data-color={color}
      // A 44 px target around a thin line; off the view it stays reachable by keyboard.
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
          span: latest.current,
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
      <span className="h-full w-0.5 bg-(--loop)" />
      <span
        className={`absolute size-3 rounded-full bg-(--loop) ${edge === 'start' ? '-top-1.5' : '-bottom-1.5'}`}
      />
    </div>
  )
}
