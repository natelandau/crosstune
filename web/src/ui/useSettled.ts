import { useEffect, useState } from 'react'

/** How long a typed search or a moved map holds still before it is looked up. */
export const SETTLE_MS = 300

/**
 * `key` once it has held still for `SETTLE_MS`, else null. Every change starts the wait again,
 * so a lookup keyed on the result runs once per pause, never per keystroke or frame.
 */
export function useSettled(key: string | null): string | null {
  const [current, setCurrent] = useState(key)
  const [settled, setSettled] = useState<string | null>(null)
  if (current !== key) {
    setCurrent(key)
    setSettled(null)
  }
  useEffect(() => {
    if (key === null) return
    const timer = setTimeout(() => setSettled(key), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [key])
  return settled === key ? key : null
}
