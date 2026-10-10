import { animate, cancelFrame, frame, type FrameData } from 'motion/react'
import { createContext, createElement, useCallback, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { Key } from 'react-aria-components'
import { SPRING } from '../theme/motion'

/** The name of a reorderable row's keyboard drag button. */
export const moveRowLabel = (title: string) => `Move ${title}`

/** What a list's `moveLabel` is given for each row. */
export interface ReorderItem {
  id: Key
  title: string
}

/** A drag of one row, begun by a long press on touch or a press and move with a mouse or pen. */
export interface ReorderDrag {
  /** The pointer is now at `clientY`. */
  move: (clientY: number) => void
  /** The pointer lifted, dropping the row where it is, or the gesture was cancelled. */
  end: (drop: boolean) => void
}

/** What a reorderable list gives its rows. */
export interface Reorder {
  moveLabel: (item: ReorderItem) => string
  /** A touch hold that can become a drag has begun or ended, so the page must not scroll. */
  hold: (active: boolean) => void
  /** Starts a drag of the row pressed at `pressY`, or null when it has nowhere to go. */
  begin: (key: Key, pressY: number) => ReorderDrag | null
}

export const ReorderContext = createContext<Reorder | null>(null)

/** The list's rows in their order on the page; drop indicators carry no key and are skipped. */
export function rowsOf(list: Element): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('[role="row"][data-key]')]
}

/** The index a row lands at when dropped beside the row at `target`, counted without it. */
export function dropIndex(from: number, target: number, side: 'before' | 'after'): number {
  if (side === 'before') return target > from ? target - 1 : target
  return target >= from ? target : target + 1
}

/** How close to the scroller's visible edge, in px, a dragging finger starts it scrolling. */
export const AUTOSCROLL_EDGE_PX = 48
// px/ms at the very edge; slower the farther in the finger is.
const AUTOSCROLL_SPEED = 0.8
// How far in from each edge to look for a bar laid over the scroller, in steps of this size.
const OVERLAY_PROBE_STEP_PX = 4

/** Calls `step` once a frame with the ms since the last, until the returned stop is called. */
export type FrameSource = (step: (deltaMs: number) => void) => () => void

/** Motion's frame loop, which the rest of the app's motion runs on. */
export const motionFrames: FrameSource = (step) => {
  const run = ({ delta }: FrameData) => step(delta)
  frame.update(run, true)
  return () => cancelFrame(run)
}

// The latest drop of each row, so an earlier settle that ends late leaves a later one raised.
const latestSettle = new WeakMap<HTMLElement, object>()

/** How far a row's transform draws it below its place in the layout. */
function drawnOffset(row: HTMLElement): number {
  const { transform } = getComputedStyle(row)
  return transform === 'none' ? 0 : new DOMMatrix(transform).m42
}

/** The nearest ancestor that scrolls vertically, or the page's own scroller. */
function scrollerOf(element: Element): Element {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if (/auto|scroll|overlay/.test(overflowY) && at.scrollHeight > at.clientHeight) return at
  }
  return document.scrollingElement ?? document.documentElement
}

/**
 * The band of the scroller a finger can see: its box within the viewport, less any bar laid
 * over its top or bottom edge, such as a tab bar or a pane bar. A bar is found by what is on
 * top at the band's edge, so no bar is named here. Null when bars leave too little of it for
 * both edge zones, where every place a finger rests would scroll.
 */
function visibleBand(scroller: Element): { top: number; bottom: number } | null {
  const page = scroller === document.scrollingElement || scroller === document.documentElement
  const rect = page
    ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
    : scroller.getBoundingClientRect()
  let top = Math.max(rect.top, 0)
  let bottom = Math.min(rect.bottom, window.innerHeight)
  const x = (Math.max(rect.left, 0) + Math.min(rect.right, window.innerWidth)) / 2
  // Whatever is on top there belongs to a bar when it lies outside the scroller or is pinned
  // in place within it, as the page's own fixed bars are.
  const covered = (y: number) => {
    const hit = document.elementFromPoint(x, y)
    if (!hit || hit === scroller) return false
    if (!scroller.contains(hit)) return true
    for (let at: Element | null = hit; at && at !== scroller; at = at.parentElement) {
      if (/fixed|sticky/.test(getComputedStyle(at).position)) return true
    }
    return false
  }
  const uncovered = bottom - top
  while (bottom > top && covered(bottom - 1)) bottom -= OVERLAY_PROBE_STEP_PX
  while (top < bottom && covered(top + 1)) top += OVERLAY_PROBE_STEP_PX
  const shown = bottom - top
  if (shown < uncovered && shown < 2 * AUTOSCROLL_EDGE_PX) return null
  return { top, bottom }
}

/**
 * Starts a drag in `list`: the row lifts and follows the pointer, the rows it passes slide
 * aside, and a drop calls `onReorder` with the index it lands at, then every row springs from
 * where it was drawn into its place. While the pointer rests near the
 * edge of the scroller's visible band, each of `frames` scrolls it, so rows off screen are
 * reachable. Positions come from the layout on every move and frame, never from a snapshot, so
 * rows a sync moves mid-drag are dropped among as they now stand. Offsets are layout
 * positions, which transforms and scrolling leave alone.
 */
