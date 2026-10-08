import { useRef, type PointerEvent } from 'react'
import type { ShownPeaks } from './recordingRange'
import { Waveform } from './Waveform'
import type { LaneLoop } from './PracticeWaveform'
import { capturePointer } from '../../platform/pointer'
import { clamp } from '../../math'

/**
 * The whole trimmed recording, every loop as a band beneath it, the playhead, and a box around
 * the stretch the waveform shows. A tap moves the playhead there and a drag carries it along.
 * Pointer only: the waveform's own slider is the keyboard's way to the same places.
 */
export function OverviewStrip({
  shown,
  lengthMs,
  trimStartMs,
  visible,
  loops,
  playheadMs,
  selectedId,
  onSeek,
}: {
  shown: ShownPeaks | null
  lengthMs: number
  trimStartMs: number
  /** The zoomed stretch, on the trimmed timeline. */
  visible: { startMs: number; endMs: number }
  loops: readonly LaneLoop[]
  /** On the source timeline. */
  playheadMs: number
  selectedId: string | null
  /** `ms` on the trimmed timeline. */
  onSeek: (ms: number) => void
}) {
  const strip = useRef<HTMLDivElement>(null)
  const press = useRef<number | null>(null)
  const share = (ms: number) => (lengthMs > 0 ? (ms / lengthMs) * 100 : 0)
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
        positionMs={playheadMs - trimStartMs}
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
        className="pointer-events-none absolute top-0 bottom-2 w-0.5 -translate-x-1/2 bg-(--playhead)"
        style={{ left: `${share(playheadMs - trimStartMs)}%` }}
      />
      <div
        data-overview-box
        className="pointer-events-none absolute top-0 bottom-2 rounded-md border-2 border-(--panel-ink)"
        style={{
          left: `${share(visible.startMs)}%`,
          width: `${share(visible.endMs - visible.startMs)}%`,
        }}
      />
    </div>
  )
}
