import { page, userEvent } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import { activeItems, addToList, createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import { setNewTuneGenre, setNewTuneStatus } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, testSession } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { tuneRow, userTuneRow } from '../../test/rows'
import { LIST_NAME_LABEL } from '../lists/listsCopy'
import { TITLE_FIELD } from '../tune/tuneFormCopy'
import { BACK } from '../../ui/confirmCopy'
import {
  ALREADY_IN_CATALOG,
  CONTINUE,
  IMPORT_HELP_URL,
  IMPORT_LIST_LABEL,
  IMPORT_STATUS_LABEL,
  IMPORT_TUNES,
  NEW_IMPORT_LIST,
  OVER_LIMIT_NOTE,
  PASTE_LABEL,
  RECORDINGS_NOTE,
  SHORTENED_NOTE,
  TEXT_FILES_ONLY,
  WHAT_CAN_I_PASTE,
  addTunesLabel,
  addedTunesToast,
  importListName,
  includeLabel,
} from './importCopy'
import { ImportSheet } from './ImportSheet'

const dialog = () => page.getByRole('dialog', { name: IMPORT_TUNES })
const pasteField = () => dialog().getByRole('textbox', { name: PASTE_LABEL })
const titleFields = () => dialog().getByRole('textbox', { name: TITLE_FIELD, exact: true })
const include = (title: string) => dialog().getByRole('checkbox', { name: includeLabel(title) })
const button = (name: string) => dialog().getByRole('button', { name, exact: true })
const reviewHeading = () => dialog().getByRole('heading', { name: IMPORT_STATUS_LABEL })
// The checkbox's input is visually hidden under its box, so a press lands on the row's label.
async function toggle(title: string) {
  await expect.element(include(title)).toBeInTheDocument()
  await page.elementLocator(include(title).element().closest('label')!).click()
}

async function mount({
  catalog = [] as string[],
  density = 'pointer' as 'pointer' | 'touch',
} = {}) {
  const db = openTestDb()
  for (const [index, title] of catalog.entries()) {
    await db.tunes.put(tuneRow(`t${index}`, title))
    await db.user_tunes.put(userTuneRow(`u${index}`, `t${index}`))
  }
  return { db, ...render(db, density) }
}

function render(db: CrosstuneDb, density: 'pointer' | 'touch' = 'pointer') {
  const analytics = recordingAnalytics()
  const onClosed = vi.fn()
  const Data = dataProviders({ db, analytics })
  renderWithProviders(
    <Data>
      <ImportSheet open entry="settings" onClosed={onClosed} />
    </Data>,
    { density },
  )
  return { analytics, onClosed }
}

/** Pastes the lines and continues to the review. */
async function review(lines: string[]) {
  await pasteField().fill(lines.join('\n'))
  await button(CONTINUE).click()
  await expect.element(pasteField()).not.toBeInTheDocument()
}

/** Drops the files on the paste step, as a drag from the desktop does. */
function drop(files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: 'none' },
  })
  pasteField().element().dispatchEvent(event)
}

async function titles(db: CrosstuneDb): Promise<string[]> {
  return (await db.tunes.toArray()).map((tune) => tune.title).toSorted()
}

it('pastes, reviews, and adds', async () => {
  const { db, onClosed } = await mount()
  await review(["Soldier's Joy", 'Cluck Old Hen', 'Red Haired Boy'])
  for (const title of ["Soldier's Joy", 'Cluck Old Hen', 'Red Haired Boy']) {
    await expect.element(include(title)).toBeChecked()
  }
  await button(addTunesLabel(3)).click()
  await expect.poll(() => db.tunes.count()).toBe(3)
  await expect.element(page.getByText(addedTunesToast(3))).toBeVisible()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.poll(() => onClosed.mock.calls.length).toBe(1)
})

it('points recordings to the Recordings screen on the paste step', async () => {
  await mount()
  await expect.element(page.getByText(RECORDINGS_NOTE)).toBeVisible()
})

it('keeps Continue disabled while the text is blank', async () => {
  await mount()
  await expect.element(button(CONTINUE)).toBeDisabled()
  await pasteField().fill('   \n ')
  await expect.element(button(CONTINUE)).toBeDisabled()
  await pasteField().fill('Cluck Old Hen')
  await expect.element(button(CONTINUE)).toBeEnabled()
})

it('starts a duplicate unchecked', async () => {
  await mount({ catalog: ["Soldier's Joy"] })
  await review(["Soldier's Joy", 'Cluck Old Hen'])
  await expect.element(button(addTunesLabel(1))).toBeEnabled()
  await expect.element(include("Soldier's Joy")).not.toBeChecked()
  await expect.element(include('Cluck Old Hen')).toBeChecked()
  await expect.element(dialog().getByText(ALREADY_IN_CATALOG)).toBeVisible()
})

