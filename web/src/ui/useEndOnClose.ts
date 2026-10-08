import { useEffect } from 'react'
import { useLatest } from './useLatest'

/**
 * Ends a sheet's session once its hook asks the sheet to close. The sheet keeps its last
 * content while it animates away, so the session need not wait for the animation to finish.
 */
export function useEndOnClose(closing: boolean, end: () => void): void {
  const endRef = useLatest(end)
  useEffect(() => {
    if (closing) endRef.current()
  }, [closing, endRef])
}
