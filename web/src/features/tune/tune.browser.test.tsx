import { page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import type * as tunes from '../../commands/tunes'
import { deleteTune, updateUserTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalTune } from '../../db/types'
import { CLOSE_PLAYER } from '../player/transportCopy'
import { PLAY } from '../recordings/recordingNames'
import type * as images from '../scans/prepareImage'
import { prepareImage, UndecodableImageError } from '../scans/prepareImage'
import { ADD_SCANS, CHOOSE_SCAN_FILES, unreadableFilesMessage } from '../scans/scanCopy'
import { addToList, createList } from '../../commands/lists'
import { deleteTuneMessage, deleteTuneTitle } from './deleteTuneMessage'
import {
  ADD_LYRICS,
  ADD_SCAN,
  ADDING_SCAN,
  ADD_TO_TUNE,
  EDIT_ALL_DETAILS,
  EDIT_LYRICS,
  EDIT_TUNE,
  LYRICS_SECTION,
  NOTES_SAVE_HINT,
  NOTES_SECTION,
  OPEN_LYRICS,
  RECORDINGS_SECTION,
  recordingsLine,
  WRITE_A_NOTE,
} from './tuneScreenCopy'
import {
  ABOUT_GROUP,
  ADDED_ON,
  DETAILS_GROUP,
  attributeRowName,
  ATTRIBUTES_LABEL,
  LEARNED_GROUP,
  LISTS_GROUP,
} from './attributeCopy'
import { DETAIL_LABELS } from './detailFields'
import { addedDay } from '../../text/format'
import { DONE } from '../../ui/confirmCopy'
import { lyricsTitle } from '../lyrics/lyricsCopy'
import { openTestDb } from '../../test/db'
import {
  entitlementRow,
  linkRow,
  recordingFile,
  recordingRow,
  tuneRow,
  userTuneRow,
} from '../../test/rows'
import { fakePlayer } from '../../test/providers'
import { PREMIUM_RECORDINGS_TITLE } from '../plan/planCopy'
import { EDIT, SUBSCRIBE_TO_PLAY } from '../recordings/recordingCopy'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { TUNE } from './tunePageCopy'
import { PRACTICE } from './tuneActionsCopy'
import { PLAY as TRANSPORT_PLAY } from '../player/transportCopy'
import { ADD_TO_LIST } from '../lists/listPickerCopy'
import {
  ADD_RECORDING,
  FIND_A_RECORDING,
  FIRST_RECORDING_TITLE,
  PASTE_LINK,
  RECORD,
} from './tuneMediaCopy'
import { SEARCH_NEEDS_CONNECTION } from '../links/findRecordingsCopy'
import { destination } from '../../layout/destinations'
import { renderApp } from '../../test/renderApp'
import { COLUMN_GAP } from './attributesLayout'
import { DELETE } from '../../ui/Confirm'
import type { TuneFormLauncher } from './formLauncher'
import { tuneTitleTransition } from './TuneHeader'

// A passthrough a test can hold once; every other test reads its files for real.
vi.mock('../scans/prepareImage', async (original) => {
  const actual = await original<typeof images>()
  return { ...actual, prepareImage: vi.fn(actual.prepareImage) }
})

// A passthrough a test can hold once.
vi.mock('../../commands/tunes', async (original) => {
  const actual = await original<typeof tunes>()
  return { ...actual, updateUserTune: vi.fn(actual.updateUserTune) }
})

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
/** Split, where the detail column is too narrow for the attributes column. */
const SPLIT = { width: 800, height: 800 }

const CATALOG = destination('catalog')

async function seedTune(
  db: CrosstuneDb,
  id: string,
  title: string,
  extra: Partial<LocalTune> = {},
) {
  await db.tunes.put(tuneRow(id, title, extra))
  await db.user_tunes.put(userTuneRow(`u-${id}`, id))
}

const tunePage = () => page.getByRole('main', { name: TUNE })
const pageTitle = () => tunePage().getByRole('heading', { level: 1 })
const path = (router: { state: { location: { pathname: string } } }) => () =>
  router.state.location.pathname

const barButtons = () =>
  [...tunePage().element().querySelectorAll<HTMLElement>('[data-pane-bar] button')].map(
    (button) => button.getAttribute('aria-label') ?? button.textContent,
  )
/** A length custom property on the root, in px; a rem value counts the root's font size. */
const rootPx = (name: string) => {
  const root = getComputedStyle(document.documentElement)
  const value = root.getPropertyValue(name).trim()
  return value.endsWith('rem') ? parseFloat(value) * parseFloat(root.fontSize) : parseFloat(value)
}
const middle = (element: Element | Range) => {
  const box = element.getBoundingClientRect()
  return box.top + box.height / 2
}

it('the phone toolbar holds only More', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await expect.element(tunePage().getByRole('button', { name: MORE_ACTIONS })).toBeVisible()
  await expect.poll(barButtons).toEqual([MORE_ACTIONS])
  expect(tunePage().getByRole('button', { name: EDIT_TUNE, exact: true }).elements()).toHaveLength(
    0,
  )
})

