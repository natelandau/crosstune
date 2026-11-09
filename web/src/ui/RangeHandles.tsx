import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { clamp } from '../math'
import { capturePointer, dragTravel } from '../platform/pointer'
import { keyStep, useStepCommit } from './keySteps'
import { useLatest } from './useLatest'
import { useWindowPointerEnd } from './useWindowPointerEnd'

export type RangeEdgeName = 'start' | 'end'
/** What a press holds: one edge, or the span between them. */
export type RangeGrab = RangeEdgeName | 'span'

/** An edge's value as a slider announces it, in the caller's own units. */
export interface RangeEdgeValues {
  min: number
  max: number
  now: number
  text?: string
}

/**
 * One edge of a range: a 44 px target around a 2 px line, with a grip tab outside the range so
 * it never covers what is inside. Drawn in the loop color slot `color`.
 */
export function RangeEdge({
  edge,
  color,
  ref,
  ...props
}: {
  edge: RangeEdgeName
  color: number
  ref?: Ref<HTMLDivElement>
} & Omit<HTMLAttributes<HTMLDivElement>, 'color'>) {
  return (
    <div
      ref={ref}
      data-handle={edge}
      data-color={color}
      className="loop-color absolute inset-y-0 z-10 flex w-11 -translate-x-1/2 cursor-ew-resize touch-none justify-center rounded-(--radius-inner) outline-offset-0 select-none"
      {...props}
    >
      <span className="h-full w-0.5 bg-(--loop-handle)" />
      <span
        data-grip
        className={`absolute top-1/2 flex h-11 w-4 -translate-y-1/2 items-center justify-center gap-0.5 bg-(--loop-handle) ${edge === 'start' ? 'right-1/2 rounded-l-(--radius-inner)' : 'left-1/2 rounded-r-(--radius-inner)'}`}
      >
        <span className="bg-on-accent-fill h-4 w-px" />
        <span className="bg-on-accent-fill h-4 w-px" />
      </span>
    </div>
  )
}

/** `edge` moved to `to`, held on the track and the shortest span from the other edge. */
function placeEdge(
  edge: RangeEdgeName,
  to: number,
  start: number,
  end: number,
  minSpan: number,
): [number, number] {
  if (edge === 'start') return [clamp(to, 0, Math.max(0, Math.min(1, end - minSpan))), end]
  return [start, clamp(to, Math.min(1, Math.max(0, start + minSpan)), 1)]
}

/** The edge an element draws, from its `data-handle`. */
const edgeOf = (element: HTMLElement): RangeEdgeName =>
  element.dataset.handle === 'end' ? 'end' : 'start'
/** What a press on an element holds: its edge, or the span, which has no `data-handle`. */
const grabOf = (element: HTMLElement): RangeGrab =>
  element.dataset.handle === undefined ? 'span' : edgeOf(element)

interface Press {
  pointerId: number
  grab: RangeGrab
  startX: number
  leftPx: number
  widthPx: number
  start: number
  end: number
  moved: boolean
}

interface RangeHandlesBase {
  start: number
  end: number
  /** The shortest the span gets, as a fraction of the track. */
  minSpan: number
  /** `grab` is what moved. */
  onChange: (start: number, end: number, grab: RangeGrab) => void
  /** Once a drag lets go, or a stepping key or the focus leaves an edge. */
  onCommit?: (start: number, end: number) => void
  /** The loop color slot both edges and the span draw in. */
  color: number
  startLabel: string
  endLabel: string
  step: number
  largeStep: number
  /** What draws behind the range, such as an outline of the audio. */
  children?: ReactNode
  /** Each edge's value as announced; the fraction itself by default. */
  values?: (edge: RangeEdgeName) => RangeEdgeValues
  /** The range as the caller can hold it, such as whole values, before it is written. */
  place?: (grab: RangeGrab, start: number, end: number) => [number, number]
  /** Whether Page Up and Page Down step by `largeStep`. */
  pageKeys?: boolean
  /** A copy for the pointer alone: neither announced nor reached by the keyboard. */
  decorative?: boolean
  className?: string
  onFocusEdge?: (edge: RangeEdgeName) => void
  /** What a press holds as it begins, and null once it ends. */
  onPressChange?: (grab: RangeGrab | null) => void
}

