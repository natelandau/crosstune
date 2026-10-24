import { page, userEvent, type Locator } from 'vitest/browser'
import { expect, it } from 'vitest'
import { createTune, deleteTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { DAY_LABEL, MONTH_LABEL, MONTH_LABELS, YEAR_FORMAT, YEAR_LABEL } from '../../ui/partialDate'
import { ADD_PART_MODE, DETAIL_LABELS, PART_MODE_LABELS } from './detailFields'
import { EDIT_TUNE_TITLE, SAVE_TUNE, TITLE_FIELD } from './tuneFormCopy'
import { LEARNED_ON_INCOMPLETE } from './tuneFormValues'
import { ADD_LYRICS, ADD_TO_TUNE, EDIT_ALL_DETAILS, LYRICS_SECTION } from './tuneScreenCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { openTestDb } from '../../test/db'
import { CANCEL } from '../../ui/confirmCopy'
import { renderApp } from '../../test/renderApp'
import { seen } from '../../test/events'

const PHONE = { width: 390, height: 844 }

const sheet = (name: string) => page.getByRole('dialog', { name })
const titleField = (name = EDIT_TUNE_TITLE) =>
  sheet(name).getByRole('textbox', { name: TITLE_FIELD })
const primary = (name: string, label: string) =>
  sheet(name).getByRole('button', { name: label, exact: true })

/** Clicks the backdrop near the top of the window, clear of a sheet or a centered dialog. */
async function clickBackdrop(): Promise<void> {
  const scrim = document.querySelector('[data-sheet-scrim]')
  if (!scrim) throw new Error('no sheet scrim')
  await userEvent.click(page.elementLocator(scrim), { position: { x: 20, y: 10 } })
}

async function editTune(
  db: CrosstuneDb,
  tune: Parameters<typeof createTune>[1],
  density: 'pointer' | 'touch' = 'pointer',
) {
  const { tuneId } = await createTune(db, tune, { status: 'learning' })
  const app = await renderApp({ path: `/catalog/${tuneId}`, db, frame: PHONE, density })
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: EDIT_ALL_DETAILS }).click()
  await expect.element(titleField(EDIT_TUNE_TITLE)).toHaveValue(tune.title)
  return { ...app, tuneId }
}

it('keeps typed work through Escape and a backdrop tap, and Cancel discards it', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Forked Deer' })
  await titleField().fill('Forked Deer Reel')

  const escapes = seen('keyup', (event) => (event as KeyboardEvent).key === 'Escape')
  await userEvent.keyboard('{Escape}')
  await expect.poll(escapes).toBe(1)
  const clicks = seen('click')
  await clickBackdrop()
  await expect.poll(clicks).toBe(1)
  await expect.element(titleField()).toHaveValue('Forked Deer Reel')

  await sheet(EDIT_TUNE_TITLE).getByRole('button', { name: CANCEL }).click()
  await expect.element(sheet(EDIT_TUNE_TITLE)).not.toBeInTheDocument()
  expect((await db.tunes.get(tuneId))?.title).toBe('Forked Deer')
})

it('closes on Escape while it holds no typed work', async () => {
  const db = openTestDb()
  await editTune(db, { title: 'Forked Deer' })
  await userEvent.keyboard('{Escape}')
  await expect.element(sheet(EDIT_TUNE_TITLE)).not.toBeInTheDocument()
})

it('takes a value typed straight into an open vocabulary', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Old Joe Clark', tune_type: 'reel' })
  const form = sheet(EDIT_TUNE_TITLE)
  const type = form.getByRole('combobox', { name: DETAIL_LABELS.tune_type })
  await expect.element(type).toHaveValue('reel')
  await type.fill('slip reel')
  await expect.element(type).toHaveValue('slip reel')
  await primary(EDIT_TUNE_TITLE, SAVE_TUNE).click()
  await expect.element(form).not.toBeInTheDocument()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.tune_type).toBe('slip reel')
})

it('empties an open vocabulary when its text is deleted', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Old Joe Clark', tune_type: 'reel' })
  const form = sheet(EDIT_TUNE_TITLE)
  const type = form.getByRole('combobox', { name: DETAIL_LABELS.tune_type })
  await type.clear()
  await expect.element(type).toHaveValue('')
  await primary(EDIT_TUNE_TITLE, SAVE_TUNE).click()
  await expect.element(form).not.toBeInTheDocument()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.tune_type).toBeNull()
})

it('takes lyrics in their own field and saves them with the tune', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Cluck Old Hen' })
  const form = sheet(EDIT_TUNE_TITLE)
  // Lyrics are a field of their own, not a row in Details that opens another sheet.
  await expect
    .element(form.getByRole('button', { name: LYRICS_SECTION, exact: true }))
    .not.toBeInTheDocument()
  await form.getByRole('textbox', { name: LYRICS_SECTION }).fill('My old hen\nShe’s a good old hen')
  await primary(EDIT_TUNE_TITLE, SAVE_TUNE).click()
  await expect.element(form).not.toBeInTheDocument()
  await expect
    .poll(async () => (await db.tunes.get(tuneId))?.lyrics)
    .toBe('My old hen\nShe’s a good old hen')
})

it('shows an empty suggested field empty, and takes typing with no pick', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Cluck Old Hen' })
  const form = sheet(EDIT_TUNE_TITLE)
  const composer = form.getByRole('combobox', { name: DETAIL_LABELS.composer })
  await expect.element(composer).toHaveValue('')
  await composer.click()
  await userEvent.keyboard('Ed Haley')
  await expect.element(composer).toHaveValue('Ed Haley')
  await userEvent.keyboard('{Tab}')
  await primary(EDIT_TUNE_TITLE, SAVE_TUNE).click()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.composer).toBe('Ed Haley')
})