it.each([
  ['split', SPLIT],
  ['wide', WIDE],
] as const)("%s puts More on the title's row, centered on its first line", async (_, frame) => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame })
  // It follows the frame, not the attributes: split shows the card, yet More is on the title's row.
  const attributes =
    frame === SPLIT
      ? tunePage().getByRole('region', { name: ATTRIBUTES_LABEL })
      : tunePage().getByRole('complementary', { name: ATTRIBUTES_LABEL })
  await expect.element(attributes).toBeVisible()
  const more = tunePage().getByRole('button', { name: MORE_ACTIONS })
  await expect.element(more).toBeVisible()
  await expect.poll(barButtons).toEqual([])
  await expect.element(pageTitle()).toHaveTextContent('Cluck Old Hen')
  await expect
    .poll(() => Math.abs(middle(more.element()) - middle(pageTitle().element())))
    .toBeLessThanOrEqual(1)
  await expect
    .poll(() => more.element().getBoundingClientRect().left)
    .toBeGreaterThan(pageTitle().element().getBoundingClientRect().right)
  expect(tunePage().getByRole('button', { name: EDIT_TUNE, exact: true }).elements()).toHaveLength(
    0,
  )
})

it("the attributes column's first group lines up with Recordings and stays in view as the page scrolls", async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  for (let n = 0; n < 24; n++) {
    await db.recording_links.put(linkRow(`l${n}`, 't1', { title: `Take ${n}`, position: n }))
  }
  await renderApp({ path: '/catalog/t1', db, frame: WIDE })
  const column = tunePage().getByRole('complementary', { name: ATTRIBUTES_LABEL })
  const heading = tunePage().getByRole('heading', { name: RECORDINGS_SECTION, level: 2 })
  await expect.element(column).toBeVisible()
  // The header's text, not its box, which carries the padding that sets it level.
  const firstHeader = () => {
    const range = document.createRange()
    range.selectNodeContents(column.getByRole('heading').first().element())
    return range
  }
  await expect
    .poll(() => Math.abs(middle(firstHeader()) - middle(heading.element())))
    .toBeLessThanOrEqual(1)

  const scroller = tunePage().element().closest<HTMLElement>('[data-pane-scroller]')!
  scroller.scrollTop = 600
  await expect.poll(() => scroller.scrollTop).toBe(600)
  const bar = tunePage().element().querySelector('[data-pane-bar]')!
  await expect
    .poll(() => column.element().getBoundingClientRect().top)
    .toBeGreaterThanOrEqual(bar.getBoundingClientRect().bottom)
  await expect
    .poll(() => column.element().getBoundingClientRect().top - bar.getBoundingClientRect().bottom)
    .toBeLessThan(40)
})

it('an attributes column taller than the pane scrolls on its own to the day added', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  for (let n = 0; n < 24; n++) {
    await db.recording_links.put(linkRow(`l${n}`, 't1', { title: `Take ${n}`, position: n }))
  }
  await renderApp({ path: '/catalog/t1', db, frame: { width: 1280, height: 480 } })
  const column = tunePage().getByRole('complementary', { name: ATTRIBUTES_LABEL })
  await expect.element(column).toBeVisible()
  await expect
    .poll(() => column.element().scrollHeight - column.element().clientHeight)
    .toBeGreaterThan(0)
  const scroller = tunePage().element().closest<HTMLElement>('[data-pane-scroller]')!
  const added = column.getByText(ADDED_ON(addedDay((await db.tunes.get('t1'))!.created_at)))
  added.element().scrollIntoView({ block: 'nearest' })
  await expect.poll(() => column.element().scrollTop).toBeGreaterThan(0)
  await expect
    .poll(() => added.element().getBoundingClientRect().bottom)
    .toBeLessThanOrEqual(scroller.getBoundingClientRect().bottom + 1)
})

it('a wide pane grows the attributes column beside the content and sets each value at its trailing edge', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: { width: 1920, height: 900 } })
  const column = tunePage().getByRole('complementary', { name: ATTRIBUTES_LABEL })
  await expect.element(column).toBeVisible()
  // The column's box, its hairline included, sits one gap past the content column at its widest.
  const hairline = column.element().parentElement!
  await expect
    .poll(() => hairline.getBoundingClientRect().width)
    .toBe(rootPx('--container-attributes-max'))
  const content = hairline.previousElementSibling!
  await expect
    .poll(() => hairline.getBoundingClientRect().left - content.getBoundingClientRect().right)
    .toBe(COLUMN_GAP)
  const status = column.getByRole('button', { name: /^Status, / })
  await expect.element(status).toBeVisible()
  const [label, value] = [...status.element().children] as HTMLElement[]
  await expect
    .poll(() => value!.getBoundingClientRect().left)
    .toBeGreaterThan(label!.getBoundingClientRect().left)
  await expect
    .poll(() => Math.abs(value!.getBoundingClientRect().top - label!.getBoundingClientRect().top))
    .toBeLessThan(4)
  await expect
    .poll(
      () => status.element().getBoundingClientRect().right - value!.getBoundingClientRect().right,
    )
    .toBe(parseFloat(getComputedStyle(status.element()).paddingRight))
  await expect
    .poll(() => parseFloat(getComputedStyle(label!).fontSize))
    .toBeCloseTo(rootPx('--size-secondary'))
  // The header stops where the attributes column does, so More sits over the column.
  await expect
    .poll(
      () =>
        pageTitle().element().closest('header')!.firstElementChild!.getBoundingClientRect().right,
    )
    .toBe(hairline.getBoundingClientRect().right)
})

