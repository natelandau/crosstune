import { createContext, useContext, useEffect, useState } from 'react'

/**
 * A fixed time in epoch milliseconds that every clock in the app reads instead of the real one,
 * so a seeded fixture shows the same dates on every run. Null follows the real clock.
 */
export const FixedNow = createContext<number | null>(null)

/** The fixed time as a date, or undefined while the app follows the real clock. */
export function useFixedNow(): Date | undefined {
  const fixed = useContext(FixedNow)
  return fixed === null ? undefined : new Date(fixed)
}

/** The time in epoch milliseconds, read again every `everyMs`, for a label that ages. */
export function useNow(everyMs = 60_000): number {
  const fixed = useContext(FixedNow)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (fixed !== null) return
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs, fixed])
  return fixed ?? now
}
