import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { clamp } from '../../math'
import { useLatest } from '../../ui/useLatest'
import type { OutlineSource } from './isolateOutlineFeed'
import { LoopHandleMark } from './LoopHandleMark'
import { useBarCanvas } from './useBarCanvas'
import { capturePress, dragTravel } from './useScrub'

type Scale = 'linear' | 'log'
type Edge = 'start' | 'end'
type Grab = Edge | 'both'

/** A range's place along its control: the value itself, or its octave on the log scale. */
function toUnit(scale: Scale, value: number): number {
  return scale === 'log' ? Math.log2(value) : value
}

function fromUnit(scale: Scale, unit: number): number {
  return scale === 'log' ? 2 ** unit : unit
}

interface Bounds {
  min: number
  max: number
  scale: Scale
  /** The shortest the range gets, in units. */
  minSpan: number
}

/** Whether whole values `from` to `to` fall short of the shortest span. */
function tooShort({ scale, minSpan }: Bounds, from: number, to: number): boolean {
  return toUnit(scale, to) - toUnit(scale, from) < minSpan - 1e-9
}

/**
 * The range with one edge moved to `unit`, in whole values, held inside the bounds and the
 * shortest span from the other edge.
 */
function placeEdge(
  bounds: Bounds,
  edge: Edge,
  unit: number,
  start: number,
  end: number,
): [number, number] {
  const { min, max, scale, minSpan } = bounds
  // A whole value can land a fraction inside the shortest span, so it steps one further out.
  if (edge === 'start') {
    const limit = toUnit(scale, end) - minSpan
    let value = Math.round(fromUnit(scale, clamp(unit, toUnit(scale, min), limit)))
    if (tooShort(bounds, value, end)) value -= 1
    return [clamp(value, min, end), end]
  }
  const limit = toUnit(scale, start) + minSpan
  let value = Math.round(fromUnit(scale, clamp(unit, limit, toUnit(scale, max))))
  if (tooShort(bounds, start, value)) value += 1
  return [start, clamp(value, start, max)]
}

/** The range moved whole by `delta` units, stopping at either end. */
function shiftRange(bounds: Bounds, start: number, end: number, delta: number): [number, number] {
  const { min, max, scale } = bounds
  const low = toUnit(scale, start)
  const high = toUnit(scale, end)
  const by = clamp(delta, toUnit(scale, min) - low, toUnit(scale, max) - high)
  const nextStart = clamp(Math.round(fromUnit(scale, low + by)), min, max)
  const nextEnd = clamp(Math.round(fromUnit(scale, high + by)), min, max)
  // Each edge rounds on its own, so the span can land a fraction short and steps one further out.
  if (!tooShort(bounds, nextStart, nextEnd)) return [nextStart, nextEnd]
  return nextEnd < max ? [nextStart, nextEnd + 1] : [Math.max(nextStart - 1, min), nextEnd]
}

const KEY_DIRECTIONS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
}

/**
 * A range on one axis with a draggable edge at each end: drag an edge to move it, or inside to
 * move both. Each edge is a slider the arrows nudge. A faint outline of the audio sits behind.
 */
