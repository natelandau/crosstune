import { formatDuration } from '../../text/format'
import { PROGRESS } from './transportCopy'
import { clamp } from '../../math'

const KEY_STEP_MS = 5000
const ARROW_STEP: Record<string, number> = {
  ArrowLeft: -KEY_STEP_MS,
  ArrowDown: -KEY_STEP_MS,
  ArrowRight: KEY_STEP_MS,
  ArrowUp: KEY_STEP_MS,
}

/**
 * The dock's thin line of the place: played in ink, the rest a hairline, and the coral
 * playhead. A native range lies over it, unseen, so the keys, the screen reader, and a drag all
 * move the place through one control.
 */
export function Scrubber({
  title,
  positionMs,
  lengthMs,
  onSeek,
}: {
  title: string
  positionMs: number
  lengthMs: number
  onSeek: (ms: number) => void
}) {
  const length = Math.max(lengthMs, 1)
  const value = lengthMs > 0 ? Math.min(positionMs, lengthMs) : 0
  const at = `${(value / length) * 100}%`
  return (
    <div
      data-scrubber
      className="relative h-(--target-control) min-w-0 flex-1 rounded-(--radius-row) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--slate)"
    >
      <div aria-hidden className="bg-hairline absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2">
        <div className="bg-ink-2 h-full" style={{ width: at }} />
        <div
          data-playhead
          className="bg-coral absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: at }}
        />
      </div>
      <input
        type="range"
        aria-label={PROGRESS(title)}
        aria-valuetext={formatDuration(value)}
        min={0}
        max={length}
        // Any step, so the line shows the engine's exact place rather than one snapped to a step.
        step="any"
        value={value}
        disabled={lengthMs <= 0}
        onChange={(event) => onSeek(Number(event.target.value))}
        onKeyDown={(event) => {
          const by = ARROW_STEP[event.key]
          if (by === undefined) return
          event.preventDefault()
          onSeek(clamp(value + by, 0, length))
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0 outline-none disabled:cursor-default"
      />
    </div>
  )
}
