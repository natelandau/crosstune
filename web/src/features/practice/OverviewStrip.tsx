import { useLayoutEffect, useMemo, useRef, type PointerEvent } from 'react'
import type { ShownPeaks } from './recordingRange'
import { Waveform } from './Waveform'
import type { WaveformLoop } from './PracticeWaveform'
import { capturePointer } from '../../platform/pointer'
import { clamp } from '../../math'
import type { Moving } from '../player/playheadClock'

/**
 * The whole trimmed recording, every loop as a band beneath it, the playhead, and a box around
 * the stretch the waveform shows. A tap moves the playhead there and a drag carries it along.
 * Pointer only: the waveform's own slider is the keyboard's way to the same places. The
 * playhead and the box follow `playhead` outside React.
 */
export function OverviewStrip({
  shown,
  lengthMs,
  trimStartMs,
  halfSpanMs,
  loops,
  playhead,
  selectedId,
  onSeek,
}: {
  shown: ShownPeaks | null
  lengthMs: number
  trimStartMs: number
  /** Half the stretch the zoomed waveform shows, which is centered on the playhead. */
  halfSpanMs: number
  loops: readonly WaveformLoop[]
  /** Where the playhead is drawn, on the trimmed timeline. */
  playhead: Moving<number>
  selectedId: string | null
  /** `ms` on the trimmed timeline. */
  onSeek: (ms: number) => void
}) {
  const strip = useRef<HTMLDivElement>(null)
  const press = useRef<number | null>(null)
  const line = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const share = (ms: number) => (lengthMs > 0 ? (ms / lengthMs) * 100 : 0)
  // Held to the take: a scrub pulled past an end is drawn there by the zoomed waveform alone.
  const position = useMemo<Moving<number>>(
    () => ({ get: () => clamp(playhead.get(), 0, lengthMs), subscribe: playhead.subscribe }),
    [playhead, lengthMs],
  )
  useLayoutEffect(() => {
    const percent = (ms: number) => `${lengthMs > 0 ? (ms / lengthMs) * 100 : 0}%`
    const place = () => {
      const ms = position.get()
      if (line.current) line.current.style.left = percent(ms)
      if (box.current) {
        box.current.style.left = percent(ms - halfSpanMs)
        box.current.style.width = percent(2 * halfSpanMs)
      }
    }
    place()
    return position.subscribe(place)
  }, [position, halfSpanMs, lengthMs])
  const msPerPx = () => {
    const width = strip.current?.getBoundingClientRect().width ?? 0
    return width > 0 ? lengthMs / width : 0
  }
  const seekTo = (event: PointerEvent<HTMLDivElement>) => {
    const x = event.clientX - (strip.current?.getBoundingClientRect().left ?? 0)
    onSeek(clamp(x * msPerPx(), 0, lengthMs))
  }
  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (press.current === event.pointerId) press.current = null
  }

  return (
    <div
      ref={strip}
      aria-hidden="true"
      data-overview
      className="relative cursor-pointer touch-none pb-2 select-none"
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        capturePointer(event.currentTarget, event.pointerId)
        press.current = event.pointerId
        seekTo(event)
      }}
      onPointerMove={(event) => {
        if (press.current === event.pointerId) seekTo(event)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <Waveform
        peaks={shown?.peaks ?? null}
        loudest={shown?.loudest}
        lengthMs={lengthMs}
        positionMs={position}
        heightClass="h-5"
        decorative
        onSeek={() => {}}
      />
      {loops.map((loop) => (
        <div
          key={loop.id}
          data-color={loop.color}
          className={`loop-color pointer-events-none absolute bottom-0 h-1.5 rounded-full bg-(--loop) ${loop.id === selectedId ? '' : 'opacity-60'}`}
          style={{
            left: `${share(loop.startMs - trimStartMs)}%`,
            width: `${share(loop.endMs - loop.startMs)}%`,
          }}
        />
      ))}
      <div
        ref={line}
        className="pointer-events-none absolute top-0 bottom-2 w-0.5 -translate-x-1/2 bg-(--playhead)"
      />
      <div
        ref={box}
        data-overview-box
        className="pointer-events-none absolute top-0 bottom-2 rounded-md border-2 border-(--panel-ink)"
      />
    </div>
  )
}
