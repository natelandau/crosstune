import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useLatest } from './useLatest'

export type WorkingState = 'idle' | 'working' | 'done'

/** How long work runs before the spinner shows, so quick work shows only the check. */
export const WORKING_DELAY_MS = 300
/** How long the check holds before the label returns. */
export const DONE_HOLD_MS = 1200

/**
 * Starts the working timeline on `work` and returns it, for a press that first waits on the
 * person, such as a confirmation: only the work after their answer shows the spinner.
 */
export type TrackWork = <T>(work: Promise<T>) => Promise<T>

/** A `TrackWork` for a call with no button to show the work. */
export const untracked: TrackWork = (work) => work

/** What work resolves to when a later press replaced it, so it ends with no check. */
export const WORK_SUPERSEDED = Symbol('work superseded')

export interface WorkingOptions {
  /** False for a control that leaves the screen when its work ends, where leaving confirms it. */
  showDone?: boolean
  onFailed?: (error: unknown) => void
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | undefined)?.then === 'function'
}

/**
 * Runs a press whose handler returns its work, or hands work that starts later to `track`, and
 * reports the work's state: `working` once it has run past the delay, `done` for a moment after
 * it resolves, and `idle` again at once when it rejects, after `onFailed`. Presses are ignored
 * from the start of the work until the check has gone.
 */
export function useWorking(
  onPress: ((track: TrackWork) => void | Promise<unknown>) | undefined,
  { showDone = true, onFailed }: WorkingOptions = {},
): { state: WorkingState; press: () => void } {
  const [state, setState] = useState<WorkingState>('idle')
  const latestRef = useLatest({ onPress, onFailed, showDone })
  const busy = useRef(false)
  const mounted = useRef(false)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const clearTimers = useCallback(() => {
    for (const id of timers.current) clearTimeout(id)
    timers.current.clear()
  }, [])

  // A layout effect, so a press that lands before passive effects flush still counts as mounted.
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimers()
    }
  }, [clearTimers])

  const later = useCallback((run: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      run()
    }, ms)
    timers.current.add(id)
  }, [])

  const run = useCallback(
    (work: PromiseLike<unknown>) => {
      if (busy.current || !mounted.current) return
      busy.current = true
      later(() => setState('working'), WORKING_DELAY_MS)
      work.then(
        (value) => {
          if (!mounted.current) return
          clearTimers()
          if (!latestRef.current.showDone || value === WORK_SUPERSEDED) {
            busy.current = false
            setState('idle')
            return
          }
          setState('done')
          later(() => {
            busy.current = false
            setState('idle')
          }, DONE_HOLD_MS)
        },
        (error: unknown) => {
          if (!mounted.current) return
          clearTimers()
          busy.current = false
          latestRef.current.onFailed?.(error)
          setState('idle')
        },
      )
    },
    [latestRef, later, clearTimers],
  )

  const press = useCallback(() => {
    if (busy.current) return
    const track: TrackWork = (work) => {
      run(work)
      return work
    }
    const result = latestRef.current.onPress?.(track)
    if (isThenable(result)) run(result)
  }, [latestRef, run])

  return { state, press }
}

/**
 * Sets `aria-busy` on a React Aria button while `busy`. React Aria passes only the DOM props it
 * knows, and drops `aria-busy`, so it is written to the element directly.
 */
export function useBusyAttribute(element: RefObject<HTMLElement | null>, busy: boolean): void {
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    if (busy) node.setAttribute('aria-busy', 'true')
    else node.removeAttribute('aria-busy')
  }, [element, busy])
}