it('More offers Edit all details', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  const launcher = { open: vi.fn<TuneFormLauncher['open']>() }
  await renderApp({ path: '/catalog/t1', db, frame: PHONE, launcher })
  await tunePage().getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: EDIT_ALL_DETAILS }).click()
  await expect.poll(() => launcher.open.mock.calls).toEqual([[{ tuneId: 't1' }]])
})

it('a new tune shows the start card, no action button row, and no empty-state blocks', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const recordings = tunePage().getByRole('region', { name: RECORDINGS_SECTION })
  await expect.element(recordings.getByText(FIRST_RECORDING_TITLE, { exact: true })).toBeVisible()
  // The card is the way on; with nothing to play there is no action button row at all.
  for (const name of [RECORD, PASTE_LINK, FIND_A_RECORDING]) {
    await expect.element(recordings.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect
    .poll(() => document.querySelector('div[aria-hidden][class="min-h-(--target-control)"]'))
    .toBeNull()
  for (const name of [TRANSPORT_PLAY, PRACTICE]) {
    expect(tunePage().getByRole('button', { name, exact: true }).query()).toBeNull()
  }
  await expect
    .element(tunePage().getByRole('textbox', { name: NOTES_SECTION }))
    .toHaveAttribute('placeholder', WRITE_A_NOTE)
  // No Lyrics or Scans and images until they hold something; both wait in the add line.
  await expect.poll(headings).toEqual([RECORDINGS_SECTION, NOTES_SECTION, LISTS_GROUP])
  const add = tunePage().getByRole('group', { name: ADD_TO_TUNE })
  await expect.element(add.getByRole('button', { name: ADD_SCAN })).toBeVisible()
  await expect.element(add.getByRole('button', { name: ADD_LYRICS })).toBeVisible()
  for (const gone of ['No recordings yet', 'No scans yet', 'No notes yet']) {
    expect(tunePage().getByText(gone).elements()).toHaveLength(0)
  }
})

it('the heading has no add control while the start card shows, and gets one with the first link', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const recordings = tunePage().getByRole('region', { name: RECORDINGS_SECTION })
  await expect.element(recordings.getByText(FIRST_RECORDING_TITLE, { exact: true })).toBeVisible()
  expect(recordings.getByRole('button', { name: ADD_RECORDING }).query()).toBeNull()

  await db.recording_links.put(linkRow('l1', 't1', { title: 'Henry Reed' }))
  await expect
    .element(recordings.getByText(FIRST_RECORDING_TITLE, { exact: true }))
    .not.toBeInTheDocument()
  await expect.element(recordings.getByRole('button', { name: ADD_RECORDING })).toBeVisible()
})

it('Find a recording refuses on tap while offline and clears once back online', async () => {
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  onTestFinished(() => onLine.mockRestore())
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const recordings = tunePage().getByRole('region', { name: RECORDINGS_SECTION })
  await recordings.getByRole('button', { name: FIND_A_RECORDING, exact: true }).click()
  await expect.element(recordings.getByText(SEARCH_NEEDS_CONNECTION)).toBeVisible()
  expect(page.getByRole('dialog').query()).toBeNull()

  onLine.mockReturnValue(true)
  window.dispatchEvent(new Event('online'))
  await expect.element(recordings.getByText(SEARCH_NEEDS_CONNECTION)).not.toBeInTheDocument()
})

it('keeps Add to list reachable on a tune with nothing to play', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: WIDE })
  const attributes = tunePage().getByRole('complementary', { name: ATTRIBUTES_LABEL })
  await expect.element(attributes.getByRole('button', { name: ADD_TO_LIST })).toBeVisible()
  await tunePage().getByRole('button', { name: MORE_ACTIONS }).click()
  await expect.element(page.getByRole('menuitem', { name: ADD_TO_LIST })).toBeVisible()
  await userEvent.keyboard('{Escape}')
})

it('says why a first scan was not added', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await expect.element(tunePage().getByRole('button', { name: ADD_SCAN })).toBeVisible()
  await userEvent.upload(
    page.getByLabelText(CHOOSE_SCAN_FILES),
    new File(['not an image'], 'notes.png', { type: 'image/png' }),
  )
  await expect
    .element(tunePage().getByRole('alert'))
    .toHaveTextContent(unreadableFilesMessage(['notes.png']))
  // Nothing was added, so the scan waits in the add line still.
  await expect.element(tunePage().getByRole('button', { name: ADD_SCAN })).toBeVisible()
})

