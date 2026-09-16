import { useSyncExternalStore } from 'react'

/** Whether a CSS media query matches, tracked live. False where the browser cannot answer. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      const list = window.matchMedia?.(query)
      if (!list) return () => {}
      list.addEventListener('change', callback)
      return () => list.removeEventListener('change', callback)
    },
    () => window.matchMedia?.(query).matches ?? false,
  )
}

/** A mouse or trackpad is driving: the pointer is precise and can hover, so a swipe is not obvious. */
export function usePointerIsFine(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)')
}
