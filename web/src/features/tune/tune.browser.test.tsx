import { page } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import { setInstruments } from '../../commands/settings'
import { deleteTune } from '../../commands/tunes'
import { STATUS_LABELS } from '../../constants'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalTune } from '../../db/types'
import { CLOSE_PLAYER } from '../player/transportCopy'
import { PLAY } from '../recordings/recordingNames'
import { ADD_SCANS, NO_SCANS, SCANS } from '../scans/scanCopy'
import { addToList, createList } from '../../commands/lists'
import { DELETE_TUNE_TITLE, deleteTuneMessage } from './deleteTuneMessage'
import {
  ADD_NOTES,
  EDIT_LYRICS,
  EDIT_NOTES,
  LISTS_SECTION,
  LYRICS_SECTION,
  NO_TUNE_NOTES,
  NO_TUNE_RECORDINGS,
  NOTES_SECTION,
  OPEN_LYRICS,
  RECORDINGS_SECTION,
} from './tuneScreenCopy'
import { openTestDb } from '../../test/db'
import { linkRow, recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { TUNE } from './tunePageCopy'
import { destination } from '../../app/destinations'
import { renderApp } from '../../test/renderApp'
import { DELETE } from '../../ui/Confirm'
import type { TuneFormLauncher } from './formLauncher'
import { tuneTitleTransition } from './TuneHeader'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }

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

it('shows the facts a tune holds in its header', async () => {
  const db = openTestDb()
  await setInstruments(db, 'user_1', ['violin'])
  await seedTune(db, 't1', "Soldier's Joy", {
    key: 'D',
    modes: ['major', 'mixolydian'],
    tune_type: 'reel',
    time_signature: '2/2',
    part_structure: 'AABB',
    tunings: { violin: { tuning: 'Cross A (AEAE)' } },
  })
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await expect.element(pageTitle()).toHaveTextContent("Soldier's Joy")
  const header = tunePage()
  for (const fact of ['major', 'mixolydian', 'reel', '2/2', 'AABB']) {
    await expect.element(header.getByText(fact, { exact: true })).toBeVisible()
  }
  await expect.element(header.getByText('D', { exact: true })).toBeVisible()
  await expect.element(header.getByText(/Violin.*Cross A \(AEAE\)/)).toBeVisible()
  await expect.element(header.getByText(STATUS_LABELS.known, { exact: true })).toBeVisible()
})

it('never opens a wrapped facts line with a dot', async () => {
  const db = openTestDb()
  await setInstruments(db, 'user_1', ['violin', 'five_string_banjo'])
  await seedTune(db, 't1', "Soldier's Joy", {
    key: 'D',
    modes: ['major'],
    tune_type: 'Breakdown',
    time_signature: '2/2',
    part_structure: 'AABB',
    genre: 'Old-time',
    tunings: {
      violin: { tuning: 'Standard (GDAE)' },
      five_string_banjo: { tuning: 'Open G (gDGBD)', capo: 2 },
    },
  })
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await expect.element(tunePage().getByText(/5-string banjo/)).toBeVisible()
  const lineStarts = () =>
    [...tunePage().element().querySelectorAll<HTMLElement>('[data-part]')].filter(
      (part, index, parts) => index === 0 || parts[index - 1]!.offsetTop !== part.offsetTop,
    )
  // The tunings do not fit beside the status at this width, so some part opens a new line.
  await expect.poll(() => lineStarts().length).toBeGreaterThan(2)
  for (const part of lineStarts()) {
    const clip = part.parentElement!.parentElement!.getBoundingClientRect().left
    const dot = part.firstElementChild!.getBoundingClientRect()
    expect(dot.right).toBeLessThanOrEqual(clip + 0.5)
  }
})

it.each([
  [RECORDINGS_SECTION, NO_TUNE_RECORDINGS],
  [SCANS, NO_SCANS],
  [NOTES_SECTION, NO_TUNE_NOTES],
])('shows an empty %s section with its heading and an empty state', async (title, empty) => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const section = tunePage().getByRole('region', { name: title })
  await expect.element(section.getByRole('heading', { name: title })).toBeVisible()
  await expect.element(section.getByText(empty, { exact: true })).toBeVisible()
  // The empty state names what is absent under the section's own heading, not as another one.
  expect(section.getByRole('heading').elements()).toHaveLength(1)
})

it('keeps the scans add control in an empty Scans section', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const scans = tunePage().getByRole('region', { name: SCANS })
  await expect.element(scans.getByRole('button', { name: ADD_SCANS })).toBeVisible()
})

