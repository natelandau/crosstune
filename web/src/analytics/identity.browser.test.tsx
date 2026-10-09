import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAccountDeletedNotice, clearLocalSignOut } from '../auth/session'
import { deleteAccountAndForget } from '../features/settings/deleteAccount'
import { DELETE_CONFIRMATION_TEXT } from '../features/settings/deleteAccountCopy'
import { signOutAndForget } from '../features/settings/signOut'
import { useDeleteAccount } from '../features/settings/useDeleteAccount'
import { useForgetAccountDeletedElsewhere } from '../features/settings/useForgetAccountDeletedElsewhere'
import { setStorage } from '../db/meta'
import { openTestDb } from '../test/db'
import { dataProviders, fakeEngine, testSession } from '../test/providers'
import { AnalyticsIdentity } from './AnalyticsIdentity'
import type * as PersonPropertiesModule from './personProperties'
import { startAnalytics, USER_KEY, type PostHogLike } from './client'
import { recordingAnalytics } from './testing'

const clerk = vi.hoisted(() => ({
  signOut: async () => {},
  user: null as { createdAt: Date | null } | null,
}))
const person = vi.hoisted(() => ({ failNext: false, failed: 0 }))

vi.mock('./personProperties', async (importOriginal) => {
  const original = await importOriginal<typeof PersonPropertiesModule>()
  return {
    ...original,
    personProperties: (...args: Parameters<typeof original.personProperties>) => {
      if (person.failNext) {
        person.failNext = false
        person.failed += 1
        return Promise.reject(new Error('read failed'))
      }
      return original.personProperties(...args)
    },
  }
})

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: clerk.signOut }),
  useUser: () => ({ user: clerk.user }),
}))

const CREATED = new Date('2026-01-02T03:04:05.000Z')

beforeEach(() => {
  localStorage.removeItem(USER_KEY)
  clerk.user = { createdAt: CREATED }
  person.failNext = false
  person.failed = 0
})

afterEach(() => {
  localStorage.removeItem(USER_KEY)
  clearAccountDeletedNotice()
  clearLocalSignOut()
})

function mountIdentity(analytics: ReturnType<typeof recordingAnalytics>, offline = false) {
  const db = openTestDb()
  const wrapper = dataProviders({ db, analytics, session: { ...testSession, offline } })
  return render(<AnalyticsIdentity />, { wrapper })
}

const types = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.calls.map((call) => (call.type === 'send' ? call.name : call.type))

describe('AnalyticsIdentity', () => {
  it('a new user sends signed_in then identify with signed_up_at', async () => {
    const analytics = recordingAnalytics()
    mountIdentity(analytics)
    await expect.poll(() => types(analytics)).toEqual(['signed_in', 'identify'])
    expect(analytics.calls[1]).toMatchObject({
      userId: testSession.userId,
      signedUpAt: CREATED.toISOString(),
      person: { setting_appearance: 'system', setting_text_size: 0 },
    })
  })

  it('the remembered analytics user sends identify without signed_in', async () => {
    const analytics = recordingAnalytics({ user: testSession.userId })
    mountIdentity(analytics)
    await expect.poll(() => types(analytics)).toEqual(['identify'])
  })

  it('offline admission identifies without signed_up_at or signed_in', async () => {
    clerk.user = null
    const analytics = recordingAnalytics()
    mountIdentity(analytics, true)
    await expect.poll(() => types(analytics)).toEqual(['identify'])
    expect(analytics.calls[0]).not.toHaveProperty('signedUpAt')
  })

  it('sets storage_used once after the first sync stores the figures', async () => {
    const analytics = recordingAnalytics()
    const db = openTestDb()
    render(<AnalyticsIdentity />, { wrapper: dataProviders({ db, analytics }) })
    await expect.poll(() => types(analytics)).toEqual(['signed_in', 'identify'])
    await setStorage(db, { used_bytes: 20_000_000, quota_bytes: 1, max_file_bytes: 1 })
    await expect.poll(() => types(analytics)).toEqual(['signed_in', 'identify', 'setPerson'])
    expect(analytics.calls[1]).toMatchObject({
      person: { setting_appearance: 'system', setting_text_size: 0 },
    })
    expect(analytics.calls[1]).not.toHaveProperty('person.catalog_size')
    expect(analytics.calls[2]).toMatchObject({
      person: {
        storage_used: '10-50MB',
        catalog_size: '0',
        fields_used: [],
        setting_instruments: [],
        setting_download_all: false,
      },
    })
  })

  it('retries the figures on their next change after a failed read', async () => {
    const analytics = recordingAnalytics()
    const db = openTestDb()
    render(<AnalyticsIdentity />, { wrapper: dataProviders({ db, analytics }) })
    await expect.poll(() => types(analytics)).toEqual(['signed_in', 'identify'])
    person.failNext = true
    await setStorage(db, { used_bytes: 20_000_000, quota_bytes: 1, max_file_bytes: 1 })
    await expect.poll(() => person.failed).toBe(1)
    await setStorage(db, { used_bytes: 60_000_000, quota_bytes: 1, max_file_bytes: 1 })
    await expect.poll(() => types(analytics)).toEqual(['signed_in', 'identify', 'setPerson'])
    expect(analytics.calls[2]).toMatchObject({ person: { storage_used: '50-500MB' } })
  })

  it('a different remembered user resets before signed_in', async () => {
    const analytics = recordingAnalytics({ user: 'user_other' })
    mountIdentity(analytics)
    await expect.poll(() => types(analytics)).toEqual(['reset', 'signed_in', 'identify'])
  })

  it('same user signs back in after sign-out and sends signed_in again', async () => {
    const captured: string[] = []
    const ph: PostHogLike = {
      init: () => {},
      register: () => {},
      capture: (event) => void captured.push(event),
      identify: () => {},
      setPersonProperties: () => {},
      reset: () => {},
      opt_in_capturing: () => {},
      opt_out_capturing: () => {},
    }
    const analytics = startAnalytics({ key: 'test', load: async () => ph })
    const db = openTestDb()
    const first = render(<AnalyticsIdentity />, { wrapper: dataProviders({ db, analytics }) })
    await expect.poll(() => captured).toEqual(['signed_in'])
    expect(localStorage.getItem(USER_KEY)).toBe(testSession.userId)
    first.unmount()

    await signOutAndForget({
      db,
      userId: testSession.userId,
      engine: fakeEngine(),
      signOut: async () => {},
      analytics,
    })
    expect(localStorage.getItem(USER_KEY)).toBeNull()

    render(<AnalyticsIdentity />, {
      wrapper: dataProviders({ db: openTestDb(), analytics }),
    })
    await expect.poll(() => captured).toEqual(['signed_in', 'signed_out', 'signed_in'])
  })
})

