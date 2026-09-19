import { useCallback, useState } from 'react'

/** The one wording for a rejection, so an inline error and a toast read the same. */
export function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export interface Action {
  /** The last rejection, for a `role="alert"` near the control that triggered it. */
  error: string | null
  /** True while an action is in flight, to disable the control that started it. */
  pending: boolean
  run: (action: () => Promise<unknown>) => void
  runThen: (action: () => Promise<unknown>, onSuccess: () => void) => void
  /** Drops the last rejection without starting another action. */
  clear: () => void
}

/** Runs a fire-and-forget mutation, surfacing a rejection instead of losing it. */
export function useAction(): Action {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const runThen = useCallback((action: () => Promise<unknown>, onSuccess: () => void) => {
    setError(null)
    setPending(true)
    action()
      .then(onSuccess)
      .catch((e: unknown) => setError(messageFor(e)))
      .finally(() => setPending(false))
  }, [])
  const run = useCallback(
    (action: () => Promise<unknown>) => {
      runThen(action, () => {})
    },
    [runThen],
  )
  const clear = useCallback(() => setError(null), [])
  return { error, pending, run, runThen, clear }
}
