import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAccountDeletedNotice,
  clearLocalSignOut,
  hasAccountDeletedNotice,
  locallySignedOutUser,
} from '../../auth/session'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine, testSession } from '../../test/providers'
import { useForgetAccountDeletedElsewhere } from './useForgetAccountDeletedElsewhere'

afterEach(() => {
  clearAccountDeletedNotice()
  clearLocalSignOut()
})

describe('useForgetAccountDeletedElsewhere', () => {
  it('wipes this device once the engine hears the account was deleted elsewhere', async () => {
    let accountDeleted: (() => void) | undefined
    const stop = vi.fn()
    const engine = fakeEngine({
      stop,
      onAccountDeleted: (listener) => {
        accountDeleted = listener
        return () => {
          accountDeleted = undefined
        }
      },
    })
    const signOut = vi.fn(async () => {})
    renderHook(() => useForgetAccountDeletedElsewhere(signOut), {
      wrapper: dataProviders({ db: openTestDb(), engine }),
    })

    await vi.waitFor(() => expect(accountDeleted).toBeDefined())
    accountDeleted!()

    await expect.poll(() => locallySignedOutUser()).toBe(testSession.userId)
    expect(stop).toHaveBeenCalled()
    expect(signOut).toHaveBeenCalled()
    expect(hasAccountDeletedNotice()).toBe(true)
  })

  it('stops listening once unmounted', async () => {
    let listening = false
    const engine = fakeEngine({
      onAccountDeleted: () => {
        listening = true
        return () => {
          listening = false
        }
      },
    })
    const { unmount } = renderHook(() => useForgetAccountDeletedElsewhere(async () => {}), {
      wrapper: dataProviders({ db: openTestDb(), engine }),
    })
    await vi.waitFor(() => expect(listening).toBe(true))

    unmount()

    expect(listening).toBe(false)
  })
})