it('says a first scan is being added while it is read', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  let fail: (reason: unknown) => void = () => {}
  vi.mocked(prepareImage).mockImplementationOnce(
    () => new Promise((_, reject) => void (fail = reject)),
  )
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await expect.element(tunePage().getByRole('button', { name: ADD_SCAN })).toBeVisible()
  // The live region is there, empty, before the add, so its text is announced as it arrives.
  const adding = tunePage().getByRole('group', { name: ADD_TO_TUNE }).getByRole('status')
  await expect.element(adding).toBeInTheDocument()
  await expect.element(adding).toHaveTextContent('')
  const region = adding.element()
  await userEvent.upload(
    page.getByLabelText(CHOOSE_SCAN_FILES),
    new File(['held'], 'sheet.png', { type: 'image/png' }),
  )
  await expect.element(adding).toHaveTextContent(ADDING_SCAN)
  expect(adding.element()).toBe(region)
  fail(new UndecodableImageError('sheet.png', null))
  await expect.element(adding).toHaveTextContent('')
  await expect.element(tunePage().getByRole('button', { name: ADD_SCAN })).toBeVisible()
})

it('+ Lyrics opens the tune form', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  const launcher = { open: vi.fn<TuneFormLauncher['open']>() }
  await renderApp({ path: '/catalog/t1', db, frame: PHONE, launcher })
  await tunePage()
    .getByRole('group', { name: ADD_TO_TUNE })
    .getByRole('button', { name: ADD_LYRICS })
    .click()
  await expect.poll(() => launcher.open.mock.calls).toEqual([[{ tuneId: 't1', focus: 'lyrics' }]])
})

async function seedWithLyrics(db: CrosstuneDb, extra: Partial<LocalTune> = {}) {
  await db.tunes.put(
    tuneRow('t1', 'Cluck Old Hen', { lyrics: "My old hen\nShe won't lay", ...extra }),
  )
  await db.user_tunes.put(userTuneRow('u-t1', 't1', { notes: 'Lift the B part' }))
}

const headings = () =>
  tunePage()
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent)

