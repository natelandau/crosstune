import { page, userEvent, type Locator } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { listTunePath, tuneHomePath } from '../../app/tuneHome'
import { createList } from '../../commands/lists'
import type * as tunes from '../../commands/tunes'
import { createTune, deleteTune } from '../../commands/tunes'
import { LIST_NOT_FOUND } from '../../commands/messages'
import { STATUS_LABELS } from '../../constants'
import type { CrosstuneDb } from '../../db/schema'
import { ADD_TUNE, SEARCH_TUNES, addOfferLabel } from '../catalog/catalogCopy'
import { DAY_LABEL, MONTH_LABEL, MONTH_LABELS, YEAR_FORMAT, YEAR_LABEL } from '../../ui/partialDate'
import { ADD_PART_MODE, DETAIL_LABELS, PART_MODE_LABELS } from './detailFields'
import { OTHER_OPTION, otherLabel } from './suggestCopy'
import {
  ADD_NEW_TUNE,
  EDIT_TUNE_TITLE,
  NEW_TUNE_TITLE,
  SAVE_TUNE,
  STATUS_HEADER,
  TITLE_FIELD,
} from './tuneFormCopy'
import { LEARNED_ON_INCOMPLETE, TITLE_REQUIRED } from './tuneFormValues'
import { EDIT_TUNE, LYRICS_SECTION } from './tuneScreenCopy'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { CANCEL, DONE } from '../../ui/confirmCopy'
import { NOT_SET } from '../../ui/fieldCopy'
import { spokenKey } from '../../ui/keyName'
import { renderApp } from '../../test/renderApp'
import { renderWithProviders } from '../../test/render'
import { Button } from '../../ui/Button'
import { useTuneFormLauncher, type TuneFormOptions } from './formLauncher'
import { TuneFormProvider } from './TuneFormProvider'
import { TuneFormSheet } from './TuneFormSheet'
import { seen } from '../../test/events'

// A passthrough one test holds open, to cancel the form while its save is running.
vi.mock('../../commands/tunes', async (original) => {
  const actual = await original<typeof tunes>()
  return { ...actual, createTune: vi.fn(actual.createTune) }
})

const PHONE = { width: 390, height: 844 }

const path = (router: { state: { location: { pathname: string } } }) => () =>
  router.state.location.pathname

const sheet = (name: string) => page.getByRole('dialog', { name })
const titleField = (name = NEW_TUNE_TITLE) =>
  sheet(name).getByRole('textbox', { name: TITLE_FIELD })
const primary = (name: string, label: string) =>
  sheet(name).getByRole('button', { name: label, exact: true })

async function onlyTune(db: CrosstuneDb) {
  const tunes = await db.tunes.toArray()
  return tunes.length === 1 ? tunes[0] : undefined
}

/** Clicks the backdrop near the top of the window, clear of a sheet or a centered dialog. */
async function clickBackdrop(): Promise<void> {
  const scrim = document.querySelector('[data-sheet-scrim]')
  if (!scrim) throw new Error('no sheet scrim')
  await userEvent.click(page.elementLocator(scrim), { position: { x: 20, y: 10 } })
}

async function editTune(db: CrosstuneDb, tune: Parameters<typeof createTune>[1]) {
  const { tuneId } = await createTune(db, tune, { status: 'learning' })
  const app = await renderApp({ path: `/catalog/${tuneId}`, db, frame: PHONE })
  await page.getByRole('button', { name: EDIT_TUNE, exact: true }).click()
  await expect.element(titleField(EDIT_TUNE_TITLE)).toHaveValue(tune.title)
  return { ...app, tuneId }
}

it('carries the title typed into search into a new tune, and opens it once added', async () => {
  const db = openTestDb()
  const { router } = await renderApp({ path: '/catalog', db, frame: PHONE })
  await page.getByRole('searchbox', { name: SEARCH_TUNES }).fill('Sally Goodin')
  await page
    .getByRole('button', {
      name: addOfferLabel({ kind: 'create', title: 'Sally Goodin', another: false }),
    })
    .click()
  await expect.element(titleField()).toHaveValue('Sally Goodin')

  await sheet(NEW_TUNE_TITLE)
    .getByRole('option', { name: spokenKey('G') })
    .click()
  await primary(NEW_TUNE_TITLE, ADD_NEW_TUNE).click()
  await expect.element(sheet(NEW_TUNE_TITLE)).not.toBeInTheDocument()
  await expect.poll(() => onlyTune(db)).toMatchObject({ title: 'Sally Goodin', key: 'G' })
  const tune = (await onlyTune(db))!
  await expect.poll(path(router)).toBe(`/catalog/${tune.id}`)
})

