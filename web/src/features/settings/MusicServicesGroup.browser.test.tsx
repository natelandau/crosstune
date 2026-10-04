import { beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { settingsId } from '../../commands/settings'
import { PROVIDER_LABELS } from '../../constants'
import { pendingBatch } from '../../db/outbox'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { openPickerRow } from '../../test/dialogs'
import { renderIonic } from '../../test/ionic'
import { MusicServicesGroup } from './MusicServicesGroup'
import { PLAY_FIRST_LABEL, PLAY_FIRST_LABELS } from './playFirst'
import { MUSIC_SERVICES, NO_SERVICES, SEARCHABLE_PROVIDERS } from './searchProviders'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
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
  it('counts all eight services by default', async () => {
    show()
    await expect
      .element(page.getByRole('button', { name: `${MUSIC_SERVICES} 8 of 8`, exact: true }))
      .toBeVisible()
  })

  it('offers one checkbox per searchable service and no generic link', async () => {
    show()
    await openSheet()
    await expect.poll(() => page.getByRole('checkbox').elements()).toHaveLength(8)
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
      .element(page.getByRole('button', { name: `${MUSIC_SERVICES} 7 of 8`, exact: true }))
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

  it('chooses Apple Music to play first', async () => {
    show()
    await openPickerRow(`${PLAY_FIRST_LABEL}, ${PLAY_FIRST_LABELS.recordings}`)
    await page.getByRole('radio', { name: PLAY_FIRST_LABELS.apple_music }).click()
    await expect
      .poll(async () => (await db.user_settings.get(settingsId('user_1')))?.play_first)
      .toBe('apple_music')
    await expect
      .poll(async () => (await pendingBatch(db, 10)).map((entry) => entry.table))
      .toEqual(['user_settings'])
  })
})
