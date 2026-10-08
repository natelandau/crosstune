import { useCallback, useState } from 'react'

/** The one wording for a rejection, so an inline error and a toast read the same. */
export function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export interface Action {
  /** The last rejection, for a `role="alert"` near the control that triggered it. */
  error: string | null
  /** True while any action is in flight, to disable the control that started it. */
  pending: boolean
  /** `runThen` with no success step: on failure the control stays as it was. */
  run: (action: () => Promise<unknown>) => void
  /**
   * Calls `onSuccess` only once `action` resolves, for a close or a navigation that must not
   * happen on failure. Starting clears the last error, and a throw from `onSuccess` lands in
   * `error` too.
   */
  runThen: (action: () => Promise<unknown>, onSuccess: () => void) => void
  /** Drops the last rejection without starting another action. */
  clear: () => void
}

/**
 * Runs a fire-and-forget mutation from a control's handler, surfacing a rejection instead of
 * losing it. Pair `error` with an inline alert and `pending` with the control's disabled state.
 */
export function useAction(): Action {
  const [error, setError] = useState<string | null>(null)
  // A count, so the first of two overlapping actions to settle does not end the other's wait.
  const [inFlight, setInFlight] = useState(0)
  const runThen = useCallback((action: () => Promise<unknown>, onSuccess: () => void) => {
    setError(null)
    setInFlight((n) => n + 1)
    action()
      .then(onSuccess)
      .catch((e: unknown) => setError(messageFor(e)))
      .finally(() => setInFlight((n) => n - 1))
  }, [])
  const run = useCallback(
    (action: () => Promise<unknown>) => {
      runThen(action, () => {})
    },
    [runThen],
  )
  const clear = useCallback(() => setError(null), [])
  return { error, pending: inFlight > 0, run, runThen, clear }
}
