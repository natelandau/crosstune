import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { APP_VERSION } from '../../version'
import { SettingsPage } from './SettingsPage'

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: vi.fn(async () => {}) }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'nate@example.com' } } }),
}))

/** Every group the screen lays out, in order. Each later group lands at its own position here. */
const GROUPS = ['Account', 'Instruments', 'Appearance', 'Recording', 'Sync', 'About']

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const show = () => renderScreen(<SettingsPage />, { db, path: '/settings', route: '/settings' })

describe('SettingsPage', () => {
  it('titles the screen and carries one level 1 heading', async () => {
    show()
    await expect.element(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    await expect.poll(() => document.querySelector('ion-title')?.textContent).toBe('Settings')
  })

  it('lays its groups out in order', async () => {
    show()
    // Instruments arrives with the settings row, so waiting on it waits on the whole screen.
    await expect.element(page.getByRole('heading', { name: 'Instruments', level: 2 })).toBeVisible()
    expect(
      page
        .getByRole('heading', { level: 2 })
        .elements()
        .map((heading) => heading.textContent),
    ).toEqual(GROUPS)
  })

  it('names the running version under About', async () => {
    show()
    const about = page.getByText(`Crosstune ${APP_VERSION}`)
    await expect.element(about).toBeVisible()
    expect(APP_VERSION).not.toBe('')
  })
})
