import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsId } from '../../commands/settings'
import { getKeepOffline } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine } from '../../test/providers'
import { audioOnDevice } from './settingsCopy'
import { useRecordingSettings } from './useRecordingSettings'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const setup = (engine: SyncEngine = fakeEngine()) =>
  renderHook(() => useRecordingSettings(), { wrapper: dataProviders({ db, engine }) })

describe('useRecordingSettings', () => {
  it('starts a transfer and asks to keep the storage once keep offline is on', async () => {
    const persist = vi.spyOn(navigator.storage, 'persist').mockResolvedValue(true)
    const transfer = vi.fn(async () => {})
    const { result } = setup(fakeEngine({ transfer }))
    expect(result.current.keepOffline).toBe(false)
    act(() => result.current.setKeepOffline(true))
    expect(result.current.keepOffline).toBe(true)
    await expect.poll(() => transfer.mock.calls.length).toBe(1)
    await expect.poll(() => getKeepOffline(db)).toBe(true)
    expect(result.current.keepError).toBeNull()
    expect(persist).toHaveBeenCalledOnce()
  })

  it('starts no transfer when keep offline turns off', async () => {
    const persist = vi.spyOn(navigator.storage, 'persist').mockResolvedValue(true)
    const transfer = vi.fn(async () => {})
    const { result } = setup(fakeEngine({ transfer }))
    act(() => result.current.setKeepOffline(false))
    await expect.poll(() => getKeepOffline(db)).toBe(false)
    await expect.poll(() => result.current.keepOffline).toBe(false)
    expect(persist).not.toHaveBeenCalled()
    expect(transfer).not.toHaveBeenCalled()
  })

  it('writes the quality and labels the audio on this device', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.localBytesLabel).toBe(audioOnDevice(0))
    expect(result.current.quality).toBe('standard')
    act(() => result.current.setQuality('high'))
    await expect
      .poll(async () => (await db.user_settings.get(settingsId('user_1')))?.audio_quality)
      .toBe('high')
    await expect.poll(() => result.current.quality).toBe('high')
  })
})
