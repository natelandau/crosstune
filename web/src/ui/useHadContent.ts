import { useState } from 'react'

/**
 * Whether `shown` has held at any render since mount. An empty state that replaces a list, or
 * a list that replaces an empty state, arrives with a fade, while one present from the first
 * paint never moves.
 */
export function useHadContent(shown: boolean): boolean {
  const [had, setHad] = useState(shown)
  if (shown && !had) setHad(true)
  return had
}
