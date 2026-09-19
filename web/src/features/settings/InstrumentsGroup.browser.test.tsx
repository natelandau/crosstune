import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { setInstruments, settingsId, toggleInstrumentSetting } from '../../commands/settings'
import { pendingBatch } from '../../db/outbox'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { InstrumentsGroup } from './InstrumentsGroup'

vi.mock('../../commands/settings', { spy: true })

const HELP = 'Tuning fields appear only for the instruments you play.'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const show = () => renderIonic(<InstrumentsGroup />, { db })

const box = (name: string) => page.getByRole('checkbox', { name })
const stored = async () => (await db.user_settings.get(settingsId('user_1')))?.instruments

describe('InstrumentsGroup', () => {
  it('checks the instruments the stored row holds and leaves the rest clear', async () => {
    await setInstruments(db, 'user_1', ['violin'])
    show()
    await expect.element(box('Violin')).toBeChecked()
    await expect.element(box('Banjo')).not.toBeChecked()
  })

  it('adds an instrument to the row and queues one settings change', async () => {
    await setInstruments(db, 'user_1', ['violin'])
    // The seeding write leaves its own outbox entry, so only what the tap adds is counted.
    await db.outbox.clear()
    show()
    await expect.element(box('Violin')).toBeChecked()
    await box('Banjo').click()
    await expect.poll(stored).toEqual(['violin', 'banjo'])
    await expect.element(box('Banjo')).toBeChecked()
    expect((await pendingBatch(db, 10)).map((entry) => entry.table)).toEqual(['user_settings'])
  })

  it('names the group and says what the choice changes', async () => {
    show()
    await expect.element(page.getByRole('heading', { name: 'Instruments', level: 2 })).toBeVisible()
    await expect.element(page.getByText(HELP)).toBeVisible()
  })

  it('stays away entirely while the settings row is still being read', () => {
    show()
    expect(page.getByRole('heading', { name: 'Instruments' }).elements()).toHaveLength(0)
    expect(page.getByRole('checkbox').elements()).toHaveLength(0)
  })

  it('shows a refused toggle in the group, in place of the help text', async () => {
    vi.mocked(toggleInstrumentSetting).mockRejectedValue(new Error('Settings are read-only'))
    show()
    await expect.element(box('Banjo')).toBeVisible()
    await box('Banjo').click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Settings are read-only')
    expect(page.getByText(HELP).elements()).toHaveLength(0)
  })

  it('gives every row a tap target a finger can hit', async () => {
    show()
    await expect.element(box('Other')).toBeVisible()
    for (const item of document.querySelectorAll('ion-item')) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })
})