/** Only a travel press measures from where it began, so only it can move the span or go back. */
export type RangeHandlesProps = RangeHandlesBase &
  (
    | {
        dragMode?: 'travel'
        /** Whether a drag inside the span moves both edges. */
        moveSpan?: boolean
        onCancel?: () => void
      }
    | { dragMode: 'pointer'; moveSpan?: never; onCancel?: never }
  )

/**
 * A range along a track with a draggable edge at each end. Each edge is a slider the arrows
 * step, by `largeStep` with Shift. Values are fractions of the track, 0 to 1; an edge outside
 * the track is not drawn unless it is being dragged, when it waits at the track's end.
 *
 * Only a primary mouse button presses. `dragMode` is how a press moves:
 * - `travel`: an edge, or the span with `moveSpan`, moves as far as the pointer has moved
 *   since the press, once past the drag threshold. The press stays inside this control, and a
 *   cancelled press puts the range back.
 * - `pointer`: the pressed edge goes where the pointer is from the first move, and a pointer up
 *   anywhere ends the press. A cancelled press keeps where it reached.
 *
 * With `onCancel` (travel only), Escape during a press also puts the range back and calls it.
 */
export function RangeHandles(props: RangeHandlesProps) {
  const {
    start,
    end,
    minSpan,
    onChange,
    onCommit,
    color,
    startLabel,
    endLabel,
    step,
    largeStep,
    children,
    values,
    place,
    pageKeys = false,
    decorative = false,
    className = '',
    onFocusEdge,
    onPressChange,
  } = props
  const dragMode = props.dragMode ?? 'travel'
  const moveSpan = props.dragMode === 'pointer' ? false : (props.moveSpan ?? false)
  const onCancel = props.dragMode === 'pointer' ? undefined : props.onCancel
  const rangeRef = useLatest({ start, end })
  const track = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  // The ref answers the pointer handlers at once, since a move can follow its pointerdown
  // before a render; the state keeps a dragged edge drawn.
  const [pressed, setPressed] = useState<RangeGrab | null>(null)
  const steps = useStepCommit(
    () => onCommit?.(rangeRef.current.start, rangeRef.current.end),
    pageKeys,
  )

  const write = ([nextStart, nextEnd]: [number, number], grab: RangeGrab) => {
    const current = rangeRef.current
    if (nextStart === current.start && nextEnd === current.end) return
    rangeRef.current = { start: nextStart, end: nextEnd }
    onChange(nextStart, nextEnd, grab)
  }
  const change = (next: [number, number], grab: RangeGrab) =>
    write(place ? place(grab, next[0], next[1]) : next, grab)

  const endPress = (commit: boolean) => {
    const ended = press.current
    if (!ended) return null
    press.current = null
    setPressed(null)
    onPressChange?.(null)
    if (commit && ended.moved) onCommit?.(rangeRef.current.start, rangeRef.current.end)
    return ended
  }
  const springBack = () => {
    const ended = endPress(false)
    if (ended?.moved) write([ended.start, ended.end], ended.grab)
    return ended
  }

  // A pointer edge's own pointerup can miss, as when its capture is lost, so the window's is
  // what reliably ends that press.
  useWindowPointerEnd(pressed !== null && dragMode === 'pointer', () => endPress(true))
  const onWindowKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (springBack()) onCancel?.()
  })
  const cancellable = onCancel !== undefined
  useEffect(() => {
    if (!pressed || !cancellable) return
    const onKey = (event: globalThis.KeyboardEvent) => onWindowKey(event)
    // Capture, so Escape cancels the drag before anything else hears it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pressed, cancellable])

  const startPress = (event: PointerEvent<HTMLDivElement>) => {
    const grab = grabOf(event.currentTarget)
    capturePointer(event.currentTarget, event.pointerId)
    const rect = track.current?.getBoundingClientRect()
    press.current = {
      pointerId: event.pointerId,
      grab,
      startX: event.clientX,
      leftPx: rect?.left ?? 0,
      widthPx: rect?.width ?? 0,
      ...rangeRef.current,
      moved: false,
    }
    setPressed(grab)
    onPressChange?.(grab)
  }

  const travelCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId !== event.pointerId) return
    springBack()
    onCancel?.()
  }
  const travelDrags = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      event.stopPropagation()
      startPress(event)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const held = press.current
      if (!held || held.pointerId !== event.pointerId || held.widthPx === 0) return
      event.stopPropagation()
      const dx = dragTravel(held, event.clientX)
      if (dx === null) return
      held.moved = true
      const by = dx / held.widthPx
      if (held.grab === 'span') {
        const shift = clamp(by, -held.start, 1 - held.end)
        change([held.start + shift, held.end + shift], 'span')
      } else {
        const to = held[held.grab] + by
        change(placeEdge(held.grab, to, held.start, held.end, minSpan), held.grab)
      }
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (press.current?.pointerId === event.pointerId) endPress(true)
    },
    onPointerCancel: travelCancel,
    // After a pointerup the press is already gone, so only a capture taken away mid-drag lands.
    onLostPointerCapture: travelCancel,
  }

  const pointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.type === 'pointercancel' || press.current?.grab === grabOf(event.currentTarget)) {
      endPress(false)
    }
  }
  const pointerDrags = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      startPress(event)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const held = press.current
      if (!held) return
      const grab = grabOf(event.currentTarget)
      if (held.grab !== grab || grab === 'span' || held.widthPx === 0) return
      held.moved = true
      const at = clamp((event.clientX - held.leftPx) / held.widthPx, 0, 1)
      const current = rangeRef.current
      change(placeEdge(grab, at, current.start, current.end, minSpan), grab)
    },
    onPointerUp: () => endPress(true),
    onPointerCancel: pointerCancel,
    onLostPointerCapture: pointerCancel,
  }

  const drags = dragMode === 'pointer' ? pointerDrags : travelDrags

  const keys = {
    onFocus: (event: FocusEvent<HTMLDivElement>) => onFocusEdge?.(edgeOf(event.currentTarget)),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const by = keyStep(event, step, largeStep, pageKeys)
      if (by === null) return
      event.preventDefault()
      steps.stepped()
      const edge = edgeOf(event.currentTarget)
      const current = rangeRef.current
      change(placeEdge(edge, current[edge] + by, current.start, current.end, minSpan), edge)
    },
    onKeyUp: steps.onKeyUp,
    onBlur: steps.onBlur,
  }

  const edgeView = (edge: RangeEdgeName) => {
    const value = edge === 'start' ? start : end
    if (pressed !== edge && (value < 0 || value > 1)) return null
    const announced = values?.(edge) ?? { min: 0, max: 1, now: value }
    return (
      <RangeEdge
        key={edge}
        edge={edge}
        color={color}
        style={{ left: `${clamp(value, 0, 1) * 100}%` }}
        {...(decorative
          ? { 'aria-hidden': true }
          : {
              role: 'slider',
              tabIndex: 0,
              'aria-label': edge === 'start' ? startLabel : endLabel,
              'aria-orientation': 'horizontal' as const,
              'aria-valuemin': announced.min,
              'aria-valuemax': announced.max,
              'aria-valuenow': announced.now,
              'aria-valuetext': announced.text,
              ...keys,
            })}
        {...drags}
      />
    )
  }

  const startAt = clamp(start, 0, 1) * 100
  const endAt = clamp(end, 0, 1) * 100
  return (
    <div ref={track} data-range-track className={`relative ${className}`}>
      {children}
      <div
        aria-hidden="true"
        data-range-span
        data-color={color}
        style={{ left: `${startAt}%`, width: `${endAt - startAt}%` }}
        className={`loop-color absolute inset-y-0 bg-(--loop-tint) ${moveSpan ? 'cursor-grab touch-none' : 'pointer-events-none'}`}
        {...(moveSpan ? drags : {})}
      />
      {edgeView('start')}
      {edgeView('end')}
    </div>
  )
}
