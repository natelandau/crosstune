import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

interface Pending<T, P> {
  patch: P
  seq: number
  /** The stored value on screen when the write landed; set once the write has succeeded. */
  savedOn?: T
}

function matches<T extends object>(stored: T, patch: Partial<T>): boolean {
  return Object.entries(patch).every(([key, value]) => stored[key as keyof T] === value)
}

/**
 * A live stored value with any patch still being written already applied, and the function
 * that writes a patch. Ionic React assigns every prop back onto a control on each render, so
 * showing only the stored value would snap a control back to its old value mid-write, and a
 * segment would then report the tap a second time.
 *
 * Writes run one after another, so back-to-back patches build on each other and the last one
 * is the value stored. The returned promise settles with its own write, and a failure drops
 * only that write's patch: a later patch still being written keeps showing.
 */
export function usePendingWrite<T extends object, P extends Partial<T> = Partial<T>>(
  stored: T | null | undefined,
  write: (patch: P) => Promise<void>,
): [T | null | undefined, (patch: P) => Promise<void>] {
  const [pending, setPending] = useState<Pending<T, P> | null>(null)
  const seqRef = useRef(0)
  const queueRef = useRef(Promise.resolve())
  const writeRef = useRef(write)
  // A layout effect runs in the same task as the commit, so a write that settles later always
  // finds the value that is on screen, never an older read.
  const shownStored = useRef<T | null | undefined>(undefined)
  useLayoutEffect(() => {
    writeRef.current = write
    shownStored.current = stored
  }, [write, stored])

  // The first read after the write decides, whatever it holds: a sync or another tab can
  // write between this write and that read, and the screen must then follow the stored value.
  if (
    pending?.savedOn &&
    stored &&
    (stored !== pending.savedOn || matches(stored, pending.patch))
  ) {
    setPending(null)
  }

  const update = useCallback((patch: P) => {
    const seq = ++seqRef.current
    const run = writeRef.current
    setPending((current) => ({ patch: { ...current?.patch, ...patch }, seq }))
    const next = queueRef.current.then(() => run(patch))
    queueRef.current = next.catch(() => {})
    next.then(
      () => {
        const savedOn = shownStored.current
        setPending((current) => {
          if (current?.seq !== seq) return current
          // Nothing on screen to wait past, so the next read decides on its own.
          return savedOn ? { ...current, savedOn } : null
        })
      },
      () => setPending((current) => (current?.seq === seq ? null : current)),
    )
    return next
  }, [])

  // Memoized, since callers compare the value by identity to tell a real change.
  const patch = pending?.patch
  const shown = useMemo(() => (stored && patch ? { ...stored, ...patch } : stored), [stored, patch])
  return [shown, update]
}
