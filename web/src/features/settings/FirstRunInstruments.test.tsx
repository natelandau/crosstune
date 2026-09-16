import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setInstruments, settingsId } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { fakeEngine, renderWithProviders, testSession } from '../../test/render'
import { FIRST_RUN_GRACE_MS, FIRST_RUN_TITLE, FirstRunInstruments } from './FirstRunInstruments'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const synced = () => fakeEngine({ lastSyncedAt: () => '2026-09-16T12:00:00.000Z' })
// A closed dialog is out of the accessibility tree, so an unopened prompt is simply absent.
const prompt = () => screen.queryByRole('dialog', { name: FIRST_RUN_TITLE })
const settled = () => new Promise((resolve) => setTimeout(resolve, FIRST_RUN_GRACE_MS + 100))

describe('FirstRunInstruments', () => {
  it('asks after the first sync finds no settings row, and saves the answer', async () => {
    renderWithProviders(<FirstRunInstruments />, { db, engine: synced() })
    const dialog = await screen.findByRole('dialog', { name: FIRST_RUN_TITLE })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Banjo' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Guitar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(async () =>
      expect((await db.user_settings.get(settingsId('user_1')))?.instruments).toEqual([
        'banjo',
        'guitar',
      ]),
    )
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'))
  })

  it('saves an empty answer when nothing is checked', async () => {
    renderWithProviders(<FirstRunInstruments />, { db, engine: synced() })
    await screen.findByRole('dialog', { name: FIRST_RUN_TITLE })
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(async () =>
      expect((await db.user_settings.get(settingsId('user_1')))?.instruments).toEqual([]),
    )
  })

  it('stays quiet when the user already has a settings row', async () => {
    await setInstruments(db, 'user_1', ['violin'])
    renderWithProviders(<FirstRunInstruments />, { db, engine: synced() })
    await settled()
    expect(prompt()).toBeNull()
  })

  it('stays quiet until a sync has run, since a new device has no row before its first pull', async () => {
    renderWithProviders(<FirstRunInstruments />, { db, engine: fakeEngine() })
    await settled()
    expect(prompt()).toBeNull()
  })

  it('stays quiet in an offline session', async () => {
    renderWithProviders(<FirstRunInstruments />, {
      db,
      engine: synced(),
      session: { ...testSession, getToken: async () => null, offline: true },
    })
    await settled()
    expect(prompt()).toBeNull()
  })
})
