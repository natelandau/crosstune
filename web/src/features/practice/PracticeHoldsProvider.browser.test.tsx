import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ListHoldContext } from '../player/useListPlayback'
import { PracticeHoldsProvider } from './PracticeHoldsProvider'
import { usePracticeHolds } from './practiceHolds'

function setup(reportHolding: (recordingId: string | null) => void = () => {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ListHoldContext.Provider value={reportHolding}>
      <PracticeHoldsProvider>{children}</PracticeHoldsProvider>
    </ListHoldContext.Provider>
  )
  return renderHook(() => usePracticeHolds(), { wrapper })
}

const TRIM = { speedPercent: 100, pitchCents: 0, isolate: null, trimming: true }

describe('PracticeHoldsProvider', () => {
  it('tells the list of a trim hold within the call that makes it', () => {
    const reported: (string | null)[] = []
    const { result } = setup((id) => reported.push(id))
    result.current.hold('r1', TRIM)
    expect(reported.at(-1)).toBe('r1')
    result.current.hold('r1', null)
    expect(reported.at(-1)).toBeNull()
  })

  it('holds no list for a hold of practice settings', () => {
    const reported: (string | null)[] = []
    const { result } = setup((id) => reported.push(id))
    result.current.hold('r1', { ...TRIM, speedPercent: 80, trimming: false })
    expect(reported).toEqual([null])
    expect(result.current.held('r1')?.speedPercent).toBe(80)
  })

  it('tells each subscriber of every change', () => {
    const { result } = setup()
    const listener = vi.fn()
    const unsubscribe = result.current.subscribe(listener)
    result.current.hold('r1', TRIM)
    result.current.hold('r1', null)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    result.current.hold('r1', TRIM)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
