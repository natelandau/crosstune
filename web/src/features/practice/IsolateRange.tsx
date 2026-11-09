import { useEffect, useId, useSyncExternalStore } from 'react'
import { clamp } from '../../math'
import { RangeHandles, type RangeGrab } from '../../ui/RangeHandles'
import type { OutlineSource } from './isolateOutlineFeed'
import { useBarCanvas } from './useBarCanvas'

type Scale = 'linear' | 'log'
type Edge = 'start' | 'end'

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

/** A range moved whole, each edge rounded to a whole value on its own. */
function roundRange(bounds: Bounds, start: number, end: number): [number, number] {
  const { min, max } = bounds
  const nextStart = clamp(Math.round(start), min, max)
  const nextEnd = clamp(Math.round(end), min, max)
  // Each edge rounds on its own, so the span can land a fraction short and steps one further out.
  if (!tooShort(bounds, nextStart, nextEnd)) return [nextStart, nextEnd]
  return nextEnd < max ? [nextStart, nextEnd + 1] : [Math.max(nextStart - 1, min), nextEnd]
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
  const low = toUnit(scale, min)
  const width = toUnit(scale, max) - low
  const fractionOf = (value: number) => (toUnit(scale, value) - low) / width
  const unitAt = (fraction: number) => low + fraction * width
  const valueAt = (fraction: number) => Math.round(fromUnit(scale, unitAt(fraction)))

  // The handles move in fractions of the track; the range holds whole values.
  const place = (grab: RangeGrab, from: number, to: number): [number, number] => {
    const [nextStart, nextEnd] =
      grab === 'span'
        ? roundRange(bounds, fromUnit(scale, unitAt(from)), fromUnit(scale, unitAt(to)))
        : placeEdge(bounds, grab, unitAt(grab === 'start' ? from : to), valueAt(from), valueAt(to))
    return [fractionOf(nextStart), fractionOf(nextEnd)]
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
        <RangeHandles
          className="h-full"
          start={fractionOf(start)}
          end={fractionOf(end)}
          minSpan={minSpan / width}
          step={step / width}
          largeStep={largeStep / width}
          moveSpan
          color={ISOLATE_COLOR}
          startLabel={startLabel}
          endLabel={endLabel}
          values={(edge) => {
            const value = edge === 'start' ? start : end
            return {
              min: edge === 'start' ? min : start,
              max: edge === 'start' ? end : max,
              now: value,
              text: valueText(value),
            }
          }}
          place={place}
          onChange={(from, to) => onChange(valueAt(from), valueAt(to))}
        >
          <Outline source={outline} />
        </RangeHandles>
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
