import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
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

  it('shows nothing until the server has given a quota', async () => {
    await setStorage(db, { used_bytes: 10, quota_bytes: 0, max_file_bytes: 1 })
    const { result } = setup()
    // The read settles to the same null it starts at, so wait on the stored row instead.
    await expect.poll(async () => (await db.meta.count()) > 0).toBe(true)
    expect(result.current).toBeNull()
  })
})
