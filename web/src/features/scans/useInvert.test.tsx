import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it } from 'vitest'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { useInvert } from './useInvert'

function render(db: CrosstuneDb) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DbContext.Provider value={db}>{children}</DbContext.Provider>
  )
  return renderHook(useInvert, { wrapper })
}

it('shows scans as they are until inverted, and keeps the inversion for the next viewer', async () => {
  const db = openTestDb()
  const first = render(db)
  await expect.poll(() => first.result.current[0]).toBe(false)
  await act(() => first.result.current[1](true))
  await expect.poll(() => first.result.current[0]).toBe(true)
  first.unmount()
  const next = render(db)
  await expect.poll(() => next.result.current[0]).toBe(true)
})
