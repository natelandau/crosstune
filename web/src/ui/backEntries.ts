import { useCallback, useId, useLayoutEffect, useState } from 'react'
import type { BackEntry } from '../platform/backStack'
import { useLatest } from './useLatest'

/** An entry as it is held, with whether it stands the shell's controls down. */
export interface HeldEntry extends BackEntry {
  coversShell: boolean
}

// Entries in the order they were registered, so the latest of a layer is the one on top.
let held: HeldEntry[] = []
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function subscribeBackEntries(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

/** The open entries, oldest first. */
export function readBackEntries(): HeldEntry[] {
  return held
}

export interface BackEntryOptions {
  layer: BackEntry['layer']
  /** Runs on a back press while this entry is on top, as its Escape or Cancel would. */
  back?: () => void | Promise<void>
  dismissable?: boolean
  coversShell?: boolean
}

/**
 * Holds an entry on the app's back stack while `active`. Returns whether it is the latest entry
 * of its layer still held. Its place follows `active` alone, so a sheet that locks or stops
 * covering the shell keeps its place under whatever opened over it.
 */
export function useBackEntry(
  { layer, back, dismissable = true, coversShell = false }: BackEntryOptions,
  active = true,
): () => boolean {
  const id = useId()
  const backRef = useLatest(back)
  const dismissableRef = useLatest(dismissable)
  const coversShellRef = useLatest(coversShell)
  const [entry] = useState<HeldEntry>(() => ({
    id,
    layer,
    get coversShell() {
      return coversShellRef.current
    },
    get dismissable() {
      return dismissableRef.current
    },
    back: () => backRef.current?.(),
  }))

  // Layout effects, so an entry comes and goes in the commit that shows or removes its overlay.
  // A passive effect can run a task later, and a key listener reading the stack in that gap
  // would find a closed overlay still on top.
  useLayoutEffect(() => {
    if (!active) return
    held = [...held, entry]
    notify()
    return () => {
      held = held.filter((other) => other !== entry)
      notify()
    }
  }, [active, entry])

  useLayoutEffect(() => {
    if (held.includes(entry)) notify()
  }, [entry, coversShell])

  return useCallback(
    () => held.includes(entry) && held.findLast((other) => other.layer === entry.layer) === entry,
    [entry],
  )
}

/** Forgets every entry, so no test inherits one another test left behind. */
export function resetBackEntriesForTest(): void {
  held = []
  notify()
}