it('saves a mode picked for the tune and one for its B part', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Cluck Old Hen' })
  const form = sheet(EDIT_TUNE_TITLE)
  await form.getByRole('button', { name: new RegExp(`${PART_MODE_LABELS[0]}$`) }).click()
  await page.getByRole('option', { name: 'dorian' }).click()
  await form.getByRole('button', { name: ADD_PART_MODE }).click()
  await form.getByRole('button', { name: new RegExp(PART_MODE_LABELS[1]) }).click()
  await page.getByRole('option', { name: 'major' }).click()
  await primary(EDIT_TUNE_TITLE, SAVE_TUNE).click()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.modes).toEqual(['dorian', 'major'])
})

it('refuses a learned-on year that is not four digits once the date is left', async () => {
  const db = openTestDb()
  await editTune(db, { title: 'Angeline the Baker' })
  const form = sheet(EDIT_TUNE_TITLE)
  const year = form.getByRole('textbox', { name: YEAR_LABEL })
  await year.fill('19')
  await expect.element(primary(EDIT_TUNE_TITLE, SAVE_TUNE)).toBeDisabled()
  // A phone's number pad has no Enter, so leaving the date is what shows the reason.
  await titleField(EDIT_TUNE_TITLE).click()
  await expect.element(form.getByRole('alert')).toHaveTextContent(YEAR_FORMAT)
  await expect.element(year).toHaveAttribute('aria-invalid', 'true')
  await year.fill('2019')
  await expect.element(form.getByRole('alert')).not.toBeInTheDocument()
  await expect.element(year).not.toHaveAttribute('aria-invalid', 'true')
})

/** The danger ring a refused picker row draws, or none. The row holds the trigger. */
const ring = (trigger: Locator) => getComputedStyle(trigger.element().parentElement!).boxShadow

it('saves learned on only as a whole date, asking for the part left out', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Angeline the Baker' })
  const form = sheet(EDIT_TUNE_TITLE)
  const month = form.getByRole('button', { name: new RegExp(`${MONTH_LABEL}$`) })
  const day = form.getByRole('button', { name: new RegExp(`${DAY_LABEL}$`) })
  await form.getByRole('textbox', { name: YEAR_LABEL }).fill('2019')
  await titleField(EDIT_TUNE_TITLE).click()
  await expect.element(form.getByRole('alert')).toHaveTextContent(LEARNED_ON_INCOMPLETE)
  await expect.element(month).toHaveAccessibleDescription(LEARNED_ON_INCOMPLETE)
  await expect.poll(() => ring(month)).not.toBe('none')
  expect(ring(day)).toBe('none')

  await month.click()
  await page.getByRole('option', { name: MONTH_LABELS[2] }).click()
  await expect.element(form.getByRole('alert')).not.toBeInTheDocument()
  await titleField(EDIT_TUNE_TITLE).click()
  await userEvent.keyboard('{Enter}')
  await expect.element(form.getByRole('alert')).toHaveTextContent(LEARNED_ON_INCOMPLETE)
  await expect.element(day).toHaveFocus()
  await expect.element(day).toHaveAccessibleDescription(LEARNED_ON_INCOMPLETE)
  await expect.poll(() => ring(day)).not.toBe('none')
  expect(ring(month)).toBe('none')

  await day.click()
  await page.getByRole('option', { name: '14', exact: true }).click()
  await primary(EDIT_TUNE_TITLE, SAVE_TUNE).click()
  await expect.element(form).not.toBeInTheDocument()
  const userTune = () => db.user_tunes.where('tune_id').equals(tuneId).first()
  await expect.poll(async () => (await userTune())?.learned_on).toBe('2019-03-14')
})

it("waits on touch while the date's own picker is open", async () => {
  const db = openTestDb()
  await editTune(db, { title: 'Angeline the Baker' }, 'touch')
  const form = sheet(EDIT_TUNE_TITLE)
  await form.getByRole('textbox', { name: YEAR_LABEL }).fill('2019')
  const month = form.getByRole('button', { name: new RegExp(MONTH_LABEL) })
  // Opened from the keyboard, because the menu focuses whichever item opens under the pointer.
  month.element().focus()
  await userEvent.keyboard('{Enter}')
  const months = page.getByRole('dialog', { name: MONTH_LABEL })
  // Focus has left the date for the picker once a choice holds it, so a refusal of the
  // date would already show.
  await expect.element(months.getByRole('menuitemradio').first()).toHaveFocus()
  expect(form.getByRole('alert').elements()).toHaveLength(0)
  await months.getByRole('menuitemradio', { name: MONTH_LABELS[2] }).click()
  await expect.element(month).toHaveFocus()
  await expect.element(month).toHaveTextContent(MONTH_LABELS[2]!)
  expect(form.getByRole('alert').elements()).toHaveLength(0)
})

it('closes an edit when its tune is deleted elsewhere', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Soldier’s Joy' })
  await deleteTune(db, tuneId)
  await expect.element(sheet(EDIT_TUNE_TITLE)).not.toBeInTheDocument()
})

it('+ Lyrics opens the form with the lyrics field focused', async () => {
  const db = openTestDb()
  const { tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })
  await renderApp({ path: `/catalog/${tuneId}`, db, frame: PHONE })
  await page
    .getByRole('group', { name: ADD_TO_TUNE })
    .getByRole('button', { name: ADD_LYRICS })
    .click()
  await expect
    .element(sheet(EDIT_TUNE_TITLE).getByRole('textbox', { name: LYRICS_SECTION }))
    .toHaveFocus()
})
