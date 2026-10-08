import { useCallback, useLayoutEffect, useRef } from 'react'
import { usePlayer } from './usePlayer'

/**
 * Hands focus back to the control that opened the player when the player unloads while focus
 * is inside it. Attach the returned ref to the player's outermost element, and call the hook
 * from a component that outlives that element.
 */
export function usePlayerFocusReturn(): (element: HTMLElement) => () => void {
  const { item, returnFocus } = usePlayer()
  const shown = useRef<HTMLElement | null>(null)
  // Removing the focused close button drops focus to the body, so the element notes on its
  // way out whether it held focus. Where the element leaves only after the unload commits,
  // the check below still finds focus inside it.
  const hadFocus = useRef(false)
  const ref = useCallback((element: HTMLElement) => {
    shown.current = element
    return () => {
      hadFocus.current = element.contains(document.activeElement)
      if (shown.current === element) shown.current = null
    }
  }, [])

  // Focus moves only once the player is unloaded, so a Play row button already reads Play
  // when it takes focus.
  useLayoutEffect(() => {
    if (item !== null) return
    const held = hadFocus.current || !!shown.current?.contains(document.activeElement)
    hadFocus.current = false
    if (!held) return
    returnFocus()
    // The page's own read of the same change can remove the opener a moment later, which
    // drops focus to the body; checking again after a frame sends it to the main region.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) returnFocus()
    })
    return () => cancelAnimationFrame(frame)
  }, [item, returnFocus])

  return ref
}
