import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storeDownloadedBlob } from '../../commands/recordings'
import { settingsId } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { countInvalidChanges, getKeepOffline } from '../../db/meta'
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

  it('names the sync and recording transfer states', async () => {
    renderWithProviders(<SettingsScreen />, {
      db,
      engine: fakeEngine({ status: () => 'error', transferStatus: () => 'transferring' }),
    })
    expect(await screen.findByText('Status: Sync failed')).toBeInTheDocument()
    expect(screen.getByText('Recordings: Transferring')).toBeInTheDocument()
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

  it('sets the theme and text size on the document and keeps them for next time', async () => {
    renderWithProviders(<SettingsScreen />, { db })
    const root = document.documentElement
    expect(await screen.findByRole('radio', { name: 'System' })).toBeChecked()
    expect(root.hasAttribute('data-theme')).toBe(false)
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('crosstune.appearance')).toBe('dark')

    const slider = screen.getByRole('slider', { name: 'Text size' })
    expect(slider).toHaveValue('1')
    expect(slider).toHaveAttribute('aria-valuetext', 'Regular')
    fireEvent.change(slider, { target: { value: '2' } })
    expect(slider).toHaveAttribute('aria-valuetext', 'Roomy')
    expect(root.getAttribute('data-text-size')).toBe('roomy')
    expect(localStorage.getItem('crosstune.textSize')).toBe('roomy')
    fireEvent.change(slider, { target: { value: '1' } })
    expect(root.hasAttribute('data-text-size')).toBe(false)

    await userEvent.click(screen.getByRole('radio', { name: 'System' }))
    expect(root.hasAttribute('data-theme')).toBe(false)
    localStorage.clear()
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

  it('sets the recording quality and clears downloaded audio', async () => {
    const at = '2026-09-14T20:00:00.000Z'
    await storeDownloadedBlob(db, 'r1', new Blob(['12345']), 'audio/mp4')
    // clearDownloadedBlobs only drops a blob the server can serve back; the row must be ready.
    await db.recordings.put({
      id: 'r1',
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 1,
      song_id: null,
      label: null,
      source: 'microphone',
      recorded_at: at,
      position: 0,
      state: 'ready',
      duration_ms: 1000,
      playback_mime: 'audio/mp4',
      playback_bytes: 5,
      error: null,
    })
    renderWithProviders(<SettingsScreen />, { db })
    await userEvent.click(await screen.findByRole('radio', { name: 'High' }))
    await waitFor(async () =>
      expect((await db.user_settings.get(settingsId('user_1')))?.audio_quality).toBe('high'),
    )
    expect(screen.getByText('5 B of audio on this device')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove downloaded audio' }))
    await waitFor(async () => expect((await db.recording_files.get('r1'))?.blob).toBeNull())
    expect(await screen.findByText('0 B of audio on this device')).toBeInTheDocument()
  })

  it('keeps every recording offline from one setting and starts a transfer', async () => {
    const transfer = vi.fn(async () => {})
    renderWithProviders(<SettingsScreen />, { db, engine: fakeEngine({ transfer }) })
    const name = 'Download all recordings to this device'
    expect(await screen.findByRole('checkbox', { name })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Remove downloaded audio' })).toBeEnabled()
    await userEvent.click(screen.getByRole('checkbox', { name }))
    await waitFor(async () => expect(await getKeepOffline(db)).toBe(true))
    await waitFor(() => expect(transfer).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('checkbox', { name })).toBeChecked())
    // Removing downloads while every recording is kept offline would only re-download them.
    expect(screen.getByRole('button', { name: 'Remove downloaded audio' })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name }))
    await waitFor(async () => expect(await getKeepOffline(db)).toBe(false))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove downloaded audio' })).toBeEnabled(),
    )
  })
})