it('orders the sections on the phone, ending with Lists and the day added', async () => {
  const db = openTestDb()
  await seedWithLyrics(db)
  const listId = await createList(db, 'Tuesday jam')
  await addToList(db, listId, 'u-t1')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await expect
    .poll(headings)
    .toEqual([RECORDINGS_SECTION, LYRICS_SECTION, NOTES_SECTION, LISTS_GROUP])
  // Lists left the card for the end of the page.
  const lists = tunePage().getByRole('region', { name: LISTS_GROUP })
  await expect.element(lists.getByRole('link')).toHaveTextContent('Tuesday jam')
  await expect.element(lists.getByRole('button', { name: ADD_TO_LIST })).toBeVisible()
  const card = tunePage().getByRole('region', { name: ATTRIBUTES_LABEL })
  expect(card.getByRole('link').query()).toBeNull()
  const added = tunePage().getByText(ADDED_ON(addedDay((await db.tunes.get('t1'))!.created_at)), {
    exact: true,
  })
  await expect.element(added).toBeVisible()
  // The date ends the page, after the lists.
  expect(
    lists.element().compareDocumentPosition(added.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  expect(added.element().nextElementSibling).toBeNull()
  await expect
    .element(tunePage().getByRole('textbox', { name: NOTES_SECTION }))
    .toHaveValue('Lift the B part')
  // Lyrics are set, so the add line offers a scan alone, and only there: no scans yet means
  // no Scans and images section.
  const add = tunePage().getByRole('group', { name: ADD_TO_TUNE })
  await expect.element(add.getByRole('button', { name: ADD_SCAN })).toBeVisible()
  expect(add.getByRole('button', { name: ADD_LYRICS }).elements()).toHaveLength(0)
  expect(tunePage().getByRole('button', { name: ADD_SCANS }).elements()).toHaveLength(0)
})

it('leaves Lists and the day added to the attributes column on wide', async () => {
  const db = openTestDb()
  await seedWithLyrics(db)
  await renderApp({ path: '/catalog/t1', db, frame: WIDE })
  const column = tunePage().getByRole('complementary', { name: ATTRIBUTES_LABEL })
  await expect.element(column.getByRole('button', { name: ADD_TO_LIST })).toBeVisible()
  // The attributes column's groups follow the content in the outline, as its peers, not under Notes.
  await expect
    .poll(headings)
    .toEqual([
      RECORDINGS_SECTION,
      LYRICS_SECTION,
      NOTES_SECTION,
      DETAILS_GROUP,
      ABOUT_GROUP,
      LEARNED_GROUP,
      LISTS_GROUP,
    ])
  const added = ADDED_ON(addedDay((await db.tunes.get('t1'))!.created_at))
  expect(tunePage().getByText(added, { exact: true }).elements()).toHaveLength(1)
  await expect.element(column.getByText(added, { exact: true })).toBeVisible()
})

it('opens and closes the Lyrics section in place, starting closed', async () => {
  const db = openTestDb()
  await seedWithLyrics(db)
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const section = tunePage().getByRole('region', { name: LYRICS_SECTION })
  const toggle = section.getByRole('button', { name: LYRICS_SECTION, exact: true })
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(section.getByText('My old hen').query()).toBeNull()
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect.element(section.getByText('My old hen', { exact: true })).toBeVisible()
  await expect.element(section.getByText("She won't lay", { exact: true })).toBeVisible()
  await toggle.click()
  await expect.element(section.getByText('My old hen')).not.toBeInTheDocument()
})

it("the action button row's Lyrics opens the reader and leaves the section closed", async () => {
  const db = openTestDb()
  await seedWithLyrics(db)
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const toggle = tunePage()
    .getByRole('region', { name: LYRICS_SECTION })
    .getByRole('button', { name: LYRICS_SECTION, exact: true })
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
  // The action button row comes before the section's own heading button.
  const button = tunePage().getByRole('button', { name: LYRICS_SECTION, exact: true }).first()
  await button.click()
  const reader = page.getByRole('dialog', { name: lyricsTitle('Cluck Old Hen') })
  await expect.element(reader.getByText('My old hen', { exact: true })).toBeVisible()
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
  await userEvent.keyboard('{Escape}')
  await expect.element(reader).not.toBeInTheDocument()
  await expect.element(button).toHaveFocus()
})

it("the Lyrics section's Edit opens the tune form at the lyrics", async () => {
  const db = openTestDb()
  await seedWithLyrics(db)
  const launcher = { open: vi.fn<TuneFormLauncher['open']>() }
  await renderApp({ path: '/catalog/t1', db, frame: PHONE, launcher })
  await tunePage()
    .getByRole('region', { name: LYRICS_SECTION })
    .getByRole('button', { name: EDIT_LYRICS, exact: true })
    .click()
  await expect.poll(() => launcher.open.mock.calls).toEqual([[{ tuneId: 't1', focus: 'lyrics' }]])
})

it("the Lyrics section's reader button opens the reader", async () => {
  const db = openTestDb()
  await seedWithLyrics(db)
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await tunePage()
    .getByRole('region', { name: LYRICS_SECTION })
    .getByRole('button', { name: OPEN_LYRICS, exact: true })
    .click()
  const reader = page.getByRole('dialog', { name: lyricsTitle('Cluck Old Hen') })
  await expect.element(reader.getByText('My old hen', { exact: true })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(reader).not.toBeInTheDocument()
})

it('notes say they save as typed while edited, and Done ends editing', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const notes = tunePage().getByRole('textbox', { name: NOTES_SECTION })
  const hint = tunePage().getByText(NOTES_SAVE_HINT, { exact: true })
  const done = tunePage().getByRole('button', { name: DONE, exact: true })
  await expect.element(notes).toBeVisible()
  expect(hint.query()).toBeNull()
  await notes.click()
  await expect.element(hint).toBeVisible()
  await userEvent.keyboard('Long bow')
  // Tabbing to Done keeps the line, so a keyboard can reach it.
  await userEvent.tab()
  await expect.element(done).toHaveFocus()
  await expect.element(hint).toBeVisible()
  await notes.click()
  await done.click()
  await expect.element(notes).not.toHaveFocus()
  await expect.element(hint).not.toBeInTheDocument()
  await expect.poll(async () => (await db.user_tunes.get('u-t1'))?.notes).toBe('Long bow')
})

it('notes save as typed and report once on blur', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  const analytics = recordingAnalytics()
  await renderApp({
    path: '/catalog/t1',
    db,
    frame: PHONE,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  const notes = tunePage().getByRole('textbox', { name: NOTES_SECTION })
  const elsewhere = tunePage().getByRole('heading', { name: RECORDINGS_SECTION })
  await notes.click()
  await userEvent.keyboard('Long bow')
  await expect.poll(async () => (await db.user_tunes.get('u-t1'))?.notes).toBe('Long bow')
  await userEvent.keyboard(' on the B')
  await expect.poll(async () => (await db.user_tunes.get('u-t1'))?.notes).toBe('Long bow on the B')
  const edits = () => analytics.sends().filter((send) => send.name === 'tune_edited')
  expect(edits()).toEqual([])
  await userEvent.click(elsewhere)
  await expect.element(notes).not.toHaveFocus()
  await expect
    .poll(edits)
    .toEqual([{ name: 'tune_edited', props: { fields_changed: ['notes'], tune_id: 't1' } }])
  // Focusing and leaving with nothing changed reports nothing.
  await notes.click()
  await userEvent.click(elsewhere)
  await expect.element(notes).not.toHaveFocus()
  expect(edits()).toHaveLength(1)
})

it('notes typed and left by leaving the page report once', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  const analytics = recordingAnalytics()
  await renderApp({
    path: '/catalog/t1',
    db,
    frame: PHONE,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  const notes = tunePage().getByRole('textbox', { name: NOTES_SECTION })
  await notes.click()
  await userEvent.keyboard('Long bow')
  await expect.poll(async () => (await db.user_tunes.get('u-t1'))?.notes).toBe('Long bow')
  await expect.element(notes).toHaveFocus()
  // Back is a link, so pressing it from the keyboard leaves while the field keeps focus.
  ;(
    tunePage().getByRole('link', { name: CATALOG.label, exact: true }).element() as HTMLElement
  ).click()
  await expect.element(page.getByRole('main', { name: CATALOG.label })).toBeVisible()
  await expect
    .poll(() => analytics.sends().filter((send) => send.name === 'tune_edited'))
    .toEqual([{ name: 'tune_edited', props: { fields_changed: ['notes'], tune_id: 't1' } }])
})

it('notes typed while a save is held write only the latest text once it lands', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  const actual = await vi.importActual<typeof tunes>('../../commands/tunes')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(updateUserTune).mockImplementationOnce(async (...args) => {
    await gate
    return actual.updateUserTune(...args)
  })
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const notes = tunePage().getByRole('textbox', { name: NOTES_SECTION })
  await notes.click()
  await userEvent.keyboard('L')
  await expect.poll(() => vi.mocked(updateUserTune).mock.calls.length).toBe(1)
  await userEvent.keyboard('ong bow')
  await expect.element(notes).toHaveValue('Long bow')
  release()
  await expect.poll(async () => (await db.user_tunes.get('u-t1'))?.notes).toBe('Long bow')
  expect(vi.mocked(updateUserTune).mock.calls.map(([, , patch]) => patch)).toEqual([
    { notes: 'L' },
    { notes: 'Long bow' },
  ])
})

it.each([
  ['wide', WIDE, 'column'],
  ['phone', PHONE, 'card'],
] as const)('shows the attributes as a %s layout', async (_, frame, layout) => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame })
  const recordings = tunePage().getByRole('region', { name: RECORDINGS_SECTION })
  await expect.element(recordings).toBeVisible()
  if (layout === 'column') {
    const column = tunePage().getByRole('complementary', { name: ATTRIBUTES_LABEL })
    await expect.element(column).toBeVisible()
    // Beside the content, on its trailing side, with their tops level.
    await expect
      .poll(() => column.element().getBoundingClientRect().left)
      .toBeGreaterThanOrEqual(recordings.element().getBoundingClientRect().right)
    await expect
      .poll(() => column.element().getBoundingClientRect().top)
      .toBeLessThanOrEqual(recordings.element().getBoundingClientRect().top)
  } else {
    const card = tunePage().getByRole('region', { name: ATTRIBUTES_LABEL })
    await expect.element(card).toBeVisible()
    expect(
      tunePage().getByRole('complementary', { name: ATTRIBUTES_LABEL }).elements(),
    ).toHaveLength(0)
    // Above the content.
    await expect
      .poll(() => card.element().getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(recordings.element().getBoundingClientRect().top)
  }
})

it('asks before a delete and goes back to the parent once it lands', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Forked Deer')
  const { router } = await renderApp({ path: '/catalog', db, frame: PHONE })
  await page.getByRole('row', { name: /Forked Deer/ }).click()
  await expect.element(pageTitle()).toHaveTextContent('Forked Deer')
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: DELETE }).click()
  const dialog = page.getByRole('alertdialog', { name: deleteTuneTitle('Forked Deer') })
  await expect.element(dialog).toHaveTextContent(deleteTuneMessage([]))
  await dialog.getByRole('button', { name: DELETE }).click()
  await expect.poll(path(router)).toBe(CATALOG.root)
  // Back, not a replace, so history holds the catalog once and no entry for the gone tune.
  expect(router.state.historyAction).toBe('POP')
  await expect.poll(async () => (await db.tunes.get('t1'))?.deleted_at).toBeTruthy()
})

