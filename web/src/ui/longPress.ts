import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'
import { tap } from '../platform/haptics'

const LONG_PRESS_MS = 500
// Wide enough that a swipe or a scroll never also counts as a hold.
const LONG_PRESS_SLOP_PX = 10
const CLICK_GUARD_MS = 50

export interface LongPressHandlers {
  onPointerDown?: (event: PointerEvent) => void
  onPointerMove?: (event: PointerEvent) => void
  onPointerUp?: () => void
  onPointerCancel?: () => void
  onPointerLeave?: () => void
  onContextMenu?: (event: MouseEvent) => void
}

/**
 * Block the click a long press leaves behind until shortly after the returned release runs.
 * The row's own click handler would otherwise fire right after the finger lifts.
 */
function guardTrailingClick(): () => void {
  const block = (event: globalThis.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('click', block, { capture: true })
  return () => {
    setTimeout(() => window.removeEventListener('click', block, { capture: true }), CLICK_GUARD_MS)
  }
}

export function useLongPress(onLongPress: (() => void) | undefined): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const pointerType = useRef<string | null>(null)
  const releaseClick = useRef<(() => void) | null>(null)

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }, [])

  const finish = useCallback(() => {
    cancel()
    releaseClick.current?.()
    releaseClick.current = null
  }, [cancel])

  useEffect(() => finish, [finish])

  // Always wired, even without a callback: a hold armed on a previous render (for example one
  // that ended because the row entered selection mode) still needs its release to run finish,
  // or the trailing-click guard it set stays up forever.
  const release: LongPressHandlers = {
    onPointerUp: finish,
    onPointerCancel: finish,
    onPointerLeave: finish,
  }

  if (!onLongPress) return release

  return {
    ...release,
    onPointerDown: (event) => {
      if (!event.isPrimary || event.button !== 0) return
      // A guard armed by an earlier hold whose release never arrived would swallow this press's click.
      finish()
      pointerType.current = event.pointerType
      start.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => {
        timer.current = null
        releaseClick.current = guardTrailingClick()
        tap()
        onLongPress()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (event) => {
      const origin = start.current
      if (!origin) return
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_SLOP_PX) {
        cancel()
      }
    },
    onContextMenu: (event) => {
      // A touch hold opens the browser's menu on some platforms; a mouse right-click keeps its menu.
      if (pointerType.current === 'touch') event.preventDefault()
    },
  }
}
