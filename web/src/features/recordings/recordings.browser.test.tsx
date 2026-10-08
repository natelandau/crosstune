import { beforeEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { deleteRecording } from '../../commands/recordings'
import { META_RECORDINGS_ORIGIN, setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { addOfferLabel, SEARCH_TUNES } from '../catalog/catalogCopy'
import { providerLabel } from '../links/display'
import { NOT_AUDIO_ERROR } from './addAudioFiles'
import { openTuneName } from './recordingNames'
import {
  ADD_TO_TUNE_TITLE,
  addToTuneName,
  FILED_HEADER,
  filedToast,
  MY_RECORDINGS,
  NO_RECORDINGS_TITLE,
  SEARCH_RECORDINGS,
  SOURCE_SECTION,
  STORAGE_USED,
  UNFILED_HEADER,
  UPLOAD_AUDIO,
} from './recordingsCopy'
import { SORT_LABELS } from './sortCopy'

import { ADD_NEW_TUNE, NEW_TUNE_TITLE } from '../tune/tuneFormCopy'
import { openTestDb } from '../../test/db'
import { recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { DONE } from '../../ui/confirmCopy'
import { FILTERS, filtersLabel, removeFilterLabel, RESET } from '../../ui/filterCopy'
import { SORT_BY } from '../../ui/sortCopy'
import { destination } from '../../app/destinations'
import { CHOOSE_FROM_RECORDING, NO_TUNE_SELECTED } from '../../app/DetailEmpty'
import { renderApp } from '../../test/renderApp'
import { TUNE } from '../tune/tunePageCopy'
import { UNDO } from '../../ui/Toast'
import { DROP_TO_IMPORT } from './DropOverlay'
import { ADD_TO_TUNE } from './recordingCopy'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const RECORDINGS = destination('recordings')
const SLIPPERY = providerLabel({ provider: 'slippery_hill' })

let db: CrosstuneDb
// The list is the page's main while it is the only pane, and a region beside a page.
let listRole: 'main' | 'region' = 'region'

beforeEach(() => {
  db = openTestDb()
  listRole = 'region'
  // The sort choice is held in memory once read; a cleared-storage event resets it.
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
})

function show(frame = WIDE) {
  listRole = frame === WIDE ? 'region' : 'main'
  return renderApp({ path: RECORDINGS.root, db, frame })
}

// A tune page's own Recordings section keeps the same name, so the column is the one that
// holds the recordings search.
const column = () =>
  page
    .getByRole(listRole, { name: RECORDINGS.label, exact: true })
    .filter({ has: page.getByRole('searchbox', { name: SEARCH_RECORDINGS }) })
const filters = (name = FILTERS) => column().getByRole('button', { name, exact: true })
const token = (value: string) =>
  column().getByRole('button', { name: removeFilterLabel(value), exact: true })
const row = (name: string) => column().getByRole('row', { name: new RegExp(name) })
const sheet = () => page.getByRole('dialog', { name: FILTERS })

/** The column's group headings, in order. */
const groupHeadings = () =>
  [...column().element().querySelectorAll('section[aria-labelledby] > div > h2')].map(
    (heading) => heading.textContent,
  )

async function chooseSource(label: string) {
  await filters().click()
  await sheet()
    .getByRole('button', { name: new RegExp(SOURCE_SECTION) })
    .click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await sheet().getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(sheet()).not.toBeInTheDocument()
}

async function seedTunes() {
  await db.tunes.bulkPut([tuneRow('joy', "Soldier's Joy"), tuneRow('hen', 'Cluck Old Hen')])
  await db.user_tunes.bulkPut([userTuneRow('u-joy', 'joy'), userTuneRow('u-hen', 'hen')])
}

it('shows no Filters while loading, nor with only own recordings', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const get = db.meta.get.bind(db.meta) as (key: string) => Promise<unknown>
  vi.spyOn(db.meta, 'get').mockImplementation(((key: string) =>
    key === META_RECORDINGS_ORIGIN ? gate.then(() => get(key)) : get(key)) as never)
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording', origin: 'slippery_hill' }))
  await show()
  await expect.element(column().getByRole('searchbox', { name: SEARCH_RECORDINGS })).toBeVisible()
  await expect.element(filters()).not.toBeInTheDocument()
  release()
  await expect.element(filters()).toBeEnabled()
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
  await expect.element(column().getByText('1 recording', { exact: true })).toBeVisible()
  await expect.element(filters()).not.toBeInTheDocument()
})

it('shows Filters once an import arrives, and a source narrows the list behind a token', async () => {
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
  await show()
  await expect.element(row('Jam recording')).toBeVisible()
  await expect.element(filters()).not.toBeInTheDocument()
  await db.recordings.put(recordingRow('r2', { label: 'Imported take', origin: 'slippery_hill' }))
  await expect.element(filters()).toBeEnabled()
  await chooseSource(SLIPPERY)
  await expect.element(token(SLIPPERY)).toBeVisible()
  await expect.element(filters(filtersLabel(1))).toBeVisible()
  await expect.element(row('Imported take')).toBeVisible()
  await expect.element(row('Jam recording')).not.toBeInTheDocument()
  await token(SLIPPERY).click()
  await expect.element(row('Jam recording')).toBeVisible()
  await chooseSource(MY_RECORDINGS)
  await expect.element(token(MY_RECORDINGS)).toBeVisible()
  await expect.element(row('Imported take')).not.toBeInTheDocument()
})

it("keeps Filters and its token once a set source's import is deleted, so Reset returns to All", async () => {
  // Set by an earlier session.
  await db.meta.put({ key: META_RECORDINGS_ORIGIN, value: 'slippery_hill' })
  await db.recordings.bulkPut([
    recordingRow('r1', { label: 'Jam recording' }),
    recordingRow('r2', { label: 'Imported take', origin: 'slippery_hill' }),
  ])
  await show()
  await expect.element(row('Imported take')).toBeVisible()
  await deleteRecording(db, 'r2')
  await expect.element(row('Imported take')).not.toBeInTheDocument()
  await expect.element(token(SLIPPERY)).toBeVisible()
  await expect.element(filters(filtersLabel(1))).toBeEnabled()
  await filters(filtersLabel(1)).click()
  await expect
    .element(sheet().getByRole('button', { name: new RegExp(SOURCE_SECTION) }))
    .toHaveTextContent(SLIPPERY)
  await sheet().getByRole('button', { name: RESET, exact: true }).click()
  await sheet().getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(sheet()).not.toBeInTheDocument()
  await expect.element(row('Jam recording')).toBeVisible()
  await expect.element(token(SLIPPERY)).not.toBeInTheDocument()
  await expect.element(filters()).not.toBeInTheDocument()
  // The control that opened the sheet is gone, so focus lands on the column's title.
  await expect
    .element(column().getByRole('heading', { level: 1, name: RECORDINGS.label }))
    .toHaveFocus()
  await expect.poll(async () => (await db.meta.get(META_RECORDINGS_ORIGIN))?.value).toBe('all')
})

it('moves focus to the title when Filters goes after its sheet has closed', async () => {
  await db.meta.put({ key: META_RECORDINGS_ORIGIN, value: 'slippery_hill' })
  await db.recordings.bulkPut([recordingRow('r1', { label: 'Jam recording' })])
  await show()
  await filters(filtersLabel(1)).click()
  await sheet().getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(sheet()).not.toBeInTheDocument()
  await expect.element(filters(filtersLabel(1))).toHaveFocus()
  // The source write lands only after the sheet is gone, as a slow device's would.
  await db.meta.put({ key: META_RECORDINGS_ORIGIN, value: 'all' })
  await expect.element(filters()).not.toBeInTheDocument()
  await expect
    .element(column().getByRole('heading', { level: 1, name: RECORDINGS.label }))
    .toHaveFocus()
})

it('moves focus to the title when a frame passes before the closed sheet leaves the page', async () => {
  await db.meta.put({ key: META_RECORDINGS_ORIGIN, value: 'slippery_hill' })
  await db.recordings.bulkPut([recordingRow('r1', { label: 'Jam recording' })])
  await show()
  await filters(filtersLabel(1)).click()
  await sheet().getByRole('button', { name: RESET, exact: true }).click()
  await expect.element(filters()).not.toBeInTheDocument()
  // A frame that runs before React commits the sheet's removal, as on a loaded device.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    queueMicrotask(() => callback(performance.now()))
    return 0
  })
  await sheet().getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(sheet()).not.toBeInTheDocument()
  await expect
    .element(column().getByRole('heading', { level: 1, name: RECORDINGS.label }))
    .toHaveFocus()
})

