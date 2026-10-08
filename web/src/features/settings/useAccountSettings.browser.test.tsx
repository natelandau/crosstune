import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addUploadedFile, setFileState } from '../../commands/recordings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine, testSession } from '../../test/providers'
import { SIGNED_IN_OFFLINE } from './settingsCopy'
import { UNSYNCED_RECORDINGS_ERROR } from './signOut'
import { useAccountSettings } from './useAccountSettings'

const clerk = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
  user: null as {
    fullName?: string | null
    primaryEmailAddress?: { emailAddress: string }
  } | null,
}))

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: clerk.signOut }),
  useUser: () => ({ user: clerk.user }),
}))

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  clerk.signOut.mockClear()
  clerk.user = {
    fullName: 'Nate Landau',
    primaryEmailAddress: { emailAddress: 'nate@example.com' },
  }
})

describe('useAccountSettings', () => {
  it('names the signed-in account', () => {
    const { result } = renderHook(() => useAccountSettings(), { wrapper: dataProviders({ db }) })
    expect(result.current.identity).toEqual({ name: 'Nate Landau', email: 'nate@example.com' })
    expect(result.current.label).toBe('nate@example.com')
  })

  it('has no identity in an offline session', () => {
    clerk.user = null
    const { result } = renderHook(() => useAccountSettings(), {
      wrapper: dataProviders({ db, session: { ...testSession, offline: true } }),
    })
    expect(result.current.identity).toBeNull()
    expect(result.current.offline).toBe(true)
    expect(result.current.label).toBe(SIGNED_IN_OFFLINE)
  })

  it('refuses to sign out while a recording has not uploaded', async () => {
    const id = await addUploadedFile(db, new File(['abc'], 'jam.m4a', { type: 'audio/mp4' }), {
      tuneId: null,
      label: null,
      durationMs: null,
    })
    await setFileState(db, id, 'blocked_quota')
    await db.outbox.clear()
    const { result } = renderHook(() => useAccountSettings(), {
      wrapper: dataProviders({ db, engine: fakeEngine() }),
    })
    act(() => result.current.signOut())
    await expect.poll(() => result.current.error).toBe(UNSYNCED_RECORDINGS_ERROR)
    await expect.poll(() => result.current.pending).toBe(false)
    expect(clerk.signOut).not.toHaveBeenCalled()
  })
})
