import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine } from '../../test/providers'
import { page } from 'vitest/browser'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { renderWithProviders } from '../../test/render'
import { APP_STORE_SUBSCRIPTIONS_URL, MANAGE_APP_STORE } from '../plan/planCopy'
import { DeleteAccountSheet } from './pages/DeleteAccountSheet'
import { entitlementRow } from '../../test/rows'
import {
  APPLE_SUBSCRIPTION_LINE,
  DELETE_CONFIRMATION_TEXT,
  DELETE_FAILED,
  SETTINGS_LINE,
  STRIPE_SUBSCRIPTION_LINE,
} from './deleteAccountCopy'
import { useDeleteAccount } from './useDeleteAccount'

const clerk = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }))

vi.mock('@clerk/react', () => ({ useAuth: () => ({ signOut: clerk.signOut }) }))

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
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

  it.each([
    ['stripe', STRIPE_SUBSCRIPTION_LINE, null],
    ['apple', APPLE_SUBSCRIPTION_LINE, APP_STORE_SUBSCRIPTIONS_URL],
    ['comp', null, null],
    ['trial', null, null],
    [null, null, null],
  ] as const)('names the subscription for a %s account', async (source, line, link) => {
    await db.entitlements.put(entitlementRow({ premium_source: source }))
    const { result } = renderHook(
      () => ({ deletion: useDeleteAccount(true), plan: usePlanOrUnknown() }),
      { wrapper: dataProviders({ db }) },
    )
    await expect.poll(() => result.current.plan.kind).not.toBe('unknown')
    await expect.poll(() => result.current.deletion.loading).toBe(false)
    expect(result.current.deletion.subscriptionLine).toBe(line)
    expect(result.current.deletion.subscriptionLink).toBe(link)
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
})