it('moves focus to the title when removing the token leaves nothing to filter', async () => {
  await db.meta.put({ key: META_RECORDINGS_ORIGIN, value: 'slippery_hill' })
  await db.recordings.bulkPut([recordingRow('r1', { label: 'Jam recording' })])
  await show()
  await expect.element(token(SLIPPERY)).toBeVisible()
  ;(token(SLIPPERY).element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(filters()).not.toBeInTheDocument()
  await expect
    .element(column().getByRole('heading', { level: 1, name: RECORDINGS.label }))
    .toHaveFocus()
})

it('heads Unfiled, then each tune under the Tune sort, as plain section headings', async () => {
  await seedTunes()
  await db.recordings.bulkPut([
    recordingRow('r1', { label: 'Jam recording' }),
    recordingRow('r2', { label: 'Joy take', tune_id: 'joy' }),
    recordingRow('r3', { label: 'Hen take', tune_id: 'hen' }),
  ])
  const { router } = await show()
  await expect.poll(groupHeadings).toEqual([UNFILED_HEADER, FILED_HEADER])
  await column()
    .getByRole('button', { name: new RegExp(`^${SORT_BY} `) })
    .click()
  await page.getByRole('menuitemradio', { name: new RegExp(SORT_LABELS.tune) }).click()
  await expect.poll(groupHeadings).toEqual([UNFILED_HEADER, 'Cluck Old Hen', "Soldier's Joy"])
  // No cards: a group sits on the ground.
  const group = column().getByRole('heading', { name: 'Cluck Old Hen', level: 2 })
  await expect.element(group).toHaveClass(/t-heading/)
  await group.getByRole('link', { name: 'Cluck Old Hen' }).click()
  await expect.poll(() => router.state.location.pathname).toBe(`${RECORDINGS.root}/hen`)
  await expect
    .element(page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1 }))
    .toHaveTextContent('Cluck Old Hen')
  await expect.element(row('Hen take')).toBeVisible()
})

