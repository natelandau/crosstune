import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react'
import {
  DRAG_THRESHOLD_PX,
  moveSpan,
  resizeSpan,
  snapMs,
  spanFromDrag,
  type Bounds,
  type PlacedLoop,
  type Span,
} from './loopModel'
import { msAtX, xOfMs, type LaneView } from './practiceZoom'
import { useAutoPan } from './useAutoPan'

export const ROW_HEIGHT_PX = 20
export const ROW_GAP_PX = 4
export const LANE_PAD_PX = 4
/** Half of the 44 px a handle's target spans around a loop's edge. */
const HANDLE_REACH_PX = 22
/** A loop as a drag has it: `id` null for one being drawn. */
export type Draft = Span & { id: string | null }

type Gesture =
  | { kind: 'create'; anchorMs: number }
  | { kind: 'move'; id: string; span: Span; anchorMs: number }
  | { kind: 'resize'; id: string; span: Span; edge: 'start' | 'end' }

interface Pressed {
  pointerId: number
  gesture: Gesture
  startX: number
  startY: number
  startScroll: number
  /** Past the drag threshold, so it is a drag and not a tap. */
  moved: boolean
  scrolling: boolean
  lastX: number
  alt: boolean
  pinch: number
}

export interface LoopGestureOptions {
  lane: RefObject<HTMLDivElement | null>
  view: LaneView
  loops: readonly PlacedLoop[]
  rows: ReadonlyMap<string, number>
  /** The trim range on the source timeline, which no loop leaves. */
  bounds: Bounds
  /** On the source timeline. */
  playheadMs: number
  canCreate: boolean
  onDraft: (draft: Draft | null) => void
  onCommit: (draft: Draft) => void
  onSelect: (id: string) => void
  onPan: (deltaMs: number) => void
  /** Counts pinches; a press that sees it change gave way to one and writes nothing. */
  pinches: RefObject<number>
}

const round = (span: Span): Span => ({
  startMs: Math.round(span.startMs),
  endMs: Math.round(span.endMs),
})

/**
 * Pointer handling for the loop lane: a drag across empty lane draws a loop, a drag on a
 * loop's body moves it and one on its end resizes it, and a tap selects. A drag only counts
 * past the threshold, so a tap stays a tap. Edges snap to the playhead and the other loops'
 * edges unless Alt or Option is held, and a drag near either end of the lane pans the view.
 */