describe('leaving the account', () => {
  it('sign-out sends signed_out, then resets', async () => {
    const analytics = recordingAnalytics()
    await signOutAndForget({
      db: openTestDb(),
      userId: testSession.userId,
      engine: fakeEngine(),
      signOut: async () => {},
      analytics,
    })
    expect(types(analytics)).toEqual(['signed_out', 'reset'])
  })

  it('account deletion resets, then sends account_deleted', async () => {
    const analytics = recordingAnalytics()
    await deleteAccountAndForget({
      db: openTestDb(),
      userId: testSession.userId,
      engine: fakeEngine(),
      signOut: async () => {},
      analytics,
    })
    expect(types(analytics)).toEqual(['reset', 'account_deleted'])
  })

  it('deletion from another device resets, then sends account_deleted', async () => {
    const analytics = recordingAnalytics()
    let deleted: (() => void) | undefined
    const engine = fakeEngine({
      onAccountDeleted: (listener) => {
        deleted = listener
        return () => {}
      },
    })
    renderHook(() => useForgetAccountDeletedElsewhere(async () => {}), {
      wrapper: dataProviders({ db: openTestDb(), engine, analytics }),
    })
    await expect.poll(() => deleted).toBeDefined()
    act(() => deleted?.())
    await expect.poll(() => types(analytics)).toEqual(['reset', 'account_deleted'])
  })
})

describe('the delete sheet', () => {
  function mountSheet(analytics: ReturnType<typeof recordingAnalytics>, engine = fakeEngine()) {
    return renderHook(({ open }) => useDeleteAccount(open), {
      initialProps: { open: false },
      wrapper: dataProviders({ db: openTestDb(), analytics, engine }),
    })
  }

  it('opening and dismissing the delete sheet sends started then cancelled', async () => {
    const analytics = recordingAnalytics()
    const { result, rerender } = mountSheet(analytics)
    expect(types(analytics)).toEqual([])
    rerender({ open: true })
    await expect.poll(() => types(analytics)).toEqual(['account_deletion_started'])
    act(() => result.current.close())
    expect(types(analytics)).toEqual(['account_deletion_started', 'account_deletion_cancelled'])
  })

  it('two dismissals send one cancelled', async () => {
    const analytics = recordingAnalytics()
    const { result, rerender } = mountSheet(analytics)
    rerender({ open: true })
    await expect.poll(() => types(analytics)).toEqual(['account_deletion_started'])
    act(() => result.current.close())
    act(() => result.current.close())
    expect(types(analytics)).toEqual(['account_deletion_started', 'account_deletion_cancelled'])
  })

  it('two dismissals in one tick send one cancelled', async () => {
    const analytics = recordingAnalytics()
    const { result, rerender } = mountSheet(analytics)
    rerender({ open: true })
    await expect.poll(() => types(analytics)).toEqual(['account_deletion_started'])
    act(() => {
      const { close } = result.current
      close()
      close()
    })
    expect(types(analytics)).toEqual(['account_deletion_started', 'account_deletion_cancelled'])
  })

  it('a successful delete sends no cancelled', async () => {
    const analytics = recordingAnalytics()
    const { result, rerender } = mountSheet(analytics)
    rerender({ open: true })
    await expect.poll(() => result.current.loading).toBe(false)
    act(() => result.current.setText(DELETE_CONFIRMATION_TEXT))
    act(() => result.current.run())
    await expect.poll(() => result.current.closing).toBe(true)
    act(() => result.current.close())
    expect(types(analytics)).toEqual(['account_deletion_started', 'reset', 'account_deleted'])
  })
})
