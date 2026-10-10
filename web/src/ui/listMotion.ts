import { useLayoutEffect } from 'react'
import { DURATION, EASE, springEasing } from '../theme/motion'
import { rowsOf } from './reorder'
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
  if (!sliding.has(row)) return row.offsetTop
  const { transform } = getComputedStyle(row)
  return row.offsetTop + (transform === 'none' ? 0 : new DOMMatrix(transform).m42)
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
 */
export function useListMotion(list: HTMLElement | null, reduceMotion: boolean): void {
  const reduceMotionRef = useLatest(reduceMotion)

  // Watches the rows themselves, not this list's renders: React Aria builds the rows in an
  // update of its own, after the list's render has committed.
  useLayoutEffect(() => {
    if (!list) return
    const sliding = new WeakMap<HTMLElement, Animation>()
    let last = snapshot(list, sliding)

    const changed = () => {
      const before = last
      const after = snapshot(list, sliding)
      last = after
      if (reduceMotionRef.current || sameOrder(before, after)) return
      if (list.querySelector('[data-reordering]')) return
      // A list that kept none of its rows is a different list, such as another list opened in
      // its place; it swaps like a page.
      if (![...after.keys()].some((key) => before.has(key))) return

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
    const rows = new MutationObserver(changed)
    rows.observe(list, { childList: true })
    // Kept current when a row's height changes alone, which adds or removes no row, so the next
    // change never slides from a stale place.
    const sizes = new ResizeObserver(() => {
      last = snapshot(list, sliding)
    })
    sizes.observe(list)
    return () => {
      rows.disconnect()
      sizes.disconnect()
    }
  }, [list, reduceMotionRef])
}

function fadeIn(row: HTMLElement): void {
  // To the row's own opacity, not 1, so a dimmed row lands dimmed.
  const opacity = getComputedStyle(row).opacity
  row.animate({ opacity: ['0', opacity] }, { duration: FADE_MS, easing: EASING })
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