export function beginReorderDrag(
  list: Element,
  key: Key,
  pressY: number,
  onReorder: (key: Key, toIndex: number) => void,
  {
    reduceMotion = false,
    frames = motionFrames,
  }: { reduceMotion?: boolean; frames?: FrameSource } = {},
): ReorderDrag | null {
  const own = (row: HTMLElement) => row.dataset.key === String(key)
  const first = rowsOf(list)
  const dragged = first.find(own)
  if (!dragged || 'disabled' in dragged.dataset || first.length < 2) return null
  // A settle this drag interrupts never finishes, so a row it left raised is lowered here.
  for (const row of first) if (!('lifted' in row.dataset)) delete row.dataset.reordering
  const scroller = scrollerOf(list)
  const startScroll = scroller.scrollTop
  // Measured once: the bars and the scroller hold still while a finger drags.
  const band = visibleBand(scroller)
  // Where the row's center would sit if it followed the finger from its place at the press.
  const startCenter = dragged.offsetTop + dragged.offsetHeight / 2
  const shifted = new Map<HTMLElement, number>()
  let landing: { from: number; to: number } | null = null
  let fingerY = pressY
  dragged.dataset.reordering = ''
  dragged.dataset.lifted = ''

  const shift = (row: HTMLElement, y: number, follow: boolean) => {
    if (shifted.get(row) === y) return
    shifted.set(row, y)
    animate(row, { y }, follow || reduceMotion ? { duration: 0 } : SPRING)
  }

  const place = () => {
    const rows = rowsOf(list)
    const self = rows.find(own)
    if (!self) return
    const others = rows.filter((row) => row !== self)
    const center = startCenter + fingerY - pressY + scroller.scrollTop - startScroll
    const from = rows.indexOf(self)
    const to = others.filter((row) => row.offsetTop + row.offsetHeight / 2 < center).length
    landing = { from, to }
    const order = [...others]
    order.splice(to, 0, self)
    const listTop = Math.min(...rows.map((row) => row.offsetTop))
    const listBottom = Math.max(...rows.map((row) => row.offsetTop + row.offsetHeight))
    const half = self.offsetHeight / 2
    // Only the row's picture is held inside the list: drawn past its end it would grow what
    // the scroller can scroll, and the edge would keep scrolling after it.
    const shown = Math.min(listBottom - half, Math.max(listTop + half, center))
    let top = listTop
    for (const row of order) {
      if (row === self) shift(row, shown - half - row.offsetTop, true)
      else shift(row, top - row.offsetTop, false)
      top += row.offsetHeight
    }
  }

  // A wheel or trackpad scroll moves the rows under a pointer that holds still.
  const scrollEvents: EventTarget =
    scroller === document.scrollingElement || scroller === document.documentElement
      ? window
      : scroller
  scrollEvents.addEventListener('scroll', place, { passive: true })
  // By the time since the last frame, so the speed holds however fast frames come.
  const stopFrames = frames((deltaMs) => {
    if (!band) return
    const depth =
      fingerY < band.top + AUTOSCROLL_EDGE_PX
        ? fingerY - (band.top + AUTOSCROLL_EDGE_PX)
        : fingerY > band.bottom - AUTOSCROLL_EDGE_PX
          ? fingerY - (band.bottom - AUTOSCROLL_EDGE_PX)
          : 0
    if (depth === 0) return
    const before = scroller.scrollTop
    const reach = Math.max(-1, Math.min(1, depth / AUTOSCROLL_EDGE_PX))
    // At least a pixel a frame, so a finger barely inside the edge still moves the page.
    scroller.scrollTop =
      before + (Math.round(reach * AUTOSCROLL_SPEED * deltaMs) || Math.sign(reach))
    if (scroller.scrollTop !== before) place()
  })
  const stop = () => {
    stopFrames()
    scrollEvents.removeEventListener('scroll', place)
  }

  return {
    move: (clientY) => {
      fingerY = clientY
      place()
    },
    end: (drop) => {
      stop()
      // In layout terms, with each row's offset read from where it is drawn, not where it is
      // headed, since rows still sliding aside are partway there.
      const drawnAt = new Map(
        rowsOf(list).map((row) => [row, row.offsetTop + drawnOffset(row)] as const),
      )
      // The new order is on the page before the offsets clear, so no frame shows the old one.
      if (drop && landing && landing.from !== landing.to) {
        const { to } = landing
        flushSync(() => onReorder(key, to))
      }
      delete dragged.dataset.lifted
      // Each row starts from where it was drawn and springs to its place in the new order, so
      // the dropped row glides into its slot rather than jumping there.
      const settles: Promise<unknown>[] = []
      for (const row of rowsOf(list)) {
        const was = drawnAt.get(row)
        if (was === undefined) continue
        const offset = was - row.offsetTop
        if (reduceMotion || Math.abs(offset) < 0.5) animate(row, { y: 0 }, { duration: 0 })
        else settles.push(animate(row, { y: [offset, 0] }, SPRING).finished)
      }
      shifted.clear()
      const settle = {}
      latestSettle.set(dragged, settle)
      // Raised until it lands, so the rows it passes on the way slide under it.
      void Promise.all(settles).then(() => {
        if (latestSettle.get(dragged) === settle && !('lifted' in dragged.dataset)) {
          delete dragged.dataset.reordering
        }
      })
    },
  }
}

/**
 * A polite live region the screen places once, and `announce` to say where a moved row landed.
 * React Aria says only "Drop complete." after a drop.
 */
export function useReorderAnnouncer(): { announce: (text: string) => void; region: ReactNode } {
  const [said, setSaid] = useState({ text: '', count: 0 })
  const announce = useCallback(
    (text: string) => setSaid((current) => ({ text, count: current.count + 1 })),
    [],
  )
  // A live region speaks only a change, so every other announcement ends in a no-break space
  // and a repeat of the same words still changes it. Atomic, so the whole text is read.
  const region = createElement(
    'p',
    { role: 'status', 'aria-live': 'polite', 'aria-atomic': true, className: 'sr-only' },
    said.count % 2 === 0 ? said.text : `${said.text}\u00a0`,
  )
  return { announce, region }
}
