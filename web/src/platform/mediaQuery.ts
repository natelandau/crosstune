import { useMemo, useSyncExternalStore } from 'react'

export function matches(query: string): boolean {
  return window.matchMedia?.(query).matches ?? false
}

/** Whether a CSS media query matches, tracked live. False where the browser cannot answer. */
export function useMediaQuery(query: string): boolean {
  // One list per mount, not per render: every row of a list asks on every render.
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