export function IsolateRange({
  label,
  startLabel,
  endLabel,
  min,
  max,
  scale,
  start,
  end,
  minSpan,
  step,
  largeStep,
  readout,
  valueText,
  outline,
  onChange,
}: {
  /** The range's name, shown over it with the readout. */
  label: string
  startLabel: string
  endLabel: string
  min: number
  max: number
  scale: Scale
  start: number
  end: number
  /** The shortest span, the step, and the large step, in values or, on the log scale, octaves. */
  minSpan: number
  step: number
  largeStep: number
  /** Where the whole range sits, in words. */
  readout: (start: number, end: number) => string
  /** One edge's value, in words. */
  valueText: (value: number) => string
  /** The audio's level along the range, from 0 to 1 in evenly spaced bins. */
  outline: OutlineSource | null
  onChange: (start: number, end: number) => void
}) {
  const labelId = useId()
  const bounds: Bounds = { min, max, scale, minSpan }
  const rangeRef = useLatest({ start, end })
  const track = useRef<HTMLDivElement>(null)
  const press = useRef<{
    pointerId: number
    grab: Grab
    startX: number
    widthPx: number
    start: number
    end: number
    moved: boolean
  } | null>(null)

  const low = toUnit(scale, min)
  const high = toUnit(scale, max)
  const at = (value: number) => `${((toUnit(scale, value) - low) / (high - low)) * 100}%`

  const change = ([nextStart, nextEnd]: [number, number]) => {
    const current = rangeRef.current
    if (nextStart === current.start && nextEnd === current.end) return
    rangeRef.current = { start: nextStart, end: nextEnd }
    onChange(nextStart, nextEnd)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const edge = event.currentTarget.dataset.rangeGrab as Edge
    const direction = KEY_DIRECTIONS[event.key]
    if (direction === undefined) return
    event.preventDefault()
    const current = rangeRef.current
    const by = direction * (event.shiftKey ? largeStep : step)
    change(placeEdge(bounds, edge, toUnit(scale, current[edge]) + by, current.start, current.end))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const grab = event.currentTarget.dataset.rangeGrab as Grab
    if (!capturePress(event)) return
    event.stopPropagation()
    press.current = {
      pointerId: event.pointerId,
      grab,
      startX: event.clientX,
      widthPx: track.current?.getBoundingClientRect().width ?? 0,
      ...rangeRef.current,
      moved: false,
    }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current
    if (!pressed || pressed.pointerId !== event.pointerId || pressed.widthPx === 0) return
    event.stopPropagation()
    const dx = dragTravel(pressed, event.clientX)
    if (dx === null) return
    pressed.moved = true
    const delta = (dx / pressed.widthPx) * (toUnit(scale, max) - toUnit(scale, min))
    change(
      pressed.grab === 'both'
        ? shiftRange(bounds, pressed.start, pressed.end, delta)
        : placeEdge(
            bounds,
            pressed.grab,
            toUnit(scale, pressed[pressed.grab]) + delta,
            pressed.start,
            pressed.end,
          ),
    )
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === event.pointerId) press.current = null
  }
  // A drag taken away mid-way puts the range back where it started.
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current
    if (pressed?.pointerId !== event.pointerId) return
    press.current = null
    if (pressed.moved) change([pressed.start, pressed.end])
  }
  const drags = {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: cancel,
    // After a pointerup the press is already gone, so only a capture taken away mid-drag lands.
    onLostPointerCapture: cancel,
  }

  const edge = (which: Edge) => {
    const value = which === 'start' ? start : end
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={which === 'start' ? startLabel : endLabel}
        aria-orientation="horizontal"
        aria-valuemin={which === 'start' ? min : start}
        aria-valuemax={which === 'start' ? end : max}
        aria-valuenow={value}
        aria-valuetext={valueText(value)}
        data-range-grab={which}
        data-color={ISOLATE_COLOR}
        style={{ left: at(value) }}
        // A 44 px target around the edge, as the loop handles have.
        className="loop-color absolute inset-y-0 z-10 flex w-11 -translate-x-1/2 cursor-ew-resize touch-none justify-center rounded-md outline-offset-0 select-none"
        onKeyDown={onKeyDown}
        {...drags}
      >
        <LoopHandleMark edge={which} />
      </div>
    )
  }

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="t-secondary">
          {label}
        </span>
        <span className="t-secondary tabular-nums">{readout(start, end)}</span>
      </div>
      {/* Inset by the grip tabs, which sit outside the range even at either end. */}
      <div className="h-11 px-4">
        <div ref={track} data-range-track className="relative h-full">
          <Outline source={outline} />
          <div
            data-range-span
            data-range-grab="both"
            data-color={ISOLATE_COLOR}
            style={{ left: at(start), right: `calc(100% - ${at(end)})` }}
            className="loop-color absolute inset-y-0 cursor-grab touch-none bg-(--loop-tint)"
            {...drags}
          />
          {edge('start')}
          {edge('end')}
        </div>
      </div>
    </div>
  )
}

/** The loop color an isolated range draws in, orange, so it reads as a range over the outline. */
const ISOLATE_COLOR = 1

const noSubscribe = () => () => {}
const noOutline = () => null

/** The level in each bin, mirrored about the middle, behind the range. */
function Outline({ source }: { source: OutlineSource | null }) {
  const outline = useSyncExternalStore(source?.subscribe ?? noSubscribe, source?.get ?? noOutline)
  const { canvasRef, begin } = useBarCanvas()
  useEffect(() => {
    const draw = begin()
    if (!draw || !outline || outline.length === 0) return
    const { context, width, height, played } = draw
    const middle = height / 2
    const x = (index: number) => ((index + 0.5) / outline.length) * width
    context.fillStyle = played
    context.beginPath()
    context.moveTo(0, middle)
    outline.forEach((level, index) => context.lineTo(x(index), middle - (level * height) / 2))
    context.lineTo(width, middle)
    for (let index = outline.length - 1; index >= 0; index--) {
      context.lineTo(x(index), middle + (outline[index]! * height) / 2)
    }
    context.closePath()
    context.fill()
  }, [begin, outline])
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-outline={outline ? '' : undefined}
      className="ph-no-capture text-field pointer-events-none absolute inset-0 block size-full"
    />
  )
}