function renderSheet(db: CrosstuneDb, density: 'pointer' | 'touch' = 'pointer') {
  const onOpenChange = vi.fn<(open: boolean) => void>()
  const Data = dataProviders({ db })
  renderWithProviders(
    <Data>
      <TuneFormSheet isOpen onOpenChange={onOpenChange} />
    </Data>,
    { density },
  )
  return onOpenChange
}

it.each(['pointer', 'touch'] as const)(
  'keeps typed work through Escape and a backdrop tap on %s, and Cancel discards it',
  async (density) => {
    const db = openTestDb()
    const onOpenChange = renderSheet(db, density)
    await titleField().fill('Forked Deer')

    const escapes = seen('keyup', (event) => (event as KeyboardEvent).key === 'Escape')
    await userEvent.keyboard('{Escape}')
    await expect.poll(escapes).toBe(1)
    const clicks = seen('click')
    await clickBackdrop()
    await expect.poll(clicks).toBe(1)
    expect(onOpenChange).not.toHaveBeenCalled()
    await expect.element(titleField()).toHaveValue('Forked Deer')

    await sheet(NEW_TUNE_TITLE).getByRole('button', { name: CANCEL }).click()
    await expect.poll(() => onOpenChange.mock.calls).toEqual([[false]])
    expect(await db.tunes.count()).toBe(0)
  },
)

it('closes on Escape while it holds no typed work', async () => {
  const db = openTestDb()
  const onOpenChange = renderSheet(db)
  await expect.element(titleField()).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => onOpenChange.mock.calls).toEqual([[false]])
})

it('keeps the chosen status when it is pressed again', async () => {
  const db = openTestDb()
  await renderApp({ path: '/catalog', db, frame: PHONE })
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  const rail = sheet(NEW_TUNE_TITLE).getByRole('radiogroup', { name: STATUS_HEADER })
  const known = rail.getByRole('radio', { name: STATUS_LABELS.known })
  await known.click()
  await expect.element(known).toBeChecked()
  await known.click()
  await expect.element(known).toBeChecked()

  await titleField().fill('Cluck Old Hen')
  await primary(NEW_TUNE_TITLE, ADD_NEW_TUNE).click()
  await expect.poll(() => onlyTune(db)).toBeDefined()
  const userTune = await db.user_tunes
    .where('tune_id')
    .equals((await onlyTune(db))!.id)
    .first()
  expect(userTune?.status).toBe('known')
})

it('reveals a text field from Other… that keeps the current value until typed', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Old Joe Clark', tune_type: 'reel' })
  const form = sheet(EDIT_TUNE_TITLE)
  const type = form.getByRole('combobox', { name: DETAIL_LABELS.tune_type })
  await expect.element(type).toHaveValue('reel')
  await type.click()
  await page.getByRole('option', { name: OTHER_OPTION }).click()
  const other = form.getByRole('textbox', { name: otherLabel(DETAIL_LABELS.tune_type) })
  await expect.element(other).toHaveValue('reel')
  await expect.element(other).toHaveFocus()

  await other.fill('slip reel')
  await expect.element(type).toHaveValue('slip reel')
  await primary(EDIT_TUNE_TITLE, SAVE_TUNE).click()
  await expect.element(form).not.toBeInTheDocument()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.tune_type).toBe('slip reel')
})

it('empties an open vocabulary from its Not set choice', async () => {
  const db = openTestDb()
  const { tuneId } = await editTune(db, { title: 'Old Joe Clark', tune_type: 'reel' })
  const form = sheet(EDIT_TUNE_TITLE)
  const type = form.getByRole('combobox', { name: DETAIL_LABELS.tune_type })
  await type.click()
  await page.getByRole('option', { name: NOT_SET, exact: true }).click()
  await expect.element(type).toHaveValue(NOT_SET)
  await expect
    .element(page.getByRole('option', { name: NOT_SET, exact: true }))
    .not.toBeInTheDocument()
  await primary(EDIT_TUNE_TITLE, SAVE_TUNE).click()
  await expect.element(form).not.toBeInTheDocument()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.tune_type).toBeNull()
})