it('names the way to a tune in the empty detail column on wide', async () => {
  await show()
  const detail = page.getByRole('main', { name: TUNE })
  await expect.element(detail.getByRole('heading', { name: NO_TUNE_SELECTED })).toBeVisible()
  await expect.element(detail.getByText(CHOOSE_FROM_RECORDING)).toBeVisible()
})

it('shows the list and the tune side by side on a wide deep link', async () => {
  await seedTunes()
  await db.recordings.put(recordingRow('r2', { label: 'Joy take', tune_id: 'joy' }))
  await renderApp({ path: `${RECORDINGS.root}/joy`, db, frame: WIDE })
  await expect.element(row('Joy take')).toBeVisible()
  await expect
    .element(page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1 }))
    .toHaveTextContent("Soldier's Joy")
})

it('moves between rows with the arrows and leaves the open tune alone on wide', async () => {
  await seedTunes()
  await db.recordings.bulkPut([
    recordingRow('r1', { label: 'Joy take', tune_id: 'joy' }),
    recordingRow('r2', { label: 'Hen take', tune_id: 'hen' }),
  ])
  const { router } = await renderApp({ path: `${RECORDINGS.root}/joy`, db, frame: WIDE })
  const detailTitle = page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1 })
  await expect.element(detailTitle).toHaveTextContent("Soldier's Joy")
  await expect.element(row('Joy take')).toBeVisible()
  await expect.element(row('Hen take')).toBeVisible()
  const rows = column().getByRole('row').elements() as HTMLElement[]
  const [first, second] = rows
  first!.focus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(() => document.activeElement).toBe(second)
  await userEvent.keyboard('{ArrowUp}')
  await expect.poll(() => document.activeElement).toBe(first)
  await expect.poll(() => router.state.location.pathname).toBe(`${RECORDINGS.root}/joy`)
  await expect.element(detailTitle).toHaveTextContent("Soldier's Joy")
})

it("pushes a filed recording's tune from its tune line on the phone", async () => {
  await seedTunes()
  await db.recordings.put(recordingRow('r2', { label: 'Joy take', tune_id: 'joy' }))
  const { router } = await show(PHONE)
  await expect.element(row('Joy take')).toBeVisible()
  const list = column().element()
  await row('Joy take')
    .getByRole('button', { name: openTuneName("Soldier's Joy") })
    .click()
  await expect.poll(() => router.state.location.pathname).toBe(`${RECORDINGS.root}/joy`)
  await expect.poll(() => list.checkVisibility()).toBe(false)
  await expect
    .element(page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1 }))
    .toHaveTextContent("Soldier's Joy")
})

it('files an unfiled recording from its row action, with an Undo', async () => {
  await seedTunes()
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
  await show()
  await row('Jam recording').hover()
  await row('Jam recording').getByRole('button', { name: ADD_TO_TUNE, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: ADD_TO_TUNE_TITLE })
  await dialog.getByRole('searchbox', { name: SEARCH_TUNES }).fill('cluck')
  await dialog.getByRole('row', { name: addToTuneName('Cluck Old Hen'), exact: true }).click()
  await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBe('hen')
  await expect.element(page.getByText(filedToast('Cluck Old Hen'))).toBeVisible()
  await expect.poll(groupHeadings).toEqual([FILED_HEADER])
  await page.getByRole('button', { name: UNDO }).click()
  await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBeNull()
  await expect.poll(groupHeadings).toEqual([UNFILED_HEADER])
})

