import { renderHook } from '@testing-library/react'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { forgetUser, rememberUser } from '../../auth/session'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine, testSession } from '../../test/providers'
import { useCloseOnSignOutElsewhere } from './useCloseOnSignOutElsewhere'

afterEach(() => {
  forgetUser()
})

describe('useCloseOnSignOutElsewhere', () => {
  it.each([
    [
      'forgets the user',
      async () => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'crosstune.lastUserId' }))
      },
    ],
    ['deletes the database', (db: CrosstuneDb) => Dexie.delete(db.name)],
  ])(
    'closes the database for good and stops sync when another tab %s after a sign-out',
    async (_name, signal) => {
      rememberUser(testSession.userId)
      const db = openTestDb()
      const stop = vi.fn()
      renderHook(() => useCloseOnSignOutElsewhere(), {
        wrapper: dataProviders({ db, engine: fakeEngine({ stop }) }),
      })
      await db.tunes.count()

      forgetUser()
      await signal(db)

      await expect.poll(() => stop.mock.calls.length).toBe(1)
      expect(db.isOpen()).toBe(false)
      await expect(db.tunes.count()).rejects.toMatchObject({ name: 'DatabaseClosedError' })
    },
  )

  it('keeps the database open while this device still remembers the user', async () => {
    rememberUser(testSession.userId)
    const db = openTestDb()
    const stop = vi.fn()
    renderHook(() => useCloseOnSignOutElsewhere(), {
      wrapper: dataProviders({ db, engine: fakeEngine({ stop }) }),
    })
    await db.tunes.count()

    window.dispatchEvent(new StorageEvent('storage', { key: 'crosstune.lastUserId' }))

    await expect(db.tunes.count()).resolves.toBe(0)
    expect(stop).not.toHaveBeenCalled()
  })

  it('leaves an upgrade from another tab to Dexie', async () => {
    const db = openTestDb()
    const stop = vi.fn()
    renderHook(() => useCloseOnSignOutElsewhere(), {
      wrapper: dataProviders({ db, engine: fakeEngine({ stop }) }),
    })
    await db.tunes.count()

    const newer = new Dexie(db.name)
    newer.version(db.verno + 1).stores({})
    onTestFinished(() => newer.close())
    await newer.open()

    expect(stop).not.toHaveBeenCalled()
  })
})
