import { act, renderHook } from '@testing-library/react'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../analytics/testing'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { useNewTuneSettings } from './useNewTuneSettings'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const setup = (analytics = recordingAnalytics()) => ({
  analytics,
  ...renderHook(() => useNewTuneSettings(), { wrapper: dataProviders({ db, analytics }) }),
})

const genreSet = (value: boolean) => ({
  name: 'setting_changed',
  props: { setting: 'new_tune_genre_set', value },
})

const status = (value: string) => ({
  name: 'setting_changed',
  props: { setting: 'new_tune_status', value },
})

/** Refuses every settings write that stores `genre`, and lets the others through. */
function refuseGenre(genre: string) {
  const put = db.user_settings.put.bind(db.user_settings)
  vi.spyOn(db.user_settings, 'put').mockImplementation((row, key) =>
    row.new_tune_genre === genre ? Dexie.Promise.reject(new Error('disk full')) : put(row, key),
  )
}

// Genre and status writes share one queue and settle in order, so each test ends with a status
// change that sends: once it is seen, every send queued before it is final.
describe('useNewTuneSettings', () => {
  it('reports a new status once it is written, and not when it is picked again', async () => {
    const { result, analytics } = setup()
    await expect.poll(() => result.current.defaults).toBeDefined()
    act(() => result.current.setStatus('want_to_learn'))
    act(() => result.current.setStatus('learning'))
    act(() => result.current.setStatus('learning'))
    act(() => result.current.setStatus('known'))
    await expect.poll(() => analytics.sends()).toEqual([status('learning'), status('known')])
  })

  it('reports a genre being set once, however many keys are typed', async () => {
    const { result, analytics } = setup()
    await expect.poll(() => result.current.defaults).toBeDefined()
    for (const typed of ['R', 'Re', 'Reel', 'Reels', 'Reels ']) {
      act(() => result.current.setGenre(typed))
    }
    act(() => result.current.setStatus('known'))
    await expect.poll(() => analytics.sends()).toEqual([genreSet(true), status('known')])
  })

  it('reports a cleared genre once', async () => {
    const { result, analytics } = setup()
    await expect.poll(() => result.current.defaults).toBeDefined()
    for (const typed of ['Reel', 'Ree', '', ' ']) act(() => result.current.setGenre(typed))
    act(() => result.current.setStatus('known'))
    await expect
      .poll(() => analytics.sends())
      .toEqual([genreSet(true), genreSet(false), status('known')])
  })

  it('reports a genre set by a later keystroke when the first one fails', async () => {
    const { result, analytics } = setup()
    await expect.poll(() => result.current.defaults).toBeDefined()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    refuseGenre('R')
    act(() => result.current.setGenre('R'))
    act(() => result.current.setGenre('Re'))
    act(() => result.current.setStatus('known'))
    await expect.poll(() => analytics.sends()).toEqual([genreSet(true), status('known')])
  })

  it('reports nothing for a write that fails', async () => {
    const { result, analytics } = setup()
    await expect.poll(() => result.current.defaults).toBeDefined()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refused = vi.spyOn(db, 'transaction').mockRejectedValue(new Error('disk full'))
    act(() => result.current.setStatus('known'))
    act(() => result.current.setGenre('Reel'))
    await expect.poll(() => result.current.statusError).toBe('disk full')
    await expect.poll(() => result.current.genreError).toBe('disk full')
    refused.mockRestore()
    act(() => result.current.setStatus('learning'))
    await expect.poll(() => analytics.sends()).toEqual([status('learning')])
  })
})
