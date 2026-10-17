import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalEntitlement } from '../../db/types'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine } from '../../test/providers'
import { page } from 'vitest/browser'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { renderWithProviders } from '../../test/render'
import { APP_STORE_SUBSCRIPTIONS_URL, MANAGE_APP_STORE } from '../plan/planCopy'
import { DeleteAccountSheet } from './pages/DeleteAccountSheet'
import { entitlementRow } from '../../test/rows'
import type * as AppleSignInModule from './appleSignIn'
import type { AppleIDAuth } from './appleSignIn'
import {
  APPLE_CONFIRM_LINE,
  APPLE_SUBSCRIPTION_LINE,
  DELETE_CONFIRMATION_TEXT,
  DELETE_FAILED,
  SETTINGS_LINE,
  STRIPE_SUBSCRIPTION_LINE,
} from './deleteAccountCopy'
import { useDeleteAccount, type SubscriptionNote } from './useDeleteAccount'

const clerk = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
  user: null as { externalAccounts: { provider: string }[] } | null,
}))

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: clerk.signOut }),
  useUser: () => ({ user: clerk.user }),
}))

const apple = vi.hoisted(() => ({
  onOrigin: false,
  load: null as unknown as () => Promise<AppleIDAuth>,
}))

vi.mock('./appleSignIn', async (importOriginal) => ({
  ...(await importOriginal<typeof AppleSignInModule>()),
  onAppleOrigin: () => apple.onOrigin,
  loadAppleAuth: () => apple.load(),
}))

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  clerk.user = null
  apple.onOrigin = false
  apple.load = vi.fn(async () => Promise.reject(new Error('not loaded in this test')))
})

describe('useDeleteAccount', () => {
  it('stays unconfirmed until the confirmation text matches', async () => {
    // A refusal the server answered, so the run settles without erasing the test database.
    const deleteAccount = vi.fn(async () => Promise.reject(new ApiError(422, null)))
    const { result } = renderHook(() => useDeleteAccount(true), {
      wrapper: dataProviders({ db, engine: fakeEngine({ deleteAccount }) }),
    })
    await expect.poll(() => result.current.countLines).toEqual([SETTINGS_LINE])
    expect(result.current.confirmed).toBe(false)
    act(() => result.current.run())
    act(() => result.current.setText(DELETE_CONFIRMATION_TEXT.slice(0, -1)))
    expect(result.current.confirmed).toBe(false)
    act(() => result.current.run())
    expect(deleteAccount).not.toHaveBeenCalled()
    act(() => result.current.setText(DELETE_CONFIRMATION_TEXT))
    expect(result.current.confirmed).toBe(true)
    act(() => result.current.run())
    await expect.poll(() => deleteAccount.mock.calls.length).toBe(1)
    await expect.poll(() => result.current.error).toBe(DELETE_FAILED)
  })

  const STRIPE = { line: STRIPE_SUBSCRIPTION_LINE, link: null }
  const APPLE = { line: APPLE_SUBSCRIPTION_LINE, link: APP_STORE_SUBSCRIPTIONS_URL }
  const billing = (source: 'apple' | 'stripe', expires_at: string | null = null) => ({
    source,
    expires_at,
    auto_renews: false,
  })
  it.each<[string, Partial<LocalEntitlement>, SubscriptionNote[]]>([
    ['a stripe account', { premium_source: 'stripe', paid_grants: [billing('stripe')] }, [STRIPE]],
    ['an apple account', { premium_source: 'apple', paid_grants: [billing('apple')] }, [APPLE]],
    [
      'a comp over both stores',
      { premium_source: 'comp', paid_grants: [billing('apple'), billing('stripe')] },
      [APPLE, STRIPE],
    ],
    [
      'a comp over a lapsed web subscription',
      { premium_source: 'comp', paid_grants: [billing('stripe', '2001-01-01T00:00:00.000Z')] },
      [],
    ],
    ['a comp', { premium_source: 'comp', paid_grants: [] }, []],
    ['a trial', { premium_source: 'trial', paid_grants: [] }, []],
    ['a free account', { paid_grants: [] }, []],
  ])('names every subscription for %s', async (_name, row, subscriptions) => {
    await db.entitlements.put(entitlementRow(row))
    const { result } = renderHook(
      () => ({ deletion: useDeleteAccount(true), plan: usePlanOrUnknown() }),
      { wrapper: dataProviders({ db }) },
    )
    await expect.poll(() => result.current.plan.kind).not.toBe('unknown')
    await expect.poll(() => result.current.deletion.loading).toBe(false)
    expect(result.current.deletion.subscriptions).toEqual(subscriptions)
  })

  it('shows the Apple line and its settings link in the sheet', async () => {
    await db.entitlements.put(entitlementRow({ premium_source: 'apple' }))
    const Providers = dataProviders({ db })
    renderWithProviders(
      <Providers>
        <DeleteAccountSheet open onClosed={() => {}} />
      </Providers>,
    )
    await expect.element(page.getByRole('dialog')).toHaveTextContent(APPLE_SUBSCRIPTION_LINE)
    const link = page.getByRole('link', { name: MANAGE_APP_STORE })
    await expect.element(link).toHaveAttribute('href', APP_STORE_SUBSCRIPTIONS_URL)
    await expect.element(link).toHaveAttribute('target', '_blank')
  })

  it('shows the Apple confirmation line only for an Apple account', async () => {
    clerk.user = { externalAccounts: [{ provider: 'apple' }] }
    apple.onOrigin = true
    const Providers = dataProviders({ db })
    renderWithProviders(
      <Providers>
        <DeleteAccountSheet open onClosed={() => {}} />
      </Providers>,
    )
    await expect.element(page.getByRole('dialog')).toHaveTextContent(APPLE_CONFIRM_LINE)
  })
})