it('leaves for the parent without an error when the tune is deleted elsewhere', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Angeline the Baker')
  const { router } = await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await expect.element(pageTitle()).toHaveTextContent('Angeline the Baker')
  await deleteTune(db, 't1')
  await expect.poll(path(router)).toBe(CATALOG.root)
  await expect
    .element(
      page
        .getByRole('region', { name: CATALOG.label })
        .or(page.getByRole('main', { name: CATALOG.label })),
    )
    .toBeVisible()
  expect(page.getByRole('alert').elements()).toHaveLength(0)
})

it('plays a recording when its row is tapped', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Old Joe Clark')
  await db.recordings.put(recordingRow('r1', { tune_id: 't1', label: 'Fast take' }))
  await db.recording_files.put(
    recordingFile('r1', { blob: new Blob(['x'], { type: 'audio/mp4' }) }),
  )
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const row = tunePage().getByRole('row', { name: new RegExp(`^${PLAY} Fast take`) })
  await expect.element(row).toBeVisible()
  await row.click()
  await expect
    .element(tunePage().getByRole('row', { name: new RegExp(`^${CLOSE_PLAYER} Fast take`) }))
    .toBeVisible()
})

it("folds a free plan's recordings into one line that opens to dimmed rows", async () => {
  const db = openTestDb()
  await db.entitlements.put(entitlementRow())
  await seedTune(db, 't1', 'Old Joe Clark')
  for (const n of [1, 2, 3]) {
    await db.recordings.put(
      recordingRow(`r${n}`, { tune_id: 't1', label: `Take ${n}`, position: n }),
    )
    await db.recording_files.put(
      recordingFile(`r${n}`, { blob: new Blob(['x'], { type: 'audio/mp4' }) }),
    )
  }
  await db.recording_links.put(
    linkRow('l1', 't1', {
      title: 'Henry Reed',
      provider: 'youtube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      provider_ref: 'dQw4w9WgXcQ',
    }),
  )
  const player = fakePlayer()
  const analytics = recordingAnalytics()
  await renderApp({
    path: '/catalog/t1',
    db,
    frame: PHONE,
    player,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  const section = tunePage().getByRole('region', { name: RECORDINGS_SECTION })
  const line = section.getByRole('button', { name: recordingsLine(3) })
  await expect.element(line).toHaveAttribute('aria-expanded', 'false')
  const recordingRows = section.getByRole('row', { name: /Take \d/ })
  await expect.element(section.getByRole('row', { name: /Henry Reed/ })).toBeVisible()
  await expect.poll(() => recordingRows.elements().length).toBe(0)

  await line.click()
  await expect.element(line).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => recordingRows.elements().length).toBe(3)
  for (const row of recordingRows.elements()) {
    await expect.element(row).toHaveAttribute('data-dimmed')
  }

  // A gated row's name drops the action label its tap will not do.
  const gatedRow = section.getByRole('row', { name: /^Take 1/ })
  await expect.element(gatedRow).toHaveAccessibleDescription(SUBSCRIBE_TO_PLAY)
  await gatedRow.click({ button: 'right' })
  await expect.element(page.getByRole('menuitem', { name: EDIT })).toBeVisible()
  await expect.element(page.getByRole('menuitem', { name: DELETE })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menuitem', { name: EDIT })).not.toBeInTheDocument()

  await gatedRow.click()
  await expect
    .element(
      page
        .getByRole('dialog', { name: PREMIUM_RECORDINGS_TITLE })
        .getByRole('heading', { name: PREMIUM_RECORDINGS_TITLE }),
    )
    .toBeVisible()
  expect(player.play).not.toHaveBeenCalled()
  await expect
    .poll(() => analytics.sends().filter((send) => send.name === 'premium_sheet_shown'))
    .toEqual([
      { name: 'premium_sheet_shown', props: { reason: 'recordings', from: 'recordings_line' } },
    ])
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('dialog', { name: PREMIUM_RECORDINGS_TITLE }))
    .not.toBeInTheDocument()

  await section.getByRole('row', { name: new RegExp(`^${PLAY} Henry Reed`) }).click()
  await expect.poll(() => vi.mocked(player.play).mock.calls.length).toBe(1)
  expect(vi.mocked(player.play).mock.calls[0]![0]).toEqual({ kind: 'link', id: 'l1' })
})

it('keeps a tune on screen on wide until the next one has read', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Arkansas Traveler')
  await seedTune(db, 't2', 'Bonaparte’s Retreat')
  const { router } = await renderApp({ path: '/catalog/t1', db, frame: WIDE })
  await expect.element(pageTitle()).toHaveTextContent('Arkansas Traveler')

  const main = tunePage().element()
  // A page that has read shows its sections, not its title alone.
  const titled = () =>
    [...main.querySelectorAll('h1')].some(
      (h1) =>
        h1.checkVisibility() &&
        ['Arkansas Traveler', 'Bonaparte’s Retreat'].includes(h1.textContent ?? ''),
    ) &&
    [...main.querySelectorAll('h2')].some(
      (h2) => h2.checkVisibility() && h2.textContent === RECORDINGS_SECTION,
    )
  let blank = false
  const observer = new MutationObserver(() => {
    if (!titled()) blank = true
  })
  observer.observe(main, { subtree: true, childList: true, attributes: true, characterData: true })
  onTestFinished(() => observer.disconnect())

  const types: string[][] = []
  const original = document.startViewTransition.bind(document)
  document.startViewTransition = ((arg: StartViewTransitionOptions) => {
    types.push([...(arg.types ?? [])])
    return original(arg)
  }) as typeof document.startViewTransition
  onTestFinished(() => {
    document.startViewTransition = original
  })

  await router.navigate('/catalog/t2', { replace: true })
  await expect.element(pageTitle()).toHaveTextContent('Bonaparte’s Retreat')
  expect(blank).toBe(false)
  // One transition, the swap's cross-fade; the next page mounting hidden starts none.
  await expect.poll(() => types).toEqual([['tune-swap']])
})

