import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { settingsId } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { SEARCHABLE_PROVIDERS } from '../../db/types'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { servicesSummary } from './searchProviders'
import { useMusicServicesSetting } from './useMusicServicesSetting'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const setup = () => renderHook(() => useMusicServicesSetting(), { wrapper: dataProviders({ db }) })

describe('useMusicServicesSetting', () => {
  it('writes Play first through to the settings row', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.providers).toBeDefined()
    expect(result.current.playFirst).toBe('recordings')
    act(() => result.current.setPlayFirst('apple_music'))
    expect(result.current.playFirst).toBe('apple_music')
    await expect
      .poll(async () => (await db.user_settings.get(settingsId('user_1')))?.play_first)
      .toBe('apple_music')
    await expect.poll(() => result.current.playFirst).toBe('apple_music')
    expect(result.current.playFirstError).toBeNull()
  })

  it('writes a toggled service and counts it in the summary', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.providers).toBeDefined()
    const all = SEARCHABLE_PROVIDERS.length
    expect(result.current.summary).toBe(servicesSummary(all))
    act(() => result.current.toggle(SEARCHABLE_PROVIDERS[0]!, false))
    await expect.poll(() => result.current.summary).toBe(servicesSummary(all - 1))
    expect(result.current.providers?.has(SEARCHABLE_PROVIDERS[0]!)).toBe(false)
  })
})