it('carries words back from the lyrics sheet on Done, and drops them on Cancel', async () => {
  const db = openTestDb()
  const onOpenChange = renderSheet(db)
  await titleField().fill('Cluck Old Hen')
  const form = sheet(NEW_TUNE_TITLE)
  const row = form.getByRole('button', { name: DETAIL_LABELS.lyrics, exact: true })
  const lyrics = sheet(LYRICS_SECTION)
  const words = lyrics.getByRole('textbox', { name: LYRICS_SECTION })

  await row.click()
  await words.fill('My old hen')
  await lyrics.getByRole('button', { name: DONE }).click()
  await expect.element(lyrics).not.toBeInTheDocument()
  await expect.element(row).toHaveFocus()

  await row.click()
  await expect.element(words).toHaveValue('My old hen')
  await words.fill('My old hen is a good old hen')
  await lyrics.getByRole('button', { name: CANCEL }).click()
  await expect.element(lyrics).not.toBeInTheDocument()
  await expect.element(row).toHaveFocus()
  await row.click()
  await expect.element(words).toHaveValue('My old hen')
  await lyrics.getByRole('button', { name: CANCEL }).click()
  await expect.element(lyrics).not.toBeInTheDocument()

  await primary(NEW_TUNE_TITLE, ADD_NEW_TUNE).click()
  await expect.poll(() => onOpenChange.mock.calls).toEqual([[false]])
  await expect.poll(() => onlyTune(db)).toMatchObject({ lyrics: 'My old hen' })
})