describe('useDeleteAccount with an Apple account', () => {
  const appleAccount = { externalAccounts: [{ provider: 'apple' }] }

  function appleAuth(signIn: AppleIDAuth['signIn']): AppleIDAuth {
    // Echo the state back, as Apple does.
    let state = ''
    return {
      init: (config) => {
        state = config.state
      },
      signIn: async () => {
        const answer = await signIn()
        return { ...answer, authorization: { ...answer.authorization, state } }
      },
    }
  }

  /** Types the confirmation and presses delete once the Apple script has loaded or failed. */
  async function deleteWith(
    deleteAccount: (options?: { appleAuthorizationCode?: string }) => Promise<void>,
  ) {
    const { result } = renderHook(() => useDeleteAccount(true), {
      wrapper: dataProviders({ db, engine: fakeEngine({ deleteAccount }) }),
    })
    await expect.poll(() => result.current.loading).toBe(false)
    await expect.poll(() => result.current.appleReady).toBe(true)
    act(() => result.current.setText(DELETE_CONFIRMATION_TEXT))
    act(() => result.current.run())
    return result
  }

  // A refusal the server answered, so the run settles without erasing the test database.
  const refused = () =>
    vi.fn(async (_options?: { appleAuthorizationCode?: string }) =>
      Promise.reject(new ApiError(422, null)),
    )

  beforeEach(() => {
    clerk.user = appleAccount
    apple.onOrigin = true
  })

  it('confirms with Apple, then sends the code with the delete', async () => {
    apple.load = vi.fn(async () => appleAuth(async () => ({ authorization: { code: 'c1' } })))
    const deleteAccount = refused()
    const result = await deleteWith(deleteAccount)
    await expect.poll(() => deleteAccount.mock.calls.length).toBe(1)
    expect(deleteAccount).toHaveBeenCalledWith({ appleAuthorizationCode: 'c1' })
    await expect.poll(() => result.current.error).toBe(DELETE_FAILED)
  })

  it('stops the delete and keeps the sheet when the Apple popup is closed', async () => {
    const signIn = vi.fn(async () => Promise.reject({ error: 'popup_closed_by_user' }))
    apple.load = vi.fn(async () => appleAuth(signIn))
    const deleteAccount = refused()
    const result = await deleteWith(deleteAccount)
    await expect.poll(() => signIn.mock.calls.length).toBe(1)
    await expect.poll(() => result.current.pending).toBe(false)
    expect(deleteAccount).not.toHaveBeenCalled()
    expect(result.current.closing).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.text).toBe(DELETE_CONFIRMATION_TEXT)
  })

  it('deletes without a code when Apple fails', async () => {
    apple.load = vi.fn(async () =>
      appleAuth(async () => Promise.reject({ error: 'invalid_request' })),
    )
    const deleteAccount = refused()
    await deleteWith(deleteAccount)
    await expect.poll(() => deleteAccount.mock.calls.length).toBe(1)
    expect(deleteAccount).toHaveBeenCalledWith({})
  })

  it("deletes without a code when Apple's script fails to load", async () => {
    const deleteAccount = refused()
    await deleteWith(deleteAccount)
    await expect.poll(() => deleteAccount.mock.calls.length).toBe(1)
    expect(deleteAccount).toHaveBeenCalledWith({})
  })

  it.each([
    ['an account with no Apple connection', { externalAccounts: [{ provider: 'google' }] }, true],
    ['another origin', appleAccount, false],
  ])('never asks Apple for %s', async (_name, user, onOrigin) => {
    clerk.user = user
    apple.onOrigin = onOrigin
    const deleteAccount = refused()
    const result = await deleteWith(deleteAccount)
    await expect.poll(() => deleteAccount.mock.calls.length).toBe(1)
    expect(deleteAccount).toHaveBeenCalledWith({})
    expect(apple.load).not.toHaveBeenCalled()
    expect(result.current.showsAppleLine).toBe(false)
  })
})
