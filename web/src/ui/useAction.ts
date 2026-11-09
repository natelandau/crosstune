import { useCallback, useState } from 'react'

/** What a failure says when it has no words of its own to show. */
export const SOMETHING_WENT_WRONG = 'Something went wrong'

/** The one wording for a rejection, so an inline error and a toast read the same. */
export function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : SOMETHING_WENT_WRONG
}

export interface Action {
  /** The last rejection, for a `role="alert"` near the control that triggered it. */
  error: string | null
  /** True while any action is in flight, to disable the control that started it. */
  pending: boolean
  /** `attempt` with no success step and no returned work: on failure the control stays as it was. */
  run: (action: () => Promise<unknown>) => void
  /**
   * Runs `action` and returns the work, for a `Button` that shows it running, done, or failed.
   * Calls `onSuccess` only once `action` resolves, for a close or a navigation that must not
   * happen on failure. Starting clears the last error, and a throw from `onSuccess` lands in
   * `error` too. The returned promise rejects on failure, but the rejection is already handled
   * here, so a caller may drop it with `void`.
   */
  attempt: (action: () => Promise<unknown>, onSuccess?: () => void) => Promise<void>
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
  const attempt = useCallback((action: () => Promise<unknown>, onSuccess?: () => void) => {
    setError(null)
    setInFlight((n) => n + 1)
    // Runs `action` at once, and turns a synchronous throw into a rejection like any other.
    const work = new Promise((resolve) => resolve(action())).then(() => onSuccess?.())
    work.catch((e: unknown) => setError(messageFor(e))).finally(() => setInFlight((n) => n - 1))
    return work
  }, [])
  const run = useCallback(
    (action: () => Promise<unknown>) => {
      void attempt(action)
    },
    [attempt],
  )
  const clear = useCallback(() => setError(null), [])
  return { error, pending: inFlight > 0, run, attempt, clear }
}