it('checking a duplicate adds a second tune', async () => {
  const { db } = await mount({ catalog: ["Soldier's Joy"] })
  await review(["Soldier's Joy", 'Cluck Old Hen'])
  await toggle("Soldier's Joy")
  await expect.element(include("Soldier's Joy")).toBeChecked()
  await button(addTunesLabel(2)).click()
  await expect.poll(() => db.tunes.count()).toBe(3)
  expect(await titles(db)).toEqual(['Cluck Old Hen', "Soldier's Joy", "Soldier's Joy"])
})

it('follows an edited title', async () => {
  await mount({ catalog: ["Soldier's Joy"] })
  await review(['Soldiers Joy (D)'])
  await expect.element(dialog().getByText(ALREADY_IN_CATALOG)).not.toBeInTheDocument()
  await titleFields().fill("Soldier's Joy")
  await expect.element(dialog().getByText(ALREADY_IN_CATALOG)).toBeVisible()
  // The check is the musician's: an edit never changes it.
  await expect.element(include("Soldier's Joy")).toBeChecked()
  await expect.element(button(addTunesLabel(1))).toBeEnabled()
  await titleFields().fill('Cluck Old Hen')
  await expect.element(dialog().getByText(ALREADY_IN_CATALOG)).not.toBeInTheDocument()
})

it('does not count a blank title', async () => {
  const { db } = await mount()
  await review(['Cluck Old Hen', 'Red Haired Boy'])
  await expect.element(button(addTunesLabel(2))).toBeEnabled()
  await titleFields().first().fill('   ')
  await expect.element(button(addTunesLabel(1))).toBeEnabled()
  await titleFields().nth(1).fill('')
  await expect.element(button(addTunesLabel(0))).toBeDisabled()
  await titleFields().nth(1).fill('Red Haired Boy')
  await button(addTunesLabel(1)).click()
  await expect.poll(() => db.tunes.count()).toBe(1)
  expect(await titles(db)).toEqual(['Red Haired Boy'])
})

it('uses the new tune settings', async () => {
  const db = openTestDb()
  await setNewTuneStatus(db, testSession.userId, 'learning')
  await setNewTuneGenre(db, testSession.userId, 'Irish')
  render(db)
  await review(['Cluck Old Hen', 'Red Haired Boy'])
  await button(addTunesLabel(2)).click()
  await expect.poll(() => db.user_tunes.count()).toBe(2)
  expect((await db.user_tunes.toArray()).map((row) => row.status)).toEqual(['learning', 'learning'])
  expect((await db.tunes.toArray()).map((row) => row.genre)).toEqual(['Irish', 'Irish'])
})

async function listedTitles(db: CrosstuneDb, listId: string): Promise<(string | undefined)[]> {
  const items = (await activeItems(db, listId)).toSorted((a, b) => a.position - b.position)
  return Promise.all(
    items.map(async (item) => {
      const userTune = await db.user_tunes.get(item.user_tune_id)
      return (await db.tunes.get(userTune?.tune_id ?? ''))?.title
    }),
  )
}

async function chooseList(name: string) {
  await dialog()
    .getByRole('button', { name: new RegExp(IMPORT_LIST_LABEL) })
    .click()
  await page.getByRole('option', { name, exact: true }).click()
}

const sent = (analytics: ReturnType<typeof recordingAnalytics>, name: string) =>
  analytics.sends().filter((send) => send.name === name)

it('adds to a new list', async () => {
  const { db, analytics } = await mount()
  const pasted = ['Red Haired Boy', 'Cluck Old Hen', "Soldier's Joy"]
  await review(pasted)
  await chooseList(NEW_IMPORT_LIST)
  await expect
    .element(dialog().getByRole('textbox', { name: LIST_NAME_LABEL }))
    .toHaveValue(importListName(new Date()))
  await button(addTunesLabel(3)).click()
  await expect.poll(() => sent(analytics, 'import_completed').length).toBe(1)
  const [list] = await db.lists.toArray()
  expect(await db.lists.count()).toBe(1)
  expect(list?.name).toBe(importListName(new Date()))
  expect(await listedTitles(db, list?.id ?? '')).toEqual(pasted)
  expect(sent(analytics, 'list_created')).toEqual([
    { name: 'list_created', props: { list_id: list?.id, count_bucket: '1-9' } },
  ])
  expect(sent(analytics, 'import_completed')[0]?.props).toMatchObject({ list: 'new' })
})

