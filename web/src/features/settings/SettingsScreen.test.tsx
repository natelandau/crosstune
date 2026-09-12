import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthContext'
import type { CrosstuneDb } from '../../db/schema'
import { countInvalidChanges } from '../../db/meta'
import { openTestDb } from '../../test/db'
import { fakeEngine, renderWithProviders } from '../../test/render'
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
    renderWithProviders(
      <AuthProvider value={{ userId: 'user_1', getToken: async () => 't', offline: false }}>
        <SettingsScreen />
      </AuthProvider>,
      { db, engine },
    )
    expect(await screen.findByText('nate@example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(sync).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ db, userId: 'user_1', engine }))
  })

  it('tells the user how many changes the server rejected', async () => {
    await countInvalidChanges(db, 2)
    renderWithProviders(
      <AuthProvider value={{ userId: 'user_1', getToken: async () => 't', offline: false }}>
        <SettingsScreen />
      </AuthProvider>,
      { db },
    )
    expect(await screen.findByText(/2 changes were rejected/)).toBeInTheDocument()
  })

  it('shows an error and re-enables sign out when it fails', async () => {
    vi.spyOn(signOutModule, 'signOutAndForget').mockRejectedValue(new Error('Clerk unreachable'))
    renderWithProviders(
      <AuthProvider value={{ userId: 'user_1', getToken: async () => 't', offline: false }}>
        <SettingsScreen />
      </AuthProvider>,
      { db },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Clerk unreachable')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  })

  it('disables sign out while the session is offline', async () => {
    renderWithProviders(
      <AuthProvider value={{ userId: 'user_1', getToken: async () => null, offline: true }}>
        <SettingsScreen />
      </AuthProvider>,
      { db },
    )
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeDisabled()
  })
})
