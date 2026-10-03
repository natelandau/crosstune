import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { settingsId } from '../../commands/settings'
import { PROVIDER_LABELS } from '../../constants'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { MusicServicesGroup } from './MusicServicesGroup'
import { MUSIC_SERVICES, NO_SERVICES, SEARCHABLE_PROVIDERS } from './searchProviders'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const show = () => renderIonic(<MusicServicesGroup />, { db })

const row = () => page.getByRole('button', { name: new RegExp(`^${MUSIC_SERVICES}`) })
const box = (name: string) => page.getByRole('checkbox', { name, exact: true })
const stored = async () => (await db.user_settings.get(settingsId('user_1')))?.search_providers

const openSheet = async () => {
  await row().click()
  await expect.element(box('TIDAL')).toBeVisible()
}

describe('MusicServicesGroup', () => {
  it('counts all seven services by default', async () => {
    show()
    await expect
      .element(page.getByRole('button', { name: `${MUSIC_SERVICES} 7 of 7`, exact: true }))
      .toBeVisible()
  })

  it('offers one checkbox per searchable service and no generic link', async () => {
    show()
    await openSheet()
    expect(page.getByRole('checkbox').elements()).toHaveLength(7)
    for (const provider of SEARCHABLE_PROVIDERS) {
      await expect.element(box(PROVIDER_LABELS[provider])).toBeChecked()
    }
    expect(page.getByRole('checkbox', { name: 'Link', exact: true }).elements()).toHaveLength(0)
  })

  it('stores an unchecked service', async () => {
    show()
    await openSheet()
    await box('TIDAL').click()
    await expect.poll(stored).toEqual(SEARCHABLE_PROVIDERS.filter((p) => p !== 'tidal'))
    await expect.element(box('TIDAL')).not.toBeChecked()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect
      .element(page.getByRole('button', { name: `${MUSIC_SERVICES} 6 of 7`, exact: true }))
      .toBeVisible()
  })

  it('reads No services selected when every service is off', async () => {
    show()
    await openSheet()
    for (const provider of SEARCHABLE_PROVIDERS) {
      await box(PROVIDER_LABELS[provider]).click()
      await expect.poll(async () => (await stored())?.includes(provider)).toBe(false)
    }
    await page.getByRole('button', { name: 'Done' }).click()
    await expect
      .element(page.getByRole('button', { name: `${MUSIC_SERVICES} ${NO_SERVICES}`, exact: true }))
      .toBeVisible()
  })
})
