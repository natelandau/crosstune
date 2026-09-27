import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatDuration } from '../recording/format'
import { BAR_GAP, BAR_WIDTH } from '../recording/waveformBars'
import { barLevels, type Peaks } from '../waveform/peaks'

export const SEEK_LABEL = 'Position'

const KEY_STEP_MS = 5000
const MIN_BAR = 2
const STEP = BAR_WIDTH + BAR_GAP
/** How much of the full color the part not yet played keeps. */
const UNPLAYED_ALPHA = 0.35

interface Surface {
  width: number
  height: number
  theme: number
  color: string
}

/** Re-reads the bar color whenever the theme class or attribute on the root changes. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
    return () => observer.disconnect()
  }, [])
  return version
}

/**
 * The whole trimmed recording as bars, which is also the scrubber: a tap or a drag seeks, and
 * the part already played is drawn in full color. Without peaks it is one plain bar.
 */
export function Waveform({
  peaks,
  loudest,
  lengthMs,
  positionMs,
  disabled = false,
  label = SEEK_LABEL,
  compact = false,
  decorative = false,
  onSeek,
}: {
  peaks: Peaks | null
  /** The value the bars scale to; the largest in `peaks` when left out. */
  loudest?: number
  lengthMs: number
  positionMs: number
  /** No audio to seek yet. */
  disabled?: boolean
  label?: string
  /** A shorter strip, for an overview beside a larger waveform. */
  compact?: boolean
  /** Pointer-only, for a waveform whose position another slider already gives the keyboard. */
  decorative?: boolean
  /** `ms` from the start of what the bars show. */
  onSeek: (ms: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const surface = useRef<Surface | null>(null)
  const dragging = useRef(false)
  const theme = useThemeVersion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // An observer reports the size it starts with, so this also takes the first measurement.
    const observer = new ResizeObserver(() =>
      setSize({ width: canvas.clientWidth, height: canvas.clientHeight }),
    )
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const count = Math.max(0, Math.floor((size.width + BAR_GAP) / STEP))
  const levels = useMemo(
    () => (peaks ? barLevels(peaks.values, count, loudest) : []),
    [peaks, count, loudest],
  )
  // Bars flip color one at a time, so a redraw is due only when another bar has been passed.
  const playedX = lengthMs > 0 ? (Math.min(positionMs, lengthMs) / lengthMs) * size.width : 0
  const played = peaks
    ? Math.floor((playedX + BAR_GAP + BAR_WIDTH / 2) / STEP)
    : Math.round(playedX)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || size.width === 0) return
    const { width, height } = size
    // Sizing the backing store and reading the color are the costly steps, so they run again
    // only on a resize or a theme change, never on a position tick.
    let current = surface.current
    if (
      !current ||
      current.width !== width ||
      current.height !== height ||
      current.theme !== theme
    ) {
      const scale = window.devicePixelRatio || 1
      canvas.width = width * scale
      canvas.height = height * scale
      context.setTransform(scale, 0, 0, scale, 0, 0)
      current = { width, height, theme, color: getComputedStyle(canvas).color }
      surface.current = current
    }
    context.clearRect(0, 0, width, height)
    context.fillStyle = current.color
    if (!peaks) {
      const y = (height - MIN_BAR * 2) / 2
      context.globalAlpha = UNPLAYED_ALPHA
      context.fillRect(0, y, width, MIN_BAR * 2)
      context.globalAlpha = 1
      context.fillRect(0, y, played, MIN_BAR * 2)
      return
    }
    levels.forEach((level, i) => {
      const bar = Math.max(MIN_BAR, level * height)
      context.globalAlpha = i < played ? 1 : UNPLAYED_ALPHA
      context.fillRect(i * STEP, (height - bar) / 2, BAR_WIDTH, bar)
    })
    context.globalAlpha = 1
  }, [size, theme, peaks, levels, played])

  const clampMs = (ms: number) => Math.min(lengthMs, Math.max(0, ms))

  const seekTo = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    onSeek(clampMs(((event.clientX - box.left) / box.width) * lengthMs))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const target =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? positionMs - KEY_STEP_MS
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? positionMs + KEY_STEP_MS
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? lengthMs
              : null
    if (target === null) return
    event.preventDefault()
    onSeek(clampMs(target))
  }

  return (
    <div
      role="slider"
      tabIndex={decorative ? -1 : 0}
      aria-hidden={decorative || undefined}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={lengthMs}
      aria-valuenow={positionMs}
      aria-valuetext={formatDuration(positionMs)}
      // touch-none keeps a horizontal drag from scrolling the screen instead of seeking.
      className={`rounded-lg outline-offset-2 select-none ${disabled ? 'opacity-50' : 'cursor-pointer touch-none'}`}
      onPointerDown={(event) => {
        if (disabled) return
        dragging.current = true
        event.currentTarget.setPointerCapture?.(event.pointerId)
        seekTo(event)
      }}
      onPointerMove={(event) => {
        if (dragging.current && !disabled) seekTo(event)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
      onKeyDown={onKeyDown}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`block w-full text-(--ion-color-primary) ${compact ? 'h-12' : 'h-24'}`}
      />
    </div>
  )
}
