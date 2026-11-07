import { useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { useLatest } from '../../ui/useLatest'
import { ListHoldContext } from '../player/useListPlayback'
import { PracticeHoldsContext, type HeldSettings, type PracticeHolds } from './practiceHolds'

/**
 * Holds what practice and the trim view play ahead of each recording's row, so the dock reads
 * the same values wherever practice shows. A trim hold also holds a playing list at that
 * recording's natural end, so the list never moves the engine out from under the trim.
 */
export function PracticeHoldsProvider({ children }: { children: ReactNode }) {
  const trimmingRef = useRef<string | null>(null)
  const reportHoldingRef = useLatest(useContext(ListHoldContext))
  // A ref map, so the dock reads a hold inside its effects without re-rendering.
  const heldSettings = useRef(new Map<string, HeldSettings>())
  const listeners = useRef(new Set<() => void>())
  const held = useCallback((id: string) => heldSettings.current.get(id) ?? null, [])
  const hold = useCallback(
    (id: string, settings: HeldSettings | null) => {
      if (settings) heldSettings.current.set(id, settings)
      else if (!heldSettings.current.delete(id)) return
      const isTrimming = heldSettings.current.get(id)?.trimming === true
      const current = trimmingRef.current
      trimmingRef.current = isTrimming ? id : current === id ? null : current
      // Told at once rather than from an effect, so a natural end cannot land between a hold
      // and the list hearing of it.
      reportHoldingRef.current(trimmingRef.current)
      for (const listener of listeners.current) listener()
    },
    [reportHoldingRef],
  )
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const value = useMemo<PracticeHolds>(() => ({ held, hold, subscribe }), [held, hold, subscribe])
  return <PracticeHoldsContext.Provider value={value}>{children}</PracticeHoldsContext.Provider>
}
