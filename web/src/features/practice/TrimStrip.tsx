import { useMemo, type ActionDispatch } from 'react'
import { formatPreciseDuration } from '../../text/format'
import { RangeHandles } from '../../ui/RangeHandles'
import { MIN_KEPT_MS } from '../../domain/recordingLimits'
import { slicePeaks } from '../waveform/peaks'
import type { Moving } from '../player/playheadClock'
import type { ShownPeaks } from './recordingRange'
import type { TrimAction, TrimState } from './trimModel'
import { Waveform } from './Waveform'
import { pieceColor } from './splitModel'
import { NUDGE_LARGE_MS, NUDGE_MS } from './panel'

export const START_HANDLE = 'Start'
export const END_HANDLE = 'End'

/** The kept range takes the color split gives its first piece. */
const TRIM_COLOR = pieceColor(0)

/**
 * Bars for `range` of the source with the kept range tinted and a handle at each end of it. The
 * overview's handles are the sliders a keyboard or screen reader moves; the detail's repeat
 * them for the pointer alone, so each handle is announced once.
 */
export function TrimStrip({
  range,
  trim,
  dispatch,
  shown,
  playhead,
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
  /** The playhead on the source timeline. */
  playhead: Moving<number>
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
  const peaks = useMemo(
    () => (shown ? slicePeaks(shown.peaks, from - low, to - low) : null),
    [shown, from, to, low],
  )
  const fraction = (ms: number) => (span > 0 ? (ms - from) / span : 0)
  const position = useMemo<Moving<number>>(
    () => ({ get: () => playhead.get() - from, subscribe: playhead.subscribe }),
    [playhead, from],
  )

  const toMs = (at: number) => from + at * span
  return (
    // Inset by a tab's width, so a handle at either end of the recording shows its whole tab.
    <div className="px-4">
      <RangeHandles
        start={fraction(trim.start)}
        end={fraction(trim.end)}
        minSpan={span > 0 ? MIN_KEPT_MS / span : 0}
        color={TRIM_COLOR}
        startLabel={START_HANDLE}
        endLabel={END_HANDLE}
        step={span > 0 ? NUDGE_MS / span : 0}
        largeStep={span > 0 ? NUDGE_LARGE_MS / span : 0}
        dragMode="pointer"
        pageKeys
        decorative={!announced}
        values={(handle) => ({
          min: 0,
          max: high - low,
          now: trim[handle] - low,
          text: formatPreciseDuration(trim[handle] - low),
        })}
        onChange={(start, end, grab) => {
          if (grab === 'span') return
          dispatch({ type: 'drag', handle: grab, ms: toMs(grab === 'start' ? start : end) })
        }}
        onFocusEdge={(handle) => dispatch({ type: 'focus', handle })}
        onPressChange={(grab) => {
          if (grab !== null && grab !== 'span') dispatch({ type: 'focus', handle: grab })
          onDragChange?.(grab !== null)
        }}
      >
        <Waveform
          peaks={peaks}
          loudest={shown?.loudest}
          lengthMs={span}
          positionMs={position}
          disabled={!loaded}
          label={label}
          compact={compact}
          decorative={!announced}
          onSeek={(ms) => onSeek(from + ms)}
        />
      </RangeHandles>
    </div>
  )
}
