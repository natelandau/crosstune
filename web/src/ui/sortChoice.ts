import { useSyncExternalStore } from 'react'

/**
 * A sort and its direction. `descending` is newest first for a date sort and Z first otherwise.
 * A date sort starts descending; every other sort starts ascending.
 */
export interface SortChoice<S extends string> {
  sort: S
  descending: boolean
}

/** Picking the current sort reverses it; picking another starts it at its first direction. */
export function nextSort<S extends string>(
  current: SortChoice<S>,
  picked: S,
  isDate: (sort: S) => boolean,
): SortChoice<S> {
  if (current.sort === picked) return { sort: picked, descending: !current.descending }
  return { sort: picked, descending: isDate(picked) }
}

export interface SortStore<S extends string> {
  useSort: () => SortChoice<S>
  setSort: (choice: SortChoice<S>) => void
}

/**
 * One screen's sort choice, kept per device, like the appearance choice, so it lives in
 * localStorage rather than the synced settings row, and signing out leaves it alone.
 */
export function createSortStore<S extends string>(
  key: string,
  sorts: readonly S[],
  fallback: SortChoice<S>,
): SortStore<S> {
  function parse(raw: string | null): SortChoice<S> {
    if (!raw) return fallback
    try {
      const value: unknown = JSON.parse(raw)
      if (typeof value !== 'object' || value === null) return fallback
      const { sort, descending } = value as Record<string, unknown>
      if (!sorts.includes(sort as S) || typeof descending !== 'boolean') return fallback
      return { sort: sort as S, descending }
    } catch {
      return fallback
    }
  }

  function read(): SortChoice<S> {
    try {
      return parse(localStorage.getItem(key))
    } catch {
      return fallback
    }
  }

  // Storage is read once. After that the value in memory is what the screen shows, so a choice
  // made while storage is blocked still applies until the page reloads.
  let current: SortChoice<S> | undefined
  const snapshot = () => (current ??= read())

  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }
  const notify = () => {
    for (const listener of listeners) listener()
  }

  // The storage event fires only in the other tabs of this origin. A null key is
  // localStorage.clear().
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== null && event.key !== key) return
      current = read()
      notify()
    })
  }

  return {
    useSort: () => useSyncExternalStore(subscribe, snapshot),
    setSort: (choice) => {
      current = choice
      try {
        localStorage.setItem(key, JSON.stringify(choice))
      } catch {
        // Private mode or blocked storage: the choice still applies until the page reloads.
      }
      notify()
    },
  }
}
