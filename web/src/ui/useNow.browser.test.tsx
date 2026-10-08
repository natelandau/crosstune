import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it } from 'vitest'
import { FixedNow, useFixedNow, useNow } from './useNow'

const AT = Date.parse('2026-10-06T16:00:00.000Z')

it('reads the fixed time when one is set, for both the ticking and the dated clock', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FixedNow value={AT}>{children}</FixedNow>
  )
  const { result } = renderHook(() => [useNow(), useFixedNow()] as const, { wrapper })
  expect(result.current[0]).toBe(AT)
  expect(result.current[1]?.getTime()).toBe(AT)
})

it('follows the real clock without one', () => {
  const before = Date.now()
  const { result } = renderHook(() => [useNow(), useFixedNow()] as const)
  expect(result.current[0]).toBeGreaterThanOrEqual(before)
  expect(result.current[1]).toBeUndefined()
})
