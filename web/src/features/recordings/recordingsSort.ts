import { useSyncExternalStore } from 'react'
import {
  DEFAULT_SORT,
  RECORDING_SORTS,
  type RecordingSort,
  type SortChoice,
} from './arrangeRecordings'

// Per device, like the appearance choice, so it lives in localStorage rather than the synced
// settings row, and signing out leaves it alone.
export const RECORDINGS_SORT_KEY = 'crosstune.recordingsSort.v2'

function parse(raw: string | null): SortChoice {
  if (!raw) return DEFAULT_SORT
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return DEFAULT_SORT
    const { sort, descending } = value as Record<string, unknown>
    if (!RECORDING_SORTS.includes(sort as RecordingSort) || typeof descending !== 'boolean') {
      return DEFAULT_SORT
    }
    return { sort: sort as RecordingSort, descending }
  } catch {
    return DEFAULT_SORT
  }
}

function readSort(): SortChoice {
  try {
    return parse(localStorage.getItem(RECORDINGS_SORT_KEY))
  } catch {
    return DEFAULT_SORT
  }
}

// Storage is read once. After that the value in memory is what the screen shows, so a choice
// made while storage is blocked still applies until the page reloads.
let current: SortChoice | undefined

function snapshot(): SortChoice {
  return (current ??= readSort())
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const listener of listeners) listener()
}

// The storage event fires only in the other tabs of this origin. A null key is
// localStorage.clear().
function followOtherTabs(event: StorageEvent): void {
  if (event.key !== null && event.key !== RECORDINGS_SORT_KEY) return
  current = readSort()
  notify()
}

if (typeof window !== 'undefined') window.addEventListener('storage', followOtherTabs)

export function setRecordingsSort(choice: SortChoice): void {
  current = choice
  try {
    localStorage.setItem(RECORDINGS_SORT_KEY, JSON.stringify(choice))
  } catch {
    // Private mode or blocked storage: the choice still applies until the page reloads.
  }
  notify()
}

export function useRecordingsSort(): SortChoice {
  return useSyncExternalStore(subscribe, snapshot)
}
