import { useRef, type PointerEvent } from 'react'
import type { ShownPeaks } from '../recording-screen/recordingRange'
import { Waveform } from '../recording-screen/Waveform'
import type { LaneLoop } from './LoopLane'
import { capturePointer } from '../../platform/pointer'

/**
 * The whole trimmed recording, every loop as a band beneath it, the playhead, and a box around
 * the zoomed stretch. A tap moves the zoomed view there and a drag carries it along. Pointer
 * only: the zoom buttons and the handles are the keyboard's way to the same places.
 */
export function OverviewStrip({
  shown,
  lengthMs,
  trimStartMs,
  visible,
  loops,
  playheadMs,
  selectedId,
  onCenter,
  onPan,
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
  onCenter: (ms: number) => void
  onPan: (deltaMs: number) => void
}) {
  const strip = useRef<HTMLDivElement>(null)
  const press = useRef<{ pointerId: number; lastX: number } | null>(null)
  const share = (ms: number) => (lengthMs > 0 ? (ms / lengthMs) * 100 : 0)
  const msPerPx = () => {
    const width = strip.current?.getBoundingClientRect().width ?? 0
    return width > 0 ? lengthMs / width : 0
  }
  const localX = (event: PointerEvent<HTMLDivElement>) =>
    event.clientX - (strip.current?.getBoundingClientRect().left ?? 0)
  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === event.pointerId) press.current = null
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
        const x = localX(event)
        const ms = x * msPerPx()
        // A press inside the box carries it from where it was taken; anywhere else first
        // brings the box to the press.
        if (ms < visible.startMs || ms > visible.endMs) onCenter(ms)
        press.current = { pointerId: event.pointerId, lastX: x }
      }}
      onPointerMove={(event) => {
        const pressed = press.current
        if (!pressed || pressed.pointerId !== event.pointerId) return
        const x = localX(event)
        onPan((x - pressed.lastX) * msPerPx())
        pressed.lastX = x
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
        className="pointer-events-none absolute top-0 bottom-2 w-0.5 -translate-x-1/2 bg-(--ion-text-color)"
        style={{ left: `${share(playheadMs - trimStartMs)}%` }}
      />
      <div
        data-overview-box
        className="pointer-events-none absolute top-0 bottom-2 rounded-md border-2 border-(--ion-color-primary)"
        style={{
          left: `${share(visible.startMs)}%`,
          width: `${share(visible.endMs - visible.startMs)}%`,
        }}
      />
    </div>
  )
}
