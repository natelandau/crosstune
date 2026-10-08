import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine } from '../../test/providers'
import { DELETE_CONFIRMATION_TEXT, DELETE_FAILED, SETTINGS_LINE } from './deleteAccountCopy'
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
})
