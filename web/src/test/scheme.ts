import { DARK_QUERY } from '../features/settings/appearance'

interface DarkList {
  matches: boolean
  media: string
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

let original: typeof window.matchMedia | undefined
let dark = false
const listeners = new Set<() => void>()

/** Replace `matchMedia` for the dark query only. Pair with `restoreSystemDark` in `finally`. */
export function stubSystemDark(initial: boolean): void {
  original ??= window.matchMedia
  dark = initial
  listeners.clear()
  const list: DarkList = {
    get matches() {
      return dark
    },
    media: DARK_QUERY,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  }
  const real = original
  window.matchMedia = (query: string) =>
    query === DARK_QUERY ? (list as unknown as MediaQueryList) : real.call(window, query)
}

export function flipSystemDark(next: boolean): void {
  dark = next
  for (const listener of [...listeners]) listener()
}

/** How many listeners follow the stubbed dark query now. */
export function systemDarkListeners(): number {
  return listeners.size
}

export function restoreSystemDark(): void {
  if (original) window.matchMedia = original
  original = undefined
  listeners.clear()
}
