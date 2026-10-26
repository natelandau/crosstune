import { useLayoutEffect } from 'react'
import { DURATION, EASE, springEasing } from '../theme/motion'
import { drawnOffset, rowsOf } from './reorder'
import { useLatest } from './useLatest'

interface Placed {
  row: HTMLElement
  top: number
  left: number
  width: number
  height: number
}

/** Each row's place in the list by key, in layout terms within the list. */
type Snapshot = Map<string, Placed>

const SPRING_MS = DURATION.long * 1000
const FADE_MS = DURATION.base * 1000
const EASING = `cubic-bezier(${EASE.join(', ')})`

/** Where the row is drawn, with any slide still under way counted in. */
function drawnTop(row: HTMLElement, sliding: WeakMap<HTMLElement, Animation>): number {
  return row.offsetTop + (sliding.has(row) ? drawnOffset(row) : 0)
}

function snapshot(list: HTMLElement, sliding: WeakMap<HTMLElement, Animation>): Snapshot {
  return new Map(
    rowsOf(list).map((row) => [
      row.dataset.key!,
      {
        row,
        top: drawnTop(row, sliding),
        left: row.offsetLeft,
        width: row.offsetWidth,
        height: row.offsetHeight,
      },
    ]),
  )
}

/**
 * A virtualized list's rows, in visual order. Each sits in a positioned wrapper of its own and
 * the DOM order lags while scrolling, so places are measured against the list itself.
 */
function placedSnapshot(list: HTMLElement): Snapshot {
  const origin = list.getBoundingClientRect()
  const placed = rowsOf(list).map((row): [string, Placed] => {
    const box = row.getBoundingClientRect()
    return [
      row.dataset.key!,
      {
        row,
        top: box.top - origin.top,
        left: box.left - origin.left,
        width: box.width,
        height: box.height,
      },
    ]
  })
  return new Map(placed.sort(([, a], [, b]) => a.top - b.top))
}

/** Whether any row in both snapshots changed its place. */
const anyMoved = (a: Snapshot, b: Snapshot): boolean =>
  [...b].some(([key, place]) => {
    const was = a.get(key)
    return was !== undefined && Math.abs(was.top - place.top) >= 0.5
  })

const sameOrder = (a: Snapshot, b: Snapshot): boolean => {
  if (a.size !== b.size) return false
  const later = [...b.keys()]
  return [...a.keys()].every((key, index) => later[index] === key)
}

/**
 * Animates the rows of `list` when the set or order of its rows changes after first paint: a
 * row that moves slides from its old place on the spring, a new row fades in, and a removed
 * row fades out where it stood while the rows below slide up over it. A change to the rows'
 * size alone, such as a resize, moves nothing. Paused while a drag is under way or settling,
 * since the drag places the rows itself, and off under reduced motion.
 *
 * In a `virtualized` list, rows also mount and unmount as it scrolls; a change that moves no
 * row and keeps the row count is that, and animates nothing. A removed row whose element the
 * list reuses for another row leaves no picture to fade; the rows below still slide up.
 */
export function useListMotion(
  list: HTMLElement | null,
  reduceMotion: boolean,
  virtualized = false,
): void {
  const reduceMotionRef = useLatest(reduceMotion)

  // Watches the rows themselves, not this list's renders: React Aria builds the rows in an
  // update of its own, after the list's render has committed.
  useLayoutEffect(() => {
    if (!list) return
    const sliding = new WeakMap<HTMLElement, Animation>()
    const measure = () => (virtualized ? placedSnapshot(list) : snapshot(list, sliding))
    const rowCount = () => list.getAttribute('aria-rowcount')
    let last = measure()
    let lastCount = rowCount()

    const changed = () => {
      const before = last
      const after = measure()
      const beforeCount = lastCount
      last = after
      lastCount = rowCount()
      if (reduceMotionRef.current || sameOrder(before, after)) return
      if (list.querySelector('[data-reordering]')) return
      // A list that kept none of its rows is a different list, such as another list opened in
      // its place; it swaps like a page.
      if (![...after.keys()].some((key) => before.has(key))) return
      if (virtualized && lastCount === beforeCount && !anyMoved(before, after)) return

      const viewTop = -list.getBoundingClientRect().top
      const viewBottom = viewTop + window.innerHeight
      const shown = (top: number, height: number) => top + height > viewTop && top < viewBottom

      for (const [key, place] of after) {
        const was = before.get(key)
        if (!was) {
          if (shown(place.top, place.height)) fadeIn(place.row)
          continue
        }
        const offset = was.top - place.top
        if (Math.abs(offset) < 0.5) continue
        if (!shown(was.top, was.height) && !shown(place.top, place.height)) continue
        sliding.get(place.row)?.cancel()
        const slide = place.row.animate(
          { transform: [`translateY(${offset}px)`, 'translateY(0)'] },
          { duration: SPRING_MS, easing: springEasing() },
        )
        sliding.set(place.row, slide)
        slide.onfinish = slide.oncancel = () => {
          if (sliding.get(place.row) === slide) sliding.delete(place.row)
        }
      }
      for (const [key, was] of before) {
        if (after.has(key) || was.row.isConnected || !shown(was.top, was.height)) continue
        fadeOut(list, was)
      }
    }

    // The mutation callback runs before the next paint, so no frame shows a row in its new
    // place before it starts from the old one.
    const rows = new MutationObserver(
      virtualized
        ? (records) => {
            // A virtualized list places a row by its wrapper's style and reuses elements, so
            // only those changes count, not a row's own content restyling itself.
            if (records.some((record) => isPlacement(list, record))) changed()
          }
        : changed,
    )
    rows.observe(
      list,
      virtualized
        ? {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'data-key'],
          }
        : { childList: true },
    )
    // Kept current when a row's height changes alone, which adds or removes no row, so the next
    // change never slides from a stale place.
    const sizes = new ResizeObserver(() => {
      last = measure()
    })
    sizes.observe(list)
    return () => {
      rows.disconnect()
      sizes.disconnect()
    }
  }, [list, reduceMotionRef, virtualized])
}

/** A mutation that adds, removes, places, or reassigns a virtualized list's row. */
function isPlacement(list: HTMLElement, record: MutationRecord): boolean {
  const target = record.target as Element
  if (record.type === 'childList') return target === list || target.parentElement === list
  if (record.attributeName === 'data-key') return target.getAttribute('role') === 'row'
  // A wrapper is a direct child of the virtualizer's content box inside the list.
  return target.parentElement?.parentElement === list
}

function fadeIn(row: HTMLElement): void {
  row.animate({ opacity: ['0', '1'] }, { duration: FADE_MS, easing: EASING })
}

/**
 * Shows the removed row's last frame where it stood, under the rows that slide up over it,
 * until it has faded. It is a picture: hidden from assistive technology, inert, and outside
 * the rows the list counts.
 */
function fadeOut(list: HTMLElement, { row, top, left, width, height }: Placed): void {
  row.getAnimations().forEach((animation) => animation.cancel())
  row.removeAttribute('data-key')
  row.removeAttribute('role')
  row.setAttribute('aria-hidden', 'true')
  row.inert = true
  Object.assign(row.style, {
    position: 'absolute',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
    margin: '0',
    transform: 'none',
    pointerEvents: 'none',
    zIndex: '-1',
  })
  list.append(row)
  const fade = row.animate(
    { opacity: [getComputedStyle(row).opacity, '0'], transform: ['scale(1)', 'scale(0.98)'] },
    { duration: FADE_MS, easing: EASING, fill: 'forwards' },
  )
  fade.onfinish = fade.oncancel = () => row.remove()
}
