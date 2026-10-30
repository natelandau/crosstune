import { useLayoutEffect, useMemo, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { Draft } from '../../domain/loopModel'
import { MIN_KEPT_MS } from '../../domain/recordingLimits'
import { formatPreciseDuration } from '../../text/format'
import { useLatest } from '../../ui/useLatest'
import type { Moving } from '../player/playheadClock'
import { LoopHandle } from './LoopHandle'
import { msAtX, type ZoomedViewSource } from './practiceZoom'
import { CUT_HANDLE } from './splitCopy'
import { pieceColor } from './splitModel'
import { AUTO_PAN_ZONE_PX } from './useAutoPan'
import type { ShownPeaks } from './recordingRange'
import { DETAIL_LABEL } from './trimViewCopy'
import { capturePress, dragTravel } from './useScrub'
import { useNonPassiveWheel, type useZoomGestures } from './useZoomGestures'
import { ZoomedWaveformBars } from './ZoomedWaveformBars'
import { NUDGE_LARGE_MS, NUDGE_MS } from './panel'

/** The keys a screen reader's adjust gesture sends that the window's arrow keys do not cover. */
const ADJUST_KEYS: Record<string, [number, number]> = {
  ArrowDown: [-NUDGE_MS, -NUDGE_LARGE_MS],
  ArrowUp: [NUDGE_MS, NUDGE_LARGE_MS],
}

/**
 * The recording at one scale under a fixed center line, which is the time a new cut lands at. A
 * drag, a touch, or a trackpad's sideways scroll on the audio moves the line's time. Each piece
 * is a band in its loop color, and each cut between two bands is a loop handle that drags or
 * nudges that cut alone. A tap on a band selects that piece. The view follows `line` every
 * frame outside React while playing. The line is the slider a keyboard or screen reader moves.
 */
export function CenterLineStrip({
  shown,
  lowMs,
  highMs,
  line,
  valueMs,
  pxPerS,
  halfSpanMs,
  cuts,
  roomOf,
  selectedPiece,
  boxRef,
  pinch,
  disabled,
  onScrubStart,
  onScrub,
  onScrubEnd,
  onScrubBy,
  onNudge,
  onMoveCut,
  onTogglePiece,
  onPan,
  pinches,
}: {
  /** Peaks from `lowMs`. */
  shown: ShownPeaks | null
  lowMs: number
  highMs: number
  /** The line on the source timeline. */
  line: Moving<number>
  /** The line as announced, which changes less often than it moves. */
  valueMs: number
  pxPerS: number | null
  /** Half the stretch the strip shows. */
  halfSpanMs: number
  cuts: readonly number[]
  /** The range cut `index` may move in, on the source timeline. */
  roomOf: (index: number) => [number, number]
  selectedPiece: number | null
  boxRef: RefObject<HTMLDivElement | null>
  pinch: ReturnType<typeof useZoomGestures>
  disabled: boolean
  onScrubStart: () => void
  /** `deltaMs` from where the drag began. */
  onScrub: (deltaMs: number) => void
  onScrubEnd: () => void
  onScrubBy: (deltaMs: number) => void
  onNudge: (deltaMs: number) => void
  /** `ms` on the source timeline. */
  onMoveCut: (index: number, ms: number) => void
  onTogglePiece: (index: number) => void
  /** Moves the line by `deltaMs`, letting go of a selected cut. */
  onPan: (deltaMs: number) => void
  pinches: RefObject<number>
}) {
  const lengthMs = highMs - lowMs
  const track = useRef<HTMLDivElement>(null)
  const press = useRef<{
    pointerId: number
    startX: number
    moved: boolean
    pinch: number
  } | null>(null)
  const trackX = (ms: number) => (pxPerS ? (ms / 1000) * pxPerS : 0)
  const viewStart = useMemo<Moving<number>>(
    () => ({ get: () => line.get() - lowMs - halfSpanMs, subscribe: line.subscribe }),
    [line, lowMs, halfSpanMs],
  )

  const zoomedView = useMemo<ZoomedViewSource>(
    () => ({
      trimStartMs: lowMs,
      view: () => ({
        startMs: viewStart.get(),
        pxPerS: pxPerS ?? 1,
        widthPx: pxPerS ? ((2 * halfSpanMs) / 1000) * pxPerS : 0,
        trimStartMs: lowMs,
      }),
      subscribe: viewStart.subscribe,
    }),
    [viewStart, pxPerS, halfSpanMs, lowMs],
  )
  const edges = [lowMs, ...cuts, highMs]
  const tapAt = (x: number) => {
    const ms = msAtX(zoomedView.view(), x)
    // With no cut there is one piece, which has no band to select.
    if (cuts.length === 0 || ms < lowMs || ms > highMs) return
    onTogglePiece(cuts.filter((cut) => cut <= ms).length)
  }
  const localX = (clientX: number) => clientX - (boxRef.current?.getBoundingClientRect().left ?? 0)

  // Where a handle's drag began, so one that gives way to a pinch puts the cut back.
  const dragFrom = useRef<{ index: number; ms: number } | null>(null)
  const onDraft = (draft: Draft | null) => {
    if (draft === null) {
      const from = dragFrom.current
      dragFrom.current = null
      if (from) onMoveCut(from.index, from.ms)
      return
    }
    const index = Number(draft.id)
    dragFrom.current ??= { index, ms: cuts[index]! }
    onMoveCut(index, draft.endMs)
  }
  const onCommit = (draft: Draft) => {
    dragFrom.current = null
    onMoveCut(Number(draft.id), draft.endMs)
  }
  /** Moves the line just far enough to bring a handle the keyboard reached into view. */
  const reveal = (sourceMs: number) => {
    if (!pxPerS) return
    const reach = halfSpanMs - (AUTO_PAN_ZONE_PX / pxPerS) * 1000
    const off = sourceMs - line.get()
    if (off > reach) onPan(off - reach)
    else if (off < -reach) onPan(off + reach)
  }

  const placeRef = useLatest(() => {
    if (!track.current || !pxPerS) return
    const scale = window.devicePixelRatio || 1
    // On whole device pixels, so the cut lines stay sharp as they slide.
    const x = Math.round(-((viewStart.get() / 1000) * pxPerS) * scale) / scale
    track.current.style.transform = `translateX(${x}px)`
  })
  useLayoutEffect(() => placeRef.current())
  useLayoutEffect(() => viewStart.subscribe(() => placeRef.current()), [viewStart, placeRef])

  useNonPassiveWheel(boxRef, (event) => {
    if (event.ctrlKey || event.metaKey || disabled || !pxPerS) return
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    event.preventDefault()
    onScrubBy((event.deltaX / pxPerS) * 1000)
  })

  const release = (pointerId: number, tapX?: number) => {
    const pressed = press.current
    if (!pressed || pressed.pointerId !== pointerId) return
    press.current = null
    if (pressed.moved) onScrubEnd()
    else if (tapX !== undefined && pinches.current === pressed.pinch) tapAt(tapX)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps = ADJUST_KEYS[event.key]
    if (!steps) return
    event.preventDefault()
    onNudge(steps[event.shiftKey ? 1 : 0])
  }

  return (
    <div
      ref={boxRef}
      data-split-strip
      className={`relative cursor-grab touch-none select-none ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      {...pinch}
      onPointerDown={(event) => {
        // A second finger belongs to a pinch, not to this press.
        if (press.current || !pxPerS || !capturePress(event)) return
        press.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          moved: false,
          pinch: pinches.current,
        }
      }}
      onPointerMove={(event) => {
        const pressed = press.current
        if (!pressed || pressed.pointerId !== event.pointerId || !pxPerS) return
        const dx = dragTravel(pressed, event.clientX)
        if (dx === null) return
        if (!pressed.moved) {
          pressed.moved = true
          onScrubStart()
        }
        // Dragging the audio left moves the line later.
        onScrub((-dx / pxPerS) * 1000)
      }}
      onPointerUp={(event) => release(event.pointerId, localX(event.clientX))}
      onPointerCancel={(event) => release(event.pointerId)}
      onLostPointerCapture={(event) => release(event.pointerId)}
    >
      {pxPerS ? (
        <ZoomedWaveformBars
          shown={shown}
          startMs={viewStart}
          pxPerS={pxPerS}
          lengthMs={lengthMs}
          heightClass="h-28"
        />
      ) : (
        <div className="h-28" />
      )}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div ref={track} className="absolute inset-y-0 left-0">
          {/* One piece is the whole recording, which needs no tint. */}
          {cuts.length > 0 &&
            edges.slice(0, -1).map((startMs, index) => (
              <div
                key={index}
                data-split-piece={index}
                data-color={pieceColor(index)}
                data-selected={index === selectedPiece || undefined}
                className="loop-color absolute inset-y-0 bg-(--loop-tint)"
                style={{
                  left: trackX(startMs - lowMs),
                  width: trackX(edges[index + 1]! - startMs),
                }}
              >
                {index === selectedPiece && (
                  <>
                    <div className="absolute inset-x-0 top-0 h-1.5 bg-(--loop)" />
                    <div className="absolute inset-x-0 bottom-0 h-1.5 bg-(--loop)" />
                  </>
                )}
              </div>
            ))}
        </div>
      </div>
      <div
        aria-hidden="true"
        data-center-line
        className="bg-brand pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2"
      />
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={DETAIL_LABEL}
        aria-valuemin={0}
        aria-valuemax={lengthMs}
        aria-valuenow={Math.round(valueMs - lowMs)}
        aria-valuetext={formatPreciseDuration(valueMs - lowMs)}
        aria-disabled={disabled || undefined}
        className="absolute inset-0 rounded-md outline-offset-0"
        onKeyDown={onKeyDown}
      />
      {pxPerS
        ? cuts.map((cut, index) => {
            const [minMs, maxMs] = roomOf(index)
            return (
              // Keyed by place, so a drag that moves the cut keeps its handle and pointer.
              <LoopHandle
                key={index}
                edge="end"
                id={String(index)}
                name=""
                color={pieceColor(index)}
                span={{ startMs: edges[index]!, endMs: cut }}
                zoomedView={zoomedView}
                bounds={{ startMs: minMs, endMs: maxMs }}
                playheadMs={line.get}
                surface={boxRef}
                onDraft={onDraft}
                onCommit={onCommit}
                onPan={onPan}
                onReveal={reveal}
                onTap={tapAt}
                pinches={pinches}
                label={CUT_HANDLE(index + 1)}
                valueText={formatPreciseDuration}
                minLengthMs={MIN_KEPT_MS}
              />
            )
          })
        : null}
    </div>
  )
}