it('adds to an existing list after its items', async () => {
  const db = openTestDb()
  const listId = await createList(db, 'Tuesday jam')
  const { userTuneId } = await createTune(db, { title: 'Old Joe Clark' }, { status: 'known' })
  await addToList(db, listId, userTuneId)
  const { analytics } = render(db)
  await review(['Red Haired Boy', 'Cluck Old Hen'])
  await chooseList('Tuesday jam')
  await button(addTunesLabel(2)).click()
  await expect.poll(() => sent(analytics, 'import_completed').length).toBe(1)
  expect(await db.lists.count()).toBe(1)
  expect(await listedTitles(db, listId)).toEqual([
    'Old Joe Clark',
    'Red Haired Boy',
    'Cluck Old Hen',
  ])
  expect(sent(analytics, 'tunes_added_to_list')).toEqual([
    { name: 'tunes_added_to_list', props: { list_id: listId, count_bucket: '1-9' } },
  ])
  expect(sent(analytics, 'list_created')).toEqual([])
  expect(sent(analytics, 'import_completed')[0]?.props).toMatchObject({ list: 'existing' })
})

it('shows only the first 500 tunes', async () => {
  await mount()
  await review(Array.from({ length: 501 }, (_, index) => `Tune ${index + 1}`))
  await expect.element(dialog().getByText(OVER_LIMIT_NOTE)).toBeVisible()
  await expect.element(button(addTunesLabel(500))).toBeEnabled()
})

it('links the help page from the paste step', async () => {
  await mount()
  const link = dialog().getByRole('link', { name: WHAT_CAN_I_PASTE })
  await expect.element(link).toHaveAttribute('href', IMPORT_HELP_URL)
  await expect.element(link).toHaveAttribute('target', '_blank')
})