it('leaves out the lyrics and lists sections while they hold nothing', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  await expect.element(tunePage().getByRole('heading', { name: RECORDINGS_SECTION })).toBeVisible()
  for (const title of [LYRICS_SECTION, LISTS_SECTION]) {
    expect(tunePage().getByRole('heading', { name: title, exact: true }).elements()).toHaveLength(0)
  }
})

it('shows the lyrics, lists, and notes sections once they hold something', async () => {
  const db = openTestDb()
  await db.tunes.put(tuneRow('t1', 'Cluck Old Hen', { lyrics: 'My old hen' }))
  await db.user_tunes.put(userTuneRow('u-t1', 't1', { notes: 'Lift the B part' }))
  const listId = await createList(db, 'Tuesday jam')
  await addToList(db, listId, 'u-t1')
  const launcher = { open: vi.fn<TuneFormLauncher['open']>() }
  await renderApp({ path: '/catalog/t1', db, frame: PHONE, launcher })
  await expect
    .element(tunePage().getByRole('region', { name: LISTS_SECTION }).getByRole('link'))
    .toHaveTextContent('Tuesday jam')
  // Lists close the page, after the notes.
  expect(
    tunePage()
      .getByRole('heading', { level: 2 })
      .elements()
      .map((heading) => heading.textContent),
  ).toEqual([RECORDINGS_SECTION, SCANS, LYRICS_SECTION, NOTES_SECTION, LISTS_SECTION])
  for (const [title, edit] of [
    [LYRICS_SECTION, EDIT_LYRICS],
    [NOTES_SECTION, EDIT_NOTES],
  ] as const) {
    const section = tunePage().getByRole('region', { name: title })
    await expect.element(section.getByRole('button', { name: edit })).toBeVisible()
  }
  await tunePage().getByRole('button', { name: EDIT_NOTES }).click()
  await expect.poll(() => launcher.open.mock.calls).toEqual([[{ source: 'tune', tuneId: 't1' }]])
})

it('shows a learned date alone in the notes section, with no empty state', async () => {
  const db = openTestDb()
  await db.tunes.put(tuneRow('t1', 'Cluck Old Hen'))
  await db.user_tunes.put(userTuneRow('u-t1', 't1', { learned_from: 'Jim' }))
  await renderApp({ path: '/catalog/t1', db, frame: PHONE })
  const notes = tunePage().getByRole('region', { name: NOTES_SECTION })
  await expect.element(notes.getByText('Learned from Jim')).toBeVisible()
  await expect.element(notes.getByRole('button', { name: ADD_NOTES })).toBeVisible()
  expect(notes.getByText(NO_TUNE_NOTES).elements()).toHaveLength(0)
})

it('adds notes from an empty Notes section through the tune form', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Cluck Old Hen')
  const launcher = { open: vi.fn<TuneFormLauncher['open']>() }
  await renderApp({ path: '/catalog/t1', db, frame: PHONE, launcher })
  const notes = tunePage().getByRole('region', { name: NOTES_SECTION })
  await notes.getByRole('button', { name: ADD_NOTES }).click()
  await expect.poll(() => launcher.open.mock.calls).toEqual([[{ source: 'tune', tuneId: 't1' }]])
})

it('asks before a delete and goes back to the parent once it lands', async () => {
  const db = openTestDb()
  await seedTune(db, 't1', 'Forked Deer')
  const { router } = await renderApp({ path: '/catalog', db, frame: PHONE })
  await page.getByRole('row', { name: /Forked Deer/ }).click()
  await expect.element(pageTitle()).toHaveTextContent('Forked Deer')
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: DELETE }).click()
  const dialog = page.getByRole('alertdialog', { name: DELETE_TUNE_TITLE })
  await expect.element(dialog).toHaveTextContent(deleteTuneMessage('Forked Deer', []))
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
  const lyrics = tunePage().getByText(OPEN_LYRICS, { exact: true })
  await expect.element(lyrics).toBeVisible()
  const left = (element: Element) => element.getBoundingClientRect().left
  const edge = () => left(recordings.getByRole('heading', { name: RECORDINGS_SECTION }).element())
  const titles = () => [...recordings.element().querySelectorAll('[data-row-title]')]
  await expect.poll(() => titles().length).toBe(2)
  // Titles line up across recordings and links, whether or not a row shows a glyph.
  await expect.poll(() => Math.abs(left(titles()[0]!) - left(titles()[1]!))).toBeLessThan(1)
  const glyph = () => recordings.element().querySelector('[data-media-glyph] svg')!
  await expect.poll(() => Math.abs(left(glyph()) - edge())).toBeLessThan(1.5)
  await expect.poll(() => Math.abs(left(lyrics.element()) - edge())).toBeLessThan(1)
})