it('files an unfiled recording under a new tune from its menu, and stays on Recordings', async () => {
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
  const { router } = await show()
  await row('Jam recording').click({ button: 'right' })
  await page.getByRole('menuitem', { name: ADD_TO_TUNE }).click()
  const dialog = page.getByRole('dialog', { name: ADD_TO_TUNE_TITLE })
  await dialog.getByRole('searchbox', { name: SEARCH_TUNES }).fill('Sally Goodin')
  await dialog
    .getByRole('button', {
      name: addOfferLabel({ kind: 'create', title: 'Sally Goodin', another: false }),
    })
    .click()
  const form = page.getByRole('dialog', { name: NEW_TUNE_TITLE })
  await form.getByRole('button', { name: ADD_NEW_TUNE, exact: true }).click()
  await expect.element(form).not.toBeInTheDocument()
  await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).not.toBeNull()
  await expect.poll(groupHeadings).toEqual([FILED_HEADER])
  expect(router.state.location.pathname).toBe(RECORDINGS.root)
})

it('sits the storage summary after the last group', async () => {
  await setStorage(db, { used_bytes: 1_000_000, quota_bytes: 2_000_000, max_file_bytes: 500_000 })
  await seedTunes()
  await db.recordings.bulkPut([
    recordingRow('r1', { label: 'Jam recording' }),
    recordingRow('r2', { label: 'Joy take', tune_id: 'joy' }),
  ])
  await show()
  const storage = column().getByRole('progressbar', { name: STORAGE_USED })
  await expect.element(storage).toBeVisible()
  await expect.element(row('Joy take')).toBeVisible()
  const sections = column().element().querySelectorAll('section[aria-labelledby]')
  const last = sections[sections.length - 1]!
  expect(
    last.compareDocumentPosition(storage.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

it('hides the storage summary while there are no recordings', async () => {
  await setStorage(db, { used_bytes: 0, quota_bytes: 2_000_000, max_file_bytes: 500_000 })
  await show()
  await expect.element(column().getByText(NO_RECORDINGS_TITLE)).toBeVisible()
  await expect.element(column().getByRole('progressbar')).not.toBeInTheDocument()
})

/** Fires a file drag event on the column, as a drag from the desktop would. */
function drag(type: 'dragenter' | 'dragleave' | 'drop', files: File[], relatedTarget?: Element) {
  const dataTransfer = new DataTransfer()
  for (const file of files) dataTransfer.items.add(file)
  column()
    .getByRole('searchbox', { name: SEARCH_RECORDINGS })
    .element()
    .dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, relatedTarget }),
    )
}

it('imports a dropped audio file, and refuses a dropped text file', async () => {
  await show()
  await expect.element(column().getByText(NO_RECORDINGS_TITLE)).toBeVisible()
  drag('drop', [new File(['abc'], 'jam.m4a', { type: 'audio/mp4' })])
  await expect.element(row('jam')).toBeVisible()
  drag('drop', [new File(['x'], 'notes.txt', { type: 'text/plain' })])
  await expect.element(column().getByRole('alert')).toHaveTextContent(NOT_AUDIO_ERROR)
})

it('uploads the audio files picked from Upload', async () => {
  await show()
  await expect.element(column().getByRole('button', { name: UPLOAD_AUDIO })).toBeVisible()
  const input = column().element().querySelector<HTMLInputElement>('input[type="file"]')!
  expect(input.multiple).toBe(true)
  expect(input.accept).toBe('audio/*')
  await userEvent.upload(input, [
    new File(['abc'], 'jam.m4a', { type: 'audio/mp4' }),
    new File(['abc'], 'reel.wav', { type: 'audio/wav' }),
  ])
  await expect.element(row('jam')).toBeVisible()
  await expect.element(row('reel')).toBeVisible()
})

it('outlines the column under the pane bar while files are dragged over it', async () => {
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
  await show()
  await expect.element(row('Jam recording')).toBeVisible()
  drag('dragenter', [new File(['abc'], 'jam.m4a', { type: 'audio/mp4' })])
  const overlay = column().getByText(DROP_TO_IMPORT)
  await expect.element(overlay).toBeVisible()
  const bar = column().element().querySelector('[data-pane-bar]')!
  const box = () => overlay.element().closest('[data-drop-overlay]')!.firstElementChild!
  await expect
    .poll(() => box().getBoundingClientRect().top >= bar.getBoundingClientRect().bottom)
    .toBe(true)
  drag('dragleave', [], document.body)
  await expect.element(overlay).not.toBeInTheDocument()
})
