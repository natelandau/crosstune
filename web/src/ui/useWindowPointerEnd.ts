import { useEffectEvent, useLayoutEffect } from 'react'

/**
 * Calls `onEnd` when a pointer is released or cancelled anywhere on the page, while `active`.
 * A press can end outside the element that took it, or lose its capture first.
 */
export function useWindowPointerEnd(active: boolean, onEnd: () => void): void {
  const end = useEffectEvent(onEnd)
  // A layout effect, so a release right after the press is never missed.
  useLayoutEffect(() => {
    if (!active) return
    const onUp = () => end()
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [active])
}
