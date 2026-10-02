import { useMemo, useRef, type PointerEvent, type RefObject } from 'react'
import { formatDuration, formatPreciseDuration } from '../recording/format'
import type { ShownPeaks } from '../recording-screen/recordingRange'
import { Waveform } from '../recording-screen/Waveform'
import { slicePeaks } from '../waveform/peaks'
import { LoopHandle } from './LoopHandle'
import { DRAG_THRESHOLD_PX, type Bounds, type Span } from './loopModel'
import { xOfMs, type LaneView } from './practiceZoom'
import type { Draft } from './useLoopGestures'
import { capturePointer } from '../../platform/pointer'

/** Tick spacings the ruler picks from, in ms. */
const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000]
/** The least room a ruler label gets. */
const MIN_TICK_PX = 56

export interface SelectedLoop {
  id: string
  name: string
  color: number
  span: Span
}

/**
 * The zoomed stretch of the recording, with a time ruler and the selected loop tinted through
 * it. A tap seeks, a drag pans, and the selected loop's edges are handles. Bars are drawn only
 * for the stretch in view.
 */
export function DetailWaveform({
  shown,
  view,
  bounds,
  playheadMs,
  selected,
  snapTargets,
  onSeek,
  onPan,
  onDraft,
  onCommit,
  onReveal,
  pinches,
}: {
  shown: ShownPeaks | null
  view: LaneView
  /** The trim range on the source timeline. */
  bounds: Bounds
  /** On the source timeline. */
  playheadMs: number
  selected: SelectedLoop | null
  snapTargets: readonly number[]
  /** `ms` on the trimmed timeline. */
  onSeek: (ms: number) => void
  onPan: (deltaMs: number) => void
  onDraft: (draft: Draft | null) => void
  onCommit: (draft: Draft) => void
  onReveal: (sourceMs: number) => void
  /** Counts pinches; the finger that started one neither seeks nor pans. */
  pinches: RefObject<number>
}) {
  const surface = useRef<HTMLDivElement>(null)
  const press = useRef<{
    pointerId: number
    startX: number
    lastX: number
    moved: boolean
    pinch: number
  } | null>(null)
  const spanMs = (view.widthPx / view.pxPerS) * 1000
  const endMs = view.startMs + spanMs
  // A view wider than the whole recording runs past either end of it; the bars cover only
  // the recording's own stretch, so they line up with the ruler above them.
  const drawStartMs = Math.max(0, view.startMs)
  const drawEndMs = Math.max(drawStartMs, Math.min(endMs, bounds.endMs - bounds.startMs))
  const peaks = useMemo(
    () => (shown ? slicePeaks(shown.peaks, drawStartMs, drawEndMs) : null),
    [shown, drawStartMs, drawEndMs],
  )

  const step = TICK_STEPS.find((ms) => (ms / 1000) * view.pxPerS >= MIN_TICK_PX) ?? 300_000
  const ticks: number[] = []
  for (let t = Math.ceil(view.startMs / step) * step; t <= endMs; t += step) ticks.push(t)

  const localX = (event: PointerEvent<HTMLDivElement>) =>
    event.clientX - (surface.current?.getBoundingClientRect().left ?? 0)

  const release = (event: PointerEvent<HTMLDivElement>, seek: boolean) => {
    const pressed = press.current
    if (!pressed || pressed.pointerId !== event.pointerId) return
    press.current = null
    if (seek && !pressed.moved && pinches.current === pressed.pinch) {
      const ms = view.startMs + (localX(event) / view.pxPerS) * 1000
      onSeek(Math.min(bounds.endMs - bounds.startMs, Math.max(0, ms)))
    }
  }

  const playheadX = xOfMs(view, playheadMs)
  const tint = selected
    ? { x0: xOfMs(view, selected.span.startMs), x1: xOfMs(view, selected.span.endMs) }
    : null

  return (
    <div className="flex flex-col gap-1">
      <div aria-hidden="true" className="type-caption relative h-4 overflow-hidden tabular-nums">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute top-0 border-l border-(--ion-color-medium) pl-1 leading-4 text-(--ion-color-medium)"
            style={{ left: ((t - view.startMs) / 1000) * view.pxPerS }}
          >
            {step < 1000 ? formatPreciseDuration(t) : formatDuration(t)}
          </span>
        ))}
      </div>
      <div ref={surface} className="relative">
        <div
          style={{
            marginLeft: ((drawStartMs - view.startMs) / 1000) * view.pxPerS,
            width: ((drawEndMs - drawStartMs) / 1000) * view.pxPerS,
          }}
        >
          <Waveform
            peaks={peaks}
            loudest={shown?.loudest}
            lengthMs={drawEndMs - drawStartMs}
            positionMs={playheadMs - view.trimStartMs - drawStartMs}
            heightClass="practice-detail"
            decorative
            onSeek={() => {}}
          />
        </div>
        {tint && tint.x1 > 0 && tint.x0 < view.widthPx ? (
          <div
            aria-hidden="true"
            data-color={selected!.color}
            className="loop-color pointer-events-none absolute inset-y-0 bg-(--loop-tint)"
            style={{
              left: Math.max(0, tint.x0),
              right: view.widthPx - Math.min(view.widthPx, tint.x1),
            }}
          />
        ) : null}
        <div
          aria-hidden="true"
          data-detail-surface
          // pan-y leaves a vertical swipe to scroll the screen; a sideways one pans the view.
          className="absolute inset-0 cursor-pointer touch-pan-y select-none"
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return
            capturePointer(event.currentTarget, event.pointerId)
            const x = localX(event)
            press.current = {
              pointerId: event.pointerId,
              startX: x,
              lastX: x,
              moved: false,
              pinch: pinches.current,
            }
          }}
          onPointerMove={(event) => {
            const pressed = press.current
            if (!pressed || pressed.pointerId !== event.pointerId) return
            const x = localX(event)
            if (!pressed.moved && Math.abs(x - pressed.startX) < DRAG_THRESHOLD_PX) return
            pressed.moved = true
            onPan((-(x - pressed.lastX) / view.pxPerS) * 1000)
            pressed.lastX = x
          }}
          onPointerUp={(event) => release(event, true)}
          onPointerCancel={(event) => release(event, false)}
          onLostPointerCapture={(event) => release(event, false)}
        />
        {playheadX >= 0 && playheadX <= view.widthPx ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-(--ion-text-color)"
            style={{ left: playheadX }}
          />
        ) : null}
        {selected
          ? (['start', 'end'] as const).map((edge) => (
              <LoopHandle
                key={`${selected.id}-${edge}`}
                edge={edge}
                id={selected.id}
                name={selected.name}
                color={selected.color}
                span={selected.span}
                view={view}
                bounds={bounds}
                snapTargets={snapTargets}
                surface={surface}
                onDraft={onDraft}
                onCommit={onCommit}
                onPan={onPan}
                onReveal={onReveal}
                pinches={pinches}
              />
            ))
          : null}
      </div>
    </div>
  )
}