it('gives the row title and the page title one transition name while a tune opens', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Sally Goodin')
  await seedTune(db, 't2', 'Soldier’s Joy')
  await seedTune(db, 't3', 'Sugar Hill')
  await renderApp({ path: '/catalog', db, frame: PHONE })
  // Every element that carries any tune title name, so a second named row would show.
  const named = () =>
    [...document.querySelectorAll<HTMLElement>('*')]
      .filter(
        (el) =>
          el.checkVisibility() &&
          getComputedStyle(el).viewTransitionName.startsWith(tuneTitleTransition('')),
      )
      .map((el) => `${el.tagName} ${getComputedStyle(el).viewTransitionName}`)
  const seen: { before: string[]; after: string[] }[] = []
  const original = document.startViewTransition.bind(document)
  document.startViewTransition = ((arg: StartViewTransitionOptions) => {
    const before = named()
    const update = arg.update
    return original({
      ...arg,
      update: async () => {
        await update?.()
        seen.push({ before, after: named() })
      },
    })
  }) as typeof document.startViewTransition
  onTestFinished(() => {
    document.startViewTransition = original
  })

  await page.getByRole('row', { name: /Sally Goodin/ }).click()
  await expect.element(pageTitle()).toHaveTextContent('Sally Goodin')
  await expect.poll(() => seen.length).toBeGreaterThan(0)
  expect(seen[0]!.before).toEqual([`SPAN ${tuneTitleTransition('t1')}`])
  expect(seen[0]!.after).toEqual([`H1 ${tuneTitleTransition('t1')}`])
})

