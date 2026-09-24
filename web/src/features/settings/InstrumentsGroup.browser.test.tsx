import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { INSTRUMENTS } from '../../api/vocabulary'
import { setInstruments, settingsId, toggleInstrumentSetting } from '../../commands/settings'
import { INSTRUMENT_LABELS } from '../../constants'
import { pendingBatch } from '../../db/outbox'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { NOT_SET } from '../../ui/FieldRow'
import { INSTRUMENTS_HELP, TUNING_FIELDS } from './instruments'
import { InstrumentsGroup } from './InstrumentsGroup'

// Mirrors the filter InstrumentRows itself applies inside the sheet.
const LISTED = INSTRUMENTS.filter((instrument) =>
  Object.values(TUNING_FIELDS).some((field) => field.instrument === instrument),
)

vi.mock('../../commands/settings', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const show = () => renderIonic(<InstrumentsGroup />, { db })

const row = () => page.getByRole('button', { name: /^Instruments/ })
/** The row's whole name: the label the header lends it, then the set it holds. */
const rowNamed = (value: string) =>
  page.getByRole('button', { name: new RegExp(`^Instruments\\s+${value}$`) })
const box = (name: string) => page.getByRole('checkbox', { name })
const stored = async () => (await db.user_settings.get(settingsId('user_1')))?.instruments

const openSheet = async () => {
  await row().click()
  await expect.element(box('Violin')).toBeVisible()
}

const closeSheet = async () => {
  await page.getByRole('button', { name: 'Done' }).click()
  await vi.waitFor(() =>
    expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull(),
  )
}

describe('InstrumentsGroup', () => {
  it('names the group, its instruments, and what the choice changes', async () => {
    await setInstruments(db, 'user_1', ['violin', 'five_string_banjo'])
    show()
    await expect.element(page.getByRole('heading', { name: 'Instruments', level: 2 })).toBeVisible()
    await expect.element(rowNamed('Violin, 5-string banjo')).toBeVisible()
    await expect.element(page.getByText(INSTRUMENTS_HELP)).toBeVisible()
  })

  it('lists the instruments in one order however they were stored', async () => {
    await setInstruments(db, 'user_1', ['five_string_banjo', 'violin'])
    show()
    await expect.element(rowNamed('Violin, 5-string banjo')).toBeVisible()
  })

  it('reads Not set when no instrument is chosen', async () => {
    await setInstruments(db, 'user_1', [])
    show()
    await expect.element(rowNamed(NOT_SET)).toBeVisible()
  })

  it('keeps the checkboxes in the sheet until the row is opened', async () => {
    await setInstruments(db, 'user_1', ['violin'])
    show()
    await expect.element(row()).toBeVisible()
    expect(page.getByRole('checkbox').elements()).toHaveLength(0)

    await openSheet()
    await expect.element(box('Violin')).toBeChecked()
    await expect.element(box('5-string banjo')).not.toBeChecked()
  })

  it('adds an instrument from the sheet and queues one settings change', async () => {
    await setInstruments(db, 'user_1', ['violin'])
    // The seeding write leaves its own outbox entry, so only what the tap adds is counted.
    await db.outbox.clear()
    show()
    await openSheet()
    await box('5-string banjo').click()
    await expect.poll(stored).toEqual(['violin', 'five_string_banjo'])
    await expect.element(box('5-string banjo')).toBeChecked()
    expect((await pendingBatch(db, 10)).map((entry) => entry.table)).toEqual(['user_settings'])

    // The row it was opened from follows the set it holds now.
    await closeSheet()
    await expect.element(rowNamed('Violin, 5-string banjo')).toBeVisible()
  })

  it('stays away entirely while the settings row is still being read', () => {
    show()
    expect(page.getByRole('heading', { name: 'Instruments' }).elements()).toHaveLength(0)
    expect(page.getByRole('checkbox').elements()).toHaveLength(0)
  })

  it('reports a refused toggle in the sheet, then under the row it was made from', async () => {
    vi.mocked(toggleInstrumentSetting).mockRejectedValue(new Error('Settings are read-only'))
    show()
    await openSheet()
    await box('5-string banjo').click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Settings are read-only')

    await closeSheet()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Settings are read-only')
    expect(page.getByText(INSTRUMENTS_HELP).elements()).toHaveLength(0)
  })

  it('drops a refusal from the last visit when the sheet opens again', async () => {
    vi.mocked(toggleInstrumentSetting).mockRejectedValue(new Error('Settings are read-only'))
    show()
    await openSheet()
    await box('5-string banjo').click()
    await expect.element(page.getByRole('alert')).toBeVisible()
    await closeSheet()

    await openSheet()
    expect(page.getByRole('alert').elements()).toHaveLength(0)
    await closeSheet()
    await expect.element(page.getByText(INSTRUMENTS_HELP)).toBeVisible()
  })

  it('gives the row and every checkbox a tap target a finger can hit', async () => {
    show()
    await openSheet()
    await expect.element(box(INSTRUMENT_LABELS[LISTED[LISTED.length - 1]!])).toBeVisible()
    for (const item of document.querySelectorAll('ion-item')) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })
})