it('shows help when a row was shortened', async () => {
  await mount()
  await review(['a'.repeat(205)])
  await expect.element(dialog().getByText(SHORTENED_NOTE)).toBeVisible()
  const control = dialog().getByRole('link', { name: WHAT_CAN_I_PASTE })
  await expect.element(control).toHaveAttribute('href', IMPORT_HELP_URL)
  await expect.element(control).toHaveAttribute('target', '_blank')
  const row = include('a'.repeat(200))
  await expect
    .poll(
      () =>
        control.element().compareDocumentPosition(row.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
    )
    .toBeTruthy()
  // An edited title is the musician's, so the note about the cut goes.
  await titleFields().fill('Short title')
  await expect.element(dialog().getByText(SHORTENED_NOTE)).not.toBeInTheDocument()
})

it('reads an opened file into the field, replacing its text', async () => {
  await mount()
  await pasteField().fill('Old text')
  const bytes = new Uint8Array([0xff, 0xfe, ...[...'Fête'].flatMap((c) => [c.charCodeAt(0), 0])])
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  expect(input).not.toBeNull()
  await userEvent.upload(input!, new File([bytes], 'tunes.txt', { type: 'text/plain' }))
  await expect.element(pasteField()).toHaveValue('Fête')
})

it('sends the import events', async () => {
  const { db, analytics } = await mount()
  await review(['Cluck Old Hen', 'Red Haired Boy'])
  await toggle('Red Haired Boy')
  await button(addTunesLabel(1)).click()
  await expect.poll(() => db.tunes.count()).toBe(1)
  await expect
    .poll(() => analytics.sends().some((send) => send.name === 'import_completed'))
    .toBe(true)
  const sends = analytics.sends()
  expect(sends).toEqual([
    { name: 'import_started', props: { entry: 'settings' } },
    {
      name: 'import_reviewed',
      props: { reader: 'plain', count_bucket: '1-9', duplicate_bucket: '0', has_warnings: false },
    },
    {
      name: 'import_completed',
      props: { reader: 'plain', count_bucket: '1-9', skipped_bucket: '1-9', list: 'none' },
    },
  ])
  const text = JSON.stringify(sends)
  expect(text).not.toContain('Cluck')
  expect(text).not.toContain('Red Haired')
})

it('takes no Add from a double click on Continue', async () => {
  // The touch sheet's header stays put as the step changes, so both clicks land on the button.
  const { db, analytics } = await mount({ density: 'touch' })
  await pasteField().fill('Cluck Old Hen\nRed Haired Boy')
  const box = button(CONTINUE).element().getBoundingClientRect()
  // Near the trailing edge, which the primary keeps as its label grows.
  await button(CONTINUE).dblClick({ position: { x: box.width - 4, y: box.height / 2 } })
  await expect.element(button(addTunesLabel(2))).toBeEnabled()
  expect(sent(analytics, 'import_completed')).toEqual([])
  expect(await db.tunes.count()).toBe(0)
  await button(addTunesLabel(2)).click()
  await expect.poll(() => db.tunes.count()).toBe(2)
})

it('moves focus into the review, so a second Enter on Continue adds nothing', async () => {
  const { db } = await mount()
  await pasteField().fill('Cluck Old Hen\nRed Haired Boy')
  // Continue waits for the catalog, and a key press, unlike a click, does not wait for it.
  await expect.element(button(CONTINUE)).toBeEnabled()
  ;(button(CONTINUE).element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(reviewHeading()).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(button(addTunesLabel(2))).toBeEnabled()
  expect(await db.tunes.count()).toBe(0)
})

it('keeps the review when Back then Continue leaves the text as it was', async () => {
  const { analytics } = await mount()
  await review(['Cluck Old Hen', 'Red Haired Boy'])
  await titleFields().first().fill('Cluck Old Hen (A)')
  await toggle('Red Haired Boy')
  await button(BACK).click()
  await button(CONTINUE).click()
  await expect.element(titleFields().first()).toHaveValue('Cluck Old Hen (A)')
  await expect.element(include('Red Haired Boy')).not.toBeChecked()
  await expect.element(button(addTunesLabel(1))).toBeEnabled()
  expect(sent(analytics, 'import_reviewed')).toHaveLength(1)
})

it('reads the text again when Back then Continue changed it', async () => {
  await mount()
  await review(['Cluck Old Hen'])
  await titleFields().fill('Edited')
  await button(BACK).click()
  await pasteField().fill('Cluck Old Hen\nSally Goodin')
  await button(CONTINUE).click()
  await expect.element(titleFields().first()).toHaveValue('Cluck Old Hen')
  await expect.element(titleFields().nth(1)).toHaveValue('Sally Goodin')
})

it('says which files it opens when a dropped file is not text', async () => {
  await mount()
  await pasteField().fill('Typed')
  drop([new File(['%PDF'], 'tunes.pdf', { type: 'application/pdf' })])
  await expect.element(dialog().getByText(TEXT_FILES_ONLY)).toBeVisible()
  await expect.element(pasteField()).toHaveValue('Typed')
})

it('keeps Continue disabled while a dropped file is read', async () => {
  await mount()
  await pasteField().fill('Typed')
  await expect.element(button(CONTINUE)).toBeEnabled()
  const file = new File(['Sally Goodin'], 'tunes.txt', { type: 'text/plain' })
  const bytes = await file.arrayBuffer()
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  file.arrayBuffer = () => held.then(() => bytes)
  drop([file])
  await expect.element(button(CONTINUE)).toBeDisabled()
  release()
  await expect.element(pasteField()).toHaveValue('Sally Goodin')
  await expect.element(button(CONTINUE)).toBeEnabled()
})

it('marks a duplicate added to the catalog while the paste was open again', async () => {
  const { db } = await mount()
  await review(['Cluck Old Hen'])
  await expect.element(dialog().getByText(ALREADY_IN_CATALOG)).not.toBeInTheDocument()
  await button(BACK).click()
  await db.tunes.put(tuneRow('t0', 'Cluck Old Hen'))
  await db.user_tunes.put(userTuneRow('u0', 't0'))
  await button(CONTINUE).click()
  await expect.element(dialog().getByText(ALREADY_IN_CATALOG)).toBeVisible()
  // The check is the musician's, so a late duplicate leaves it as it was.
  await expect.element(include('Cluck Old Hen')).toBeChecked()
})

it('leaves a refused file behind once new text is reviewed', async () => {
  await mount()
  drop([new File(['%PDF'], 'tunes.pdf', { type: 'application/pdf' })])
  await expect.element(dialog().getByText(TEXT_FILES_ONLY)).toBeVisible()
  await review(['Cluck Old Hen'])
  await expect.element(include('Cluck Old Hen')).toBeChecked()
  await expect.element(dialog().getByText(TEXT_FILES_ONLY)).not.toBeInTheDocument()
})

it('refuses a dropped spreadsheet', async () => {
  await mount()
  await pasteField().fill('Typed')
  drop([new File(['a,b'], 'tunes.csv', { type: 'text/csv' })])
  await expect.element(dialog().getByText(TEXT_FILES_ONLY)).toBeVisible()
  await expect.element(pasteField()).toHaveValue('Typed')
})

it('opens a .txt file only, whatever its type says', async () => {
  await mount()
  await pasteField().fill('Typed')
  drop([new File(['Cluck Old Hen'], 'notes.log', { type: 'text/plain' })])
  await expect.element(dialog().getByText(TEXT_FILES_ONLY)).toBeVisible()
  await expect.element(pasteField()).toHaveValue('Typed')
  drop([new File(['Sally Goodin'], 'TUNES.TXT', { type: '' })])
  await expect.element(pasteField()).toHaveValue('Sally Goodin')
  await expect.element(dialog().getByText(TEXT_FILES_ONLY)).not.toBeInTheDocument()
})
