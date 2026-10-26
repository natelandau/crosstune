import { useLayoutEffect, useRef } from 'react'
import { formatDuration } from '../../text/format'
import { PROGRESS } from './transportCopy'
import { clamp } from '../../math'
import { usePlayhead, type Moving } from './playheadClock'

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
 * move the place through one control. The line and the range follow `playhead` every frame
 * without a render; only the spoken time renders, as its text changes.
 */
export function Scrubber({
  title,
  playhead,
  lengthMs,
  onSeek,
}: {
  title: string
  playhead: Moving<number>
  lengthMs: number
  onSeek: (ms: number) => void
}) {
  const length = Math.max(lengthMs, 1)
  const valueOf = (ms: number) => (lengthMs > 0 ? clamp(ms, 0, lengthMs) : 0)
  const valueText = usePlayhead(playhead, (ms) => formatDuration(valueOf(ms)))
  const played = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const draw = () => {
      const value = lengthMs > 0 ? clamp(playhead.get(), 0, lengthMs) : 0
      const at = `${(value / Math.max(lengthMs, 1)) * 100}%`
      if (played.current) played.current.style.width = at
      if (head.current) head.current.style.left = at
      if (input.current) input.current.value = String(value)
    }
    draw()
    return playhead.subscribe(draw)
  }, [playhead, lengthMs])
  return (
    <div
      data-scrubber
      className="relative h-(--target-control) min-w-0 flex-1 rounded-(--radius-row) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--accent)"
    >
      <div aria-hidden className="bg-hairline absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2">
        <div ref={played} className="bg-ink-2 h-full" />
        <div
          ref={head}
          data-playhead
          className="bg-coral absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        />
      </div>
      <input
        ref={input}
        type="range"
        aria-label={PROGRESS(title)}
        aria-valuetext={valueText}
        min={0}
        max={length}
        // Any step, so the line shows the engine's exact place rather than one snapped to a step.
        step="any"
        defaultValue={0}
        disabled={lengthMs <= 0}
        onChange={(event) => onSeek(Number(event.target.value))}
        onKeyDown={(event) => {
          const by = ARROW_STEP[event.key]
          if (by === undefined) return
          event.preventDefault()
          onSeek(clamp(valueOf(playhead.get()) + by, 0, length))
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0 outline-none disabled:cursor-default"
      />
    </div>
  )
}