it('dims an empty suggested field only while it shows Not set', async () => {
  const db = openTestDb()
  renderSheet(db)
  const composer = sheet(NEW_TUNE_TITLE).getByRole('combobox', { name: DETAIL_LABELS.composer })
  await expect.element(composer).toHaveValue(NOT_SET)
  const color = () => getComputedStyle(composer.element()).color
  const dimmed = color()
  await composer.click()
  await userEvent.keyboard('Ed')
  await expect.element(composer).toHaveValue('Ed')
  await expect.poll(color).not.toBe(dimmed)
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

it.each(['pointer', 'touch'] as const)(
  'lets a type set the time signature after its picker is dismissed on %s',
  async (density) => {
    const db = openTestDb()
    renderSheet(db, density)
    const form = sheet(NEW_TUNE_TITLE)
    const signature = form.getByRole('button', { name: new RegExp(DETAIL_LABELS.time_signature) })
    await expect.element(signature).toHaveTextContent('4/4')
    await signature.click()
    const list =
      density === 'touch'
        ? page.getByRole('dialog', { name: DETAIL_LABELS.time_signature })
        : page.getByRole('option', { name: '6/8' })
    await expect.element(list).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(list).not.toBeInTheDocument()
    await expect.element(form).toBeVisible()
    await form.getByRole('combobox', { name: DETAIL_LABELS.tune_type }).click()
    await page.getByRole('option', { name: 'Jig', exact: true }).click()
    await expect.element(signature).toHaveTextContent('6/8')
  },
)

it('keeps a time signature picked as shown when a type is chosen after', async () => {
  const db = openTestDb()
  const onOpenChange = renderSheet(db)
  await titleField().fill('Haste to the Wedding')
  const form = sheet(NEW_TUNE_TITLE)
  const signature = form.getByRole('button', { name: new RegExp(DETAIL_LABELS.time_signature) })
  await expect.element(signature).toHaveTextContent('4/4')
  await signature.click()
  await page.getByRole('option', { name: '4/4' }).click()
  await form.getByRole('combobox', { name: DETAIL_LABELS.tune_type }).click()
  await page.getByRole('option', { name: 'Jig', exact: true }).click()
  await expect.element(signature).toHaveTextContent('4/4')
  await primary(NEW_TUNE_TITLE, ADD_NEW_TUNE).click()
  await expect.poll(() => onOpenChange.mock.calls).toEqual([[false]])
  await expect.poll(() => onlyTune(db)).toMatchObject({ tune_type: 'Jig', time_signature: '4/4' })
})

it('reports a missing title under the field, focuses it, and clears at the first keystroke', async () => {
  const db = openTestDb()
  await renderApp({ path: '/catalog', db, frame: PHONE })
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await expect.element(primary(NEW_TUNE_TITLE, ADD_NEW_TUNE)).toBeDisabled()
  await titleField().click()
  await userEvent.keyboard('{Enter}')
  const alert = sheet(NEW_TUNE_TITLE).getByRole('alert')
  await expect.element(alert).toHaveTextContent(TITLE_REQUIRED)
  await expect.element(titleField()).toHaveFocus()
  await expect.element(titleField()).toHaveAttribute('aria-invalid', 'true')
  await userEvent.keyboard('S')
  await expect.element(alert).not.toBeInTheDocument()
  await expect.element(titleField()).not.toHaveAttribute('aria-invalid', 'true')
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
  renderSheet(db, 'touch')
  const form = sheet(NEW_TUNE_TITLE)
  await form.getByRole('textbox', { name: YEAR_LABEL }).fill('2019')
  const month = form.getByRole('button', { name: new RegExp(MONTH_LABEL) })
  await month.click()
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

const OPEN_FORM = 'Open form'

function Opener({ options }: { options: TuneFormOptions }) {
  const launcher = useTuneFormLauncher()
  return <Button label={OPEN_FORM} onPress={() => launcher.open(options)} />
}

function renderProvider(db: CrosstuneDb, options: TuneFormOptions) {
  const navigated: string[] = []
  const Data = dataProviders({ db })
  renderWithProviders(
    <Data>
      <TuneFormProvider navigate={(to) => navigated.push(to)}>
        <Opener options={options} />
      </TuneFormProvider>
    </Data>,
  )
  return navigated
}

it('opens a new tune added from a list in that list', async () => {
  const db = openTestDb()
  const listId = await createList(db, 'Session')
  const navigated = renderProvider(db, { initialTitle: 'Sally Goodin', listId })
  await page.getByRole('button', { name: OPEN_FORM }).click()
  await primary(NEW_TUNE_TITLE, ADD_NEW_TUNE).click()
  await expect.poll(() => navigated.length).toBe(1)
  const tune = (await onlyTune(db))!
  expect(navigated).toEqual([listTunePath(listId, tune.id)])
})

it('opens a tune its list refused in the catalog, and says why', async () => {
  const db = openTestDb()
  const navigated = renderProvider(db, { initialTitle: 'Sally Goodin', listId: 'gone' })
  await page.getByRole('button', { name: OPEN_FORM }).click()
  await primary(NEW_TUNE_TITLE, ADD_NEW_TUNE).click()
  await expect.element(page.getByRole('status')).toHaveTextContent(LIST_NOT_FOUND)
  const tune = (await onlyTune(db))!
  expect(navigated).toEqual([tuneHomePath(tune.id)])
})

it('stays put when the form is cancelled while its new tune saves', async () => {
  const db = openTestDb()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const actual = await vi.importActual<typeof tunes>('../../commands/tunes')
  vi.mocked(createTune).mockImplementationOnce(async (...args) => {
    await gate
    return actual.createTune(...args)
  })
  const callsBefore = vi.mocked(createTune).mock.calls.length
  const navigated = renderProvider(db, { initialTitle: 'Sally Goodin', listId: 'gone' })
  await page.getByRole('button', { name: OPEN_FORM }).click()
  await primary(NEW_TUNE_TITLE, ADD_NEW_TUNE).click()
  await expect.poll(() => vi.mocked(createTune).mock.calls.length).toBe(callsBefore + 1)
  await sheet(NEW_TUNE_TITLE).getByRole('button', { name: CANCEL }).click()
  await expect.element(sheet(NEW_TUNE_TITLE)).not.toBeInTheDocument()
  release()
  // The refused filing's toast is the sign the save has landed and been answered.
  await expect.element(page.getByRole('status')).toHaveTextContent(LIST_NOT_FOUND)
  expect(navigated).toEqual([])
})
