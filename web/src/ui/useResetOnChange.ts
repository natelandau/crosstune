import { useState } from 'react'

/**
 * Runs `reset` during the render in which `key` changes, so state that belongs to one subject
 * never shows against the next. Done in render rather than an effect so no frame draws the old
 * state beside the new key.
 */
export function useResetOnChange(key: unknown, reset: () => void): void {
  const [seen, setSeen] = useState(key)
  if (!Object.is(seen, key)) {
    setSeen(key)
    reset()
  }
}