it('names neither title for a transition on wide, where the list stays', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Sally Goodin')
  await renderApp({ path: '/catalog', db, frame: WIDE })
  const row = page.getByRole('row', { name: /Sally Goodin/ })
  await row.click()
  await expect.element(pageTitle()).toHaveTextContent('Sally Goodin')
  const title = row.element().querySelector('[data-row-title]')!
  expect(getComputedStyle(title).viewTransitionName).toBe('none')
  // The page title lifts with the page instead.
  expect(getComputedStyle(pageTitle().element()).viewTransitionName).toBe('none')
})

it('leaves for the parent without a view transition', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Sally Goodin')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await expect.element(pageTitle()).toHaveTextContent('Sally Goodin')
  let started = 0
  const original = document.startViewTransition.bind(document)
  document.startViewTransition = ((arg: StartViewTransitionOptions) => {
    started++
    return original(arg)
  }) as typeof document.startViewTransition
  onTestFinished(() => {
    document.startViewTransition = original
  })
  await tunePage().getByRole('link', { name: CATALOG.label, exact: true }).click()
  await expect.element(page.getByRole('main', { name: CATALOG.label })).toBeVisible()
  expect(started).toBe(0)
})

it.each([
  ['phone', PHONE, 'touch'],
  ['wide', WIDE, 'pointer'],
] as const)('lines rows up with the section headings on %s', async (_, frame, density) => {
  const db = openTestDb()
  await seedTune(db, 't1', "Soldier's Joy", {
    lyrics: 'Grasshopper sitting on a sweet potato vine',
  })
  await db.recordings.put(
    recordingRow('r1', { tune_id: 't1', label: 'Fast take', duration_ms: 90_000 }),
  )
  await db.recording_links.put(
    linkRow('l1', 't1', { title: 'Henry Reed', url: 'https://example.com/joy' }),
  )
  await renderApp({ path: '/catalog/t1', db, frame, density })
  const recordings = tunePage().getByRole('region', { name: RECORDINGS_SECTION })
  await expect.element(recordings.getByText('Henry Reed')).toBeVisible()
  const lyrics = tunePage()
    .getByRole('region', { name: LYRICS_SECTION })
    .getByRole('button', { name: LYRICS_SECTION, exact: true })
  await lyrics.click()
  const verse = tunePage().getByText('Grasshopper sitting on a sweet potato vine', { exact: true })
  await expect.element(verse).toBeVisible()
  const left = (element: Element) => element.getBoundingClientRect().left
  const edge = () => left(recordings.getByRole('heading', { name: RECORDINGS_SECTION }).element())
  const titles = () => [...recordings.element().querySelectorAll('[data-row-title]')]
  await expect.poll(() => titles().length).toBe(2)
  // Titles line up across recordings and links, whether or not a row shows a glyph.
  await expect.poll(() => Math.abs(left(titles()[0]!) - left(titles()[1]!))).toBeLessThan(1)
  const glyph = () => recordings.element().querySelector('[data-media-glyph] svg')!
  await expect.poll(() => Math.abs(left(glyph()) - edge())).toBeLessThan(1.5)
  await expect.poll(() => Math.abs(left(verse.element()) - edge())).toBeLessThan(1)
})

it('saves an attribute typed in an open editor when browser Back leaves the page', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Forked Deer')
  const { router } = await renderApp({ path: '/catalog', db, frame: WIDE })
  await page.getByRole('row', { name: /Forked Deer/ }).click()
  await expect.element(pageTitle()).toHaveTextContent('Forked Deer')
  await tunePage()
    .getByRole('button', { name: attributeRowName(DETAIL_LABELS.composer) })
    .click()
  await page.getByRole('combobox', { name: DETAIL_LABELS.composer }).fill('Kenny Baker')
  await router.navigate(-1)
  await expect.poll(path(router)).toBe(CATALOG.root)
  await expect.poll(async () => (await db.tunes.get('t1'))?.composer).toBe('Kenny Baker')
})

it.each([
  ['tune', (db: CrosstuneDb) => db.tunes.update('t1', { deleted_at: '2026-02-01T00:00:00.000Z' })],
  [
    "tune's user row",
    (db: CrosstuneDb) => db.user_tunes.update('u-t1', { deleted_at: '2026-02-01T00:00:00.000Z' }),
  ],
] as const)(
  'closes an open attribute editor with nothing written when the %s is deleted elsewhere',
  async (_, remove) => {
    const db = openTestDb()
    await seedTune(db, 't1', 'Forked Deer')
    const { router } = await renderApp({ path: '/catalog/t1', db, frame: WIDE })
    await tunePage()
      .getByRole('button', { name: attributeRowName(DETAIL_LABELS.composer) })
      .click()
    const dialog = page.getByRole('dialog', { name: DETAIL_LABELS.composer })
    await page.getByRole('combobox', { name: DETAIL_LABELS.composer }).fill('Someone')
    await remove(db)
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.poll(path(router)).toBe(CATALOG.root)
    expect((await db.tunes.get('t1'))?.composer).toBeNull()
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  },
)
