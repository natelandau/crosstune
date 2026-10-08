import { frame } from 'motion/react'
import { vi } from 'vitest'
import type { Locator } from 'vitest/browser'
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from '../ui/RowSwipe'

const POINTER_ID = 7

type PointerKind = 'touch' | 'mouse'

function center(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/**
 * The element a finger at the locator's center would touch, as a real press targets the
 * innermost element there. A touch keeps that target for the whole gesture.
 */
function touched(locator: Locator): { target: Element; at: { x: number; y: number } } {
  const element = locator.element()
  const at = center(element)
  return { target: document.elementFromPoint(at.x, at.y) ?? element, at }
}

function fire(
  target: EventTarget,
  type: string,
  at: { x: number; y: number },
  pointerType: PointerKind,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: POINTER_ID,
      pointerType,
      isPrimary: true,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: at.x,
      clientY: at.y,
    }),
  )
}

// One browser frame, so a press and its lift never land in the same frame.
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/**
 * Resolves once Motion's own frame loop has run. Motion moves a drag only in its frames, and
 * with a direction lock it spends the first frame that reads a move on the lock, so a drag
 * paced by the browser's frames alone can lift before Motion has moved anything.
 */
const motionFrame = () => new Promise<void>((resolve) => frame.postRender(() => resolve()))

/**
 * Drags from the element's center by `dx`, `dy` in steps, each read by a Motion frame, then
 * lifts. The first move clears the long-press slop at once, and the press's hold timer runs on
 * a fake clock until the last move, so slow frames can never let the hold fire mid-drag and
 * turn the drag into a press. A caller that already fakes timers keeps its own clock.
 */
export function drag(
  locator: Locator,
  dx: number,
  dy: number,
  { pointerType = 'touch', steps = 12 }: { pointerType?: PointerKind; steps?: number } = {},
): Promise<void> {
  const length = Math.hypot(dx, dy)
  // Just past the slop, along the drag, unless the whole drag is shorter.
  const opening = length > 0 ? Math.min(1, (LONG_PRESS_SLOP_PX + 1) / length) : 0
  const path = Array.from({ length: steps }, (_, index) => {
    const share = Math.max((index + 1) / steps, opening)
    return { x: dx * share, y: dy * share }
  })
  return dragThrough(locator, path, { pointerType })
}

/**
 * Presses the element's center, moves through each offset from it in turn, each read by a
 * Motion frame, and lifts at the last. Resolves once Motion has handled the lift, so a drag's
 * end handler has run. The hold timer runs on a fake clock as in `drag`.
 */
export async function dragThrough(
  locator: Locator,
  path: { x: number; y: number }[],
  { pointerType = 'touch' }: { pointerType?: PointerKind } = {},
): Promise<void> {
  const { target, at: start } = touched(locator)
  const ownClock = !vi.isFakeTimers()
  if (ownClock) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let at = start
  try {
    fire(target, 'pointerdown', start, pointerType)
    await motionFrame()
    for (const offset of path) {
      at = { x: start.x + offset.x, y: start.y + offset.y }
      fire(target, 'pointermove', at, pointerType)
      await motionFrame()
    }
  } finally {
    if (ownClock) vi.useRealTimers()
  }
  await motionFrame()
  fire(target, 'pointerup', at, pointerType)
  // Motion calls a drag's end handler in the frame after the lift.
  await motionFrame()
}

/** A touch drag leftward by `px` from the element's center. */
export function swipeLeft(
  locator: Locator,
  px: number,
  options?: { pointerType?: PointerKind },
): Promise<void> {
  return drag(locator, -px, 0, options)
}

/** A touch drag rightward by `px` from the element's center. */
export function swipeRight(locator: Locator, px: number): Promise<void> {
  return drag(locator, px, 0)
}

/**
 * A touch held still for the long-press time, then, if `thenMove` is given, moved that far
 * down before lifting. The hold runs on fake timeouts so no test waits half a second.
 */
export async function longPress(
  locator: Locator,
  { thenMove = 0 }: { thenMove?: number } = {},
): Promise<void> {
  const { target, at: start } = touched(locator)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    fire(target, 'pointerdown', start, 'touch')
    vi.advanceTimersByTime(LONG_PRESS_MS)
  } finally {
    vi.useRealTimers()
  }
  let at = start
  if (thenMove) {
    at = { x: start.x, y: start.y + thenMove }
    await nextFrame()
    fire(target, 'pointermove', at, 'touch')
  }
  await nextFrame()
  fire(target, 'pointerup', at, 'touch')
}

/**
 * A touch tap at the element's center: down and up in place. `beforeLift` runs while the finger
 * is down, so a test can run out what an earlier gesture left pending before the lift.
 */
export async function tap(
  locator: Locator,
  { beforeLift }: { beforeLift?: () => void | Promise<void> } = {},
): Promise<void> {
  const { target, at } = touched(locator)
  fire(target, 'pointerdown', at, 'touch')
  await nextFrame()
  await beforeLift?.()
  fire(target, 'pointerup', at, 'touch')
}

/** A touch drag downward by `px` from the element's center. */
export function dragDown(locator: Locator, px: number): Promise<void> {
  return drag(locator, 0, px)
}

/**
 * A touch held still for the long-press time, then moved `dy` down in steps, each read by a
 * Motion frame, then lifted. `midway` runs after the first half of the moves and `beforeLift`
 * after the last, while the drag is live. The hold runs on fake timeouts so no test waits half
 * a second; a caller that already fakes timers keeps its own clock.
 */
export async function longPressDrag(
  locator: Locator,
  dy: number,
  {
    steps = 12,
    midway,
    beforeLift,
  }: {
    steps?: number
    midway?: () => void | Promise<void>
    beforeLift?: () => void | Promise<void>
  } = {},
): Promise<void> {
  const { target, at: start } = touched(locator)
  const ownClock = !vi.isFakeTimers()
  if (ownClock) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    fire(target, 'pointerdown', start, 'touch')
    vi.advanceTimersByTime(LONG_PRESS_MS)
  } finally {
    if (ownClock) vi.useRealTimers()
  }
  let at = start
  for (let step = 1; step <= steps; step++) {
    at = { x: start.x, y: start.y + (dy * step) / steps }
    fire(target, 'pointermove', at, 'touch')
    await motionFrame()
    if (step === Math.floor(steps / 2)) await midway?.()
  }
  await beforeLift?.()
  fire(target, 'pointerup', at, 'touch')
  await motionFrame()
}
