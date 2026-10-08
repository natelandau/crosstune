import { useCallback, useEffect, useRef } from 'react'
import { useLatest } from '../../ui/useLatest'

/**
 * Writes `value` once it has held still for `delayMs`, and on unmount if it is still waiting,
 * so a control dragged through dozens of values writes only where it came to rest. The value
 * it starts with is never written.
 */
export function useSettledWrite<T>(value: T, write: (value: T) => void, delayMs = 1000): void {
  const writeRef = useLatest(write)
  const written = useRef(value)
  const waiting = useRef<{ value: T } | null>(null)

  const flush = useCallback(() => {
    const next = waiting.current
    if (!next) return
    waiting.current = null
    written.current = next.value
    writeRef.current(next.value)
  }, [writeRef])

  useEffect(() => {
    if (Object.is(value, written.current)) {
      waiting.current = null
      return
    }
    waiting.current = { value }
    const timer = setTimeout(flush, delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs, flush])

  useEffect(() => flush, [flush])
}
