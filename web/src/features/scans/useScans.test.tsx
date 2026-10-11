import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it } from 'vitest'
import { deleteScan } from '../../commands/scans'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { SCAN_TUNE_ONLY_ERROR } from '../../db/scans'
import { entitlementRow, scanFile, scanRow } from '../../test/rows'
import { useScansOpen, useScanTune, useViewableScanTunes } from './useScans'

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

it('names the tune of the earliest live scan, and moves when its scans are gone', async () => {
  const db = openTestDb()
  await seed(db)
  const { result } = render(db, () => useScanTune())
  await expect.poll(() => result.current).toBe('ta')
  await deleteScan(db, 'a1')
  await deleteScan(db, 'a2')
  await expect.poll(() => result.current).toBe('tb')
  await deleteScan(db, 'b1')
  await expect.poll(() => result.current).toBeNull()
})

it('leaves a scan the server refused for its tune out of the scan tune', async () => {
  const db = openTestDb()
  await seed(db)
  // The earliest live scan, made offline and refused, which the server never counts.
  await db.scans.put(scanRow('x1', 'tx', { created_at: '2025-06-01T00:00:00.000Z', server_seq: 0 }))
  await db.scan_files.put(
    scanFile('x1', new Blob(['jpeg']), { origin: 'captured', error: SCAN_TUNE_ONLY_ERROR }),
  )
  await db.entitlements.put(entitlementRow())
  const { result } = render(db, () => ({
    tune: useScanTune(),
    a: useScansOpen('ta'),
    rows: useViewableScanTunes(),
  }))
  await expect.poll(() => result.current.tune).toBe('ta')
  await expect.poll(() => [...result.current.rows]).toEqual(['ta'])
  expect(result.current.a).toBe(true)
})

it('counts a stored scan whose upload slot was refused toward the scan tune', async () => {
  const db = openTestDb()
  await seed(db)
  // The server stored the row and counts it, though it refused the image a slot.
  await db.scans.put(scanRow('x1', 'tx', { created_at: '2025-06-01T00:00:00.000Z' }))
  await db.scan_files.put(
    scanFile('x1', new Blob(['jpeg']), { origin: 'captured', error: SCAN_TUNE_ONLY_ERROR }),
  )
  const { result } = render(db, () => useScanTune())
  await expect.poll(() => result.current).toBe('tx')
})

it("on a free plan opens only the scan tune's scans, and leaves the rest off rows", async () => {
  const db = openTestDb()
  await seed(db)
  await db.entitlements.put(entitlementRow())
  const { result } = render(db, () => ({
    a: useScansOpen('ta'),
    b: useScansOpen('tb'),
    rows: useViewableScanTunes(),
  }))
  await expect.poll(() => result.current.b).toBe(false)
  expect(result.current.a).toBe(true)
  await expect.poll(() => [...result.current.rows]).toEqual(['ta'])
})

it('opens every tune with scans on a trial', async () => {
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
    b: useScansOpen('tb'),
    rows: useViewableScanTunes(),
  }))
  // Unknown opens every scan too, so the answer counts only once the trial has loaded.
  await expect.poll(() => result.current.plan.kind).toBe('premium')
  await expect.poll(() => [...result.current.rows].sort()).toEqual(['ta', 'tb'])
  expect(result.current.b).toBe(true)
})