export function useLoopGestures(options: LoopGestureOptions) {
  const latest = useRef(options)
  useLayoutEffect(() => {
    latest.current = options
  })
  const pressed = useRef<Pressed | null>(null)
  const autoPan = useAutoPan({
    view: options.view,
    onPan: options.onPan,
    follow: () => {
      const press = pressed.current
      if (press) follow(press.lastX)
    },
  })

  const localX = (clientX: number) => {
    const rect = latest.current.lane.current?.getBoundingClientRect()
    return rect ? clientX - rect.left : 0
  }

  const hit = (x: number, y: number): Gesture => {
    const { view, loops, rows } = latest.current
    const row = Math.floor((y - LANE_PAD_PX) / (ROW_HEIGHT_PX + ROW_GAP_PX))
    const inRow = loops.filter((loop) => rows.get(loop.id) === row)
    const placed = inRow.map((loop) => ({
      loop,
      x0: xOfMs(view, loop.startMs),
      x1: xOfMs(view, loop.endMs),
    }))
    // Inside a loop, the reach of an end shrinks with the loop so a short one keeps a body.
    for (const { loop, x0, x1 } of placed) {
      const inner = Math.min(HANDLE_REACH_PX, (x1 - x0) / 4)
      const span = { startMs: loop.startMs, endMs: loop.endMs }
      if (x >= x0 && x <= x0 + inner) return { kind: 'resize', id: loop.id, span, edge: 'start' }
      if (x <= x1 && x >= x1 - inner) return { kind: 'resize', id: loop.id, span, edge: 'end' }
    }
    for (const { loop, x0, x1 } of placed) {
      if (x > x0 && x < x1) {
        const span = { startMs: loop.startMs, endMs: loop.endMs }
        return { kind: 'move', id: loop.id, span, anchorMs: msAtX(view, x) }
      }
    }
    for (const { loop, x0, x1 } of placed) {
      const span = { startMs: loop.startMs, endMs: loop.endMs }
      if (x < x0 && x0 - x <= HANDLE_REACH_PX) {
        return { kind: 'resize', id: loop.id, span, edge: 'start' }
      }
      if (x > x1 && x - x1 <= HANDLE_REACH_PX) {
        return { kind: 'resize', id: loop.id, span, edge: 'end' }
      }
    }
    return { kind: 'create', anchorMs: msAtX(view, x) }
  }

  /** The draft for the pointer at `x`, snapped unless `alt`. */
  const draftAt = (gesture: Gesture, x: number, alt: boolean): Draft => {
    const { view, loops, bounds, playheadMs } = latest.current
    const msPerPx = 1000 / view.pxPerS
    const dragged = gesture.kind === 'create' ? null : gesture.id
    const targets = [playheadMs]
    for (const loop of loops) {
      if (loop.id !== dragged) targets.push(loop.startMs, loop.endMs)
    }
    const snap = (ms: number) => (alt ? ms : snapMs(ms, targets, msPerPx))
    const pointerMs = msAtX(view, x)
    switch (gesture.kind) {
      case 'create':
        return { id: null, ...round(spanFromDrag(snap(gesture.anchorMs), snap(pointerMs), bounds)) }
      case 'resize':
        return {
          id: gesture.id,
          ...round(resizeSpan(gesture.span, gesture.edge, snap(pointerMs), bounds)),
        }
      case 'move': {
        const moved = moveSpan(gesture.span, pointerMs - gesture.anchorMs, bounds)
        const start = snap(moved.startMs)
        const shift =
          start !== moved.startMs ? start - moved.startMs : snap(moved.endMs) - moved.endMs
        return { id: gesture.id, ...round(moveSpan(moved, shift, bounds)) }
      }
    }
  }

  const follow = (x: number) => {
    const press = pressed.current
    if (!press?.moved) return
    press.lastX = x
    latest.current.onDraft(draftAt(press.gesture, x, press.alt))
    autoPan.track(x)
  }

  const end = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const press = pressed.current
    if (!press || press.pointerId !== event.pointerId) return
    pressed.current = null
    autoPan.stop()
    const { onDraft, onCommit, onSelect, canCreate, pinches } = latest.current
    if (!commit || press.scrolling || pinches.current !== press.pinch) {
      onDraft(null)
      return
    }
    if (!press.moved) {
      if (press.gesture.kind !== 'create') onSelect(press.gesture.id)
      return
    }
    const draft = draftAt(press.gesture, localX(event.clientX), press.alt)
    if (draft.id === null && !canCreate) {
      onDraft(null)
      return
    }
    onCommit(draft)
  }

  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (pressed.current) return
      const element = latest.current.lane.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top + element.scrollTop
      const gesture = hit(x, y)
      try {
        element.setPointerCapture(event.pointerId)
      } catch {
        // A synthetic or already-released pointer cannot be captured; its events still arrive.
      }
      pressed.current = {
        pointerId: event.pointerId,
        gesture,
        startX: x,
        startY: event.clientY,
        startScroll: element.scrollTop,
        moved: false,
        scrolling: false,
        lastX: x,
        alt: event.altKey,
        pinch: latest.current.pinches.current,
      }
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const press = pressed.current
      if (!press || press.pointerId !== event.pointerId) return
      const x = localX(event.clientX)
      press.alt = event.altKey
      if (press.scrolling) {
        const element = latest.current.lane.current
        if (element) element.scrollTop = press.startScroll - (event.clientY - press.startY)
        return
      }
      if (!press.moved) {
        const dx = x - press.startX
        const dy = event.clientY - press.startY
        // The lane takes every touch, so a mostly vertical drag scrolls its rows by hand.
        if (Math.abs(dy) >= DRAG_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)) {
          press.scrolling = true
          return
        }
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
        if (press.gesture.kind === 'create' && !latest.current.canCreate) return
        press.moved = true
      }
      follow(x)
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => end(event, true),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => end(event, false),
    // After a pointerup the press is already gone, so only a capture taken away mid-drag lands.
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => end(event, false),
  }
}
