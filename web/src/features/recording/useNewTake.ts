import { useEffect, useState } from 'react'
import { type LastSaved, useLastSaved } from './RecordState'

// Saves whose row has shown the highlight and gone, so coming back to it shows it plain.
const spent = new WeakSet<LastSaved>()

/** Whether the recording is the take just saved, for its row to slide in highlighted. */
export function useNewTake(recordingId: string): boolean {
  const lastSaved = useLastSaved()
  const [spentAtMount] = useState(() => (lastSaved && spent.has(lastSaved) ? lastSaved : null))
  const fresh = lastSaved?.recordingId === recordingId && lastSaved !== spentAtMount
  useEffect(() => {
    if (!fresh || !lastSaved) return
    return () => void spent.add(lastSaved)
  }, [fresh, lastSaved])
  return fresh
}
