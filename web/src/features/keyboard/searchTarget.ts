import { createContext, useContext, useEffect, type RefObject } from 'react'

type SearchRef = RefObject<HTMLInputElement | null>

export interface SearchTargets {
  /** Holds `ref` as the search `/` focuses until the returned function lets it go. */
  register: (ref: SearchRef) => () => void
}

/** The slot `/` reads: the last search registered and still held wins. */
export function createSearchTargets(): SearchTargets & { focus: () => boolean } {
  let held: SearchRef[] = []
  return {
    register(ref) {
      held = [...held, ref]
      return () => {
        held = held.filter((other) => other !== ref)
      }
    },
    focus() {
      const input = held.at(-1)?.current
      if (!input) return false
      input.focus()
      // A search kept mounted under `hidden` takes no focus, and `/` stays the browser's.
      return document.activeElement === input
    },
  }
}

const NONE: SearchTargets = { register: () => () => {} }

export const SearchTargetContext = createContext<SearchTargets>(NONE)

/** Makes `ref`'s input the search `/` focuses while the calling screen is mounted. */
export function useSearchTarget(ref: SearchRef): void {
  const { register } = useContext(SearchTargetContext)
  useEffect(() => register(ref), [register, ref])
}
