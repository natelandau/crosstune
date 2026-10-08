import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countInvalidChanges } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { SYNC_STATUS_LABELS } from '../../sync/labels'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine } from '../../test/providers'
import { ONE_REJECTED } from './settingsCopy'
import { useSyncSettings } from './useSyncSettings'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const setup = (engine: SyncEngine = fakeEngine()) =>
  renderHook(() => useSyncSettings(), { wrapper: dataProviders({ db, engine }) })

describe('useSyncSettings', () => {
  it('syncs through the engine on Sync now', async () => {
    const sync = vi.fn(async () => {})
    const { result } = setup(fakeEngine({ sync }))
    act(() => result.current.syncNow())
    await expect.poll(() => sync.mock.calls.length).toBe(1)
    await expect.poll(() => result.current.pending).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('reports a refused sync', async () => {
    const { result } = setup(fakeEngine({ sync: async () => Promise.reject(new Error('No')) }))
    act(() => result.current.syncNow())
    await expect.poll(() => result.current.error).toBe('No')
  })

  it('names the status, the last sync, and a rejected change', async () => {
    const at = '2026-10-01T12:00:00.000Z'
    const { result } = setup(fakeEngine({ status: () => 'idle', lastSyncedAt: () => at }))
    expect(result.current.statusLabel).toBe(SYNC_STATUS_LABELS[result.current.status])
    expect(result.current.lastSynced).toBe(at)
    expect(result.current.rejectedMessage).toBeNull()
    await countInvalidChanges(db, 1)
    await expect.poll(() => result.current.rejectedMessage).toBe(ONE_REJECTED)
  })
})
