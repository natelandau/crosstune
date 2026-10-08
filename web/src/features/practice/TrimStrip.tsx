import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ActionDispatch,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { formatPreciseDuration } from '../../text/format'
import { slicePeaks } from '../waveform/peaks'
import type { ShownPeaks } from './recordingRange'
import type { TrimAction, TrimHandle, TrimState } from './trimModel'
import { Waveform } from './Waveform'
import { clamp } from '../../math'
import { capturePointer } from '../../platform/pointer'

export const START_HANDLE = 'Start'
export const END_HANDLE = 'End'

const NUDGE_MS = 100
const NUDGE_LARGE_MS = 1000

const HANDLES = ['start', 'end'] as const
const HANDLE_LABELS: Record<TrimHandle, string> = { start: START_HANDLE, end: END_HANDLE }

/** How far each key moves a handle, as [plain, with Shift]. */
const KEY_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-NUDGE_MS, -NUDGE_LARGE_MS],
  ArrowDown: [-NUDGE_MS, -NUDGE_LARGE_MS],
  ArrowRight: [NUDGE_MS, NUDGE_LARGE_MS],
  ArrowUp: [NUDGE_MS, NUDGE_LARGE_MS],
  PageDown: [-NUDGE_LARGE_MS, -NUDGE_LARGE_MS],
  PageUp: [NUDGE_LARGE_MS, NUDGE_LARGE_MS],
}

/**
 * Bars for `range` of the source with the selection lit and a handle at each end of it. The
 * overview's handles are the sliders a keyboard or screen reader moves; the detail's repeat
 * them for the pointer alone, so each handle is announced once.
 */
export function TrimStrip({
  range,
  trim,
  dispatch,
  shown,
  playheadMs,
  loaded,
  label,
  compact = false,
  announced = false,
  onSeek,
  onDragChange,
}: {
  range: [number, number]
  trim: TrimState
  dispatch: ActionDispatch<[TrimAction]>
  /** Peaks from the start of `trim.bounds`. */
  shown: ShownPeaks | null
  playheadMs: number
  loaded: boolean
  label: string
  compact?: boolean
  /** Whether these handles and bars are what assistive technology and the keyboard reach. */
  announced?: boolean
  /** `ms` on the source timeline. */
  onSeek: (ms: number) => void
  onDragChange?: (dragging: boolean) => void
}) {
  const [from, to] = range
  const span = to - from
  const [low, high] = trim.bounds
  const box = useRef<HTMLDivElement>(null)
  // The ref answers the pointer handlers at once, since a move can follow its pointerdown
  // before a render; the state keeps the dragged handle drawn.
  const dragging = useRef<TrimHandle | null>(null)
  const [dragged, setDragged] = useState<TrimHandle | null>(null)
  const peaks = useMemo(
    () => (shown ? slicePeaks(shown.peaks, from - low, to - low) : null),
    [shown, from, to, low],
  )
  const fraction = (ms: number) => (span > 0 ? (ms - from) / span : 0)

  const endDrag = () => {
    dragging.current = null
    setDragged(null)
    onDragChange?.(false)
  }
  const onWindowUp = useEffectEvent(endDrag)
  // A handle's own pointerup can miss, as when its pointer capture is lost, so the window's
  // is what reliably ends a drag.
  useEffect(() => {
    if (!dragged) return
    const onUp = () => onWindowUp()
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragged])

  // Kept inside the strip, so a handle dragged past an edge waits there rather than leaving
  // what is drawn.
  const dragTo = (handle: TrimHandle, event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const at = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    dispatch({ type: 'drag', handle, ms: from + at * span })
  }

  const onKeyDown = (handle: TrimHandle, event: KeyboardEvent<HTMLDivElement>) => {
    const steps = KEY_STEPS[event.key]
    if (!steps) return
    event.preventDefault()
    dispatch({ type: 'nudge', handle, deltaMs: steps[event.shiftKey ? 1 : 0] })
  }

  const startAt = clamp(fraction(trim.start), 0, 1) * 100
  const endAt = clamp(fraction(trim.end), 0, 1) * 100
  return (
    <div ref={box} className="relative">
      <Waveform
        peaks={peaks}
        loudest={shown?.loudest}
        lengthMs={span}
        positionMs={playheadMs - from}
        disabled={!loaded}
        label={label}
        compact={compact}
        decorative={!announced}
        onSeek={(ms) => onSeek(from + ms)}
      />
      {/* The part the trim cuts away is faded back behind the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-(--panel-ground) opacity-70"
        style={{ width: `${startAt}%` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-(--panel-ground) opacity-70"
        style={{ left: `${endAt}%` }}
      />
      {HANDLES.map((handle) => {
        const ms = trim[handle]
        const raw = fraction(ms)
        // A handle being dragged stays on the strip, pinned to its edge, so its pointer does.
        if (dragged !== handle && (raw < 0 || raw > 1)) return null
        const at = clamp(raw, 0, 1)
        return (
          <div
            key={handle}
            data-handle={handle}
            role={announced ? 'slider' : undefined}
            tabIndex={announced ? 0 : undefined}
            aria-hidden={announced ? undefined : true}
            aria-label={announced ? HANDLE_LABELS[handle] : undefined}
            aria-valuemin={announced ? 0 : undefined}
            aria-valuemax={announced ? high - low : undefined}
            aria-valuenow={announced ? ms - low : undefined}
            aria-valuetext={announced ? formatPreciseDuration(ms - low) : undefined}
            // A 44px target around a thin line; touch-none keeps a drag from scrolling.
            className="absolute inset-y-0 flex w-11 -translate-x-1/2 cursor-ew-resize touch-none justify-center rounded-md outline-offset-0 select-none"
            style={{ left: `${at * 100}%` }}
            onFocus={() => dispatch({ type: 'focus', handle })}
            onPointerDown={(event) => {
              capturePointer(event.currentTarget, event.pointerId)
              dragging.current = handle
              setDragged(handle)
              dispatch({ type: 'focus', handle })
              onDragChange?.(true)
            }}
            onPointerMove={(event) => {
              if (dragging.current === handle) dragTo(handle, event)
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={() => {
              if (dragging.current === handle) endDrag()
            }}
            onKeyDown={announced ? (event) => onKeyDown(handle, event) : undefined}
          >
            <span className="h-full w-0.5 bg-(--trim-handle)" />
            <span
              className={`absolute size-3 rounded-full bg-(--trim-handle) ${handle === 'start' ? '-top-1.5' : '-bottom-1.5'}`}
            />
          </div>
        )
      })}
    </div>
  )
}
