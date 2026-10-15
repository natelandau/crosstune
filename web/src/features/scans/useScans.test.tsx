import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it } from 'vitest'
import { deleteScan } from '../../commands/scans'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { entitlementRow, scanRow } from '../../test/rows'
import { useScansOpen, useTunesWithScans } from './useScans'

async function seed(db: CrosstuneDb) {
  await db.scans.bulkPut([
    scanRow('b1', 'tb', { created_at: '2026-02-01T00:00:00.000Z' }),
    scanRow('a2', 'ta', { created_at: '2026-01-01T00:00:00.000Z' }),
    scanRow('a1', 'ta', { created_at: '2026-01-01T00:00:00.000Z' }),
    scanRow('gone', 'tc', {
      created_at: '2025-01-01T00:00:00.000Z',
      deleted_at: '2026-03-01T00:00:00.000Z',
    }),
  ])
}

function render<T>(db: CrosstuneDb, hook: () => T) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DbContext.Provider value={db}>{children}</DbContext.Provider>
  )
  return renderHook(hook, { wrapper })
}

it('on a free plan opens no scans, but still lists every tune with scans', async () => {
  const db = openTestDb()
  await seed(db)
  await db.entitlements.put(entitlementRow())
  const { result } = render(db, () => ({ opens: useScansOpen(), rows: useTunesWithScans() }))
  await expect.poll(() => result.current.opens).toBe(false)
  await expect.poll(() => [...result.current.rows].sort()).toEqual(['ta', 'tb'])
})

it('with no plan yet opens every tune with live scans', async () => {
  const db = openTestDb()
  await seed(db)
  const { result } = render(db, () => ({ opens: useScansOpen(), rows: useTunesWithScans() }))
  await expect.poll(() => [...result.current.rows].sort()).toEqual(['ta', 'tb'])
  expect(result.current.opens).toBe(true)
})

it('opens every tune with scans on a trial, and drops a tune once its scans are gone', async () => {
  const db = openTestDb()
  await seed(db)
  await db.entitlements.put(
    entitlementRow({
      premium_source: 'trial',
      premium_expires_at: '2099-01-01T00:00:00.000Z',
      trial_ends_at: '2099-01-01T00:00:00.000Z',
    }),
  )
  const { result } = render(db, () => ({
    plan: usePlanOrUnknown(),
    opens: useScansOpen(),
    rows: useTunesWithScans(),
  }))
  // Unknown opens every scan too, so the answer counts only once the trial has loaded.
  await expect.poll(() => result.current.plan.kind).toBe('premium')
  await expect.poll(() => [...result.current.rows].sort()).toEqual(['ta', 'tb'])
  expect(result.current.opens).toBe(true)
  await deleteScan(db, 'b1')
  await expect.poll(() => [...result.current.rows]).toEqual(['ta'])
})
