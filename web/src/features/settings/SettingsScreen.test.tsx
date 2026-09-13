import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsId } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { countInvalidChanges } from '../../db/meta'
import { pendingBatch } from '../../db/outbox'
import { openTestDb } from '../../test/db'
import { fakeEngine, renderWithProviders, testSession } from '../../test/render'
import { SettingsScreen } from './SettingsScreen'
import * as signOutModule from './signOut'

const clerkSignOut = vi.fn(async () => {})
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: clerkSignOut }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'nate@example.com' } } }),
}))

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

describe('SettingsScreen', () => {
  it('shows the account email and signs out through signOutAndForget', async () => {
    const spy = vi.spyOn(signOutModule, 'signOutAndForget').mockResolvedValue()
    const sync = vi.fn(async () => {})
    const engine = fakeEngine({ sync })
    renderWithProviders(<SettingsScreen />, { db, engine })
    expect(await screen.findByText('nate@example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(sync).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ db, userId: 'user_1', engine }))
  })

  it('tells the user how many changes the server rejected', async () => {
    await countInvalidChanges(db, 2)
    renderWithProviders(<SettingsScreen />, { db })
    expect(await screen.findByText(/2 changes were rejected/)).toBeInTheDocument()
  })

  it('shows an error and re-enables sign out when it fails', async () => {
    vi.spyOn(signOutModule, 'signOutAndForget').mockRejectedValue(new Error('Clerk unreachable'))
    renderWithProviders(<SettingsScreen />, { db })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Clerk unreachable')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  })

  it('disables sign out while the session is offline', async () => {
    renderWithProviders(<SettingsScreen />, {
      db,
      session: { ...testSession, getToken: async () => null, offline: true },
    })
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeDisabled()
  })

  it('records the instruments the user plays', async () => {
    renderWithProviders(<SettingsScreen />, { db })
    const violin = await screen.findByRole('checkbox', { name: 'Violin' })
    expect(violin).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Banjo' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Banjo' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Banjo' })).toBeChecked())
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['violin', 'banjo'])
    const batch = await pendingBatch(db, 10)
    expect(batch.map((e) => e.table)).toEqual(['user_settings'])
  })
})
