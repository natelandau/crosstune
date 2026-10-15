import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { entitlementRow } from '../../test/rows'
import { dataProviders } from '../../test/providers'
import { useStorageSummary } from './useStorageSummary'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const setup = () => renderHook(() => useStorageSummary(), { wrapper: dataProviders({ db }) })

describe('useStorageSummary', () => {
  it('says how much of the quota is spent', async () => {
    await setStorage(db, { used_bytes: 250_000_000, quota_bytes: 1_000_000_000, max_file_bytes: 1 })
    const { result } = setup()
    await expect
      .poll(() => result.current)
      .toEqual({
        used: 250_000_000,
        quota: 1_000_000_000,
        fraction: 0.25,
        label: '250 MB of 1 GB used',
      })
  })

  it('caps the fraction at a full bar', async () => {
    await setStorage(db, { used_bytes: 3_000, quota_bytes: 1_000, max_file_bytes: 1 })
    const { result } = setup()
    await expect.poll(() => result.current?.fraction).toBe(1)
  })

  it('says only how much is used when the server gives no quota', async () => {
    await setStorage(db, { used_bytes: 10_000_000, quota_bytes: 0, max_file_bytes: 1 })
    const { result } = setup()
    await expect
      .poll(() => result.current)
      .toEqual({ used: 10_000_000, quota: null, fraction: null, label: '10 MB used' })
  })
})

describe('useStorageSummary with a plan', () => {
  it('takes a premium quota from the entitlements row and the used bytes from the server figure', async () => {
    await db.entitlements.put(
      entitlementRow({ premium_source: 'comp', premium_quota_bytes: 50_000_000 }),
    )
    await setStorage(db, { used_bytes: 12_000_000, quota_bytes: 1_000_000_000, max_file_bytes: 1 })
    const { result } = setup()
    await expect.poll(() => result.current?.label).toBe('12 MB of 50 MB used')
  })

  it('gives no quota on a free plan, whatever quota the server figure last held', async () => {
    await db.entitlements.put(entitlementRow())
    await setStorage(db, { used_bytes: 12_000_000, quota_bytes: 1_000_000_000, max_file_bytes: 1 })
    const { result } = setup()
    await expect.poll(() => result.current?.label).toBe('12 MB used')
    expect(result.current).toMatchObject({ quota: null, fraction: null })
  })
})
