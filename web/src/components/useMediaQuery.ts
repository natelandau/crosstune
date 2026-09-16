import { useMemo, useSyncExternalStore } from 'react'

/** Whether a CSS media query matches, tracked live. False where the browser cannot answer. */
export function useMediaQuery(query: string): boolean {
  // One list per mount, not per render: each row of a list asks on every render.
  const list = useMemo(() => window.matchMedia?.(query) ?? null, [query])
  return useSyncExternalStore(
    (callback) => {
      if (!list) return () => {}
      list.addEventListener('change', callback)
      return () => list.removeEventListener('change', callback)
    },
    () => list?.matches ?? false,
  )
}

/** A mouse or trackpad is driving: the pointer is precise and can hover, so a swipe is not obvious. */
export function usePointerIsFine(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)')
}
