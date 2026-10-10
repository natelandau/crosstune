import { page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { setInstruments } from '../../commands/settings'
import { createTune } from '../../commands/tunes'
import { STATUS_LABELS } from '../../constants'
import type { CrosstuneDb } from '../../db/schema'
import {
  ADD_TUNE,
  NO_TUNES_HINT,
  NO_TUNES_TITLE,
  SEARCH_TUNES,
  SHOW_ARCHIVED,
  addOfferLabel,
  hiddenMatchText,
  openTuneName,
  TUNE_LIST,
  SELECT_TUNES,
} from './catalogCopy'
import { getMeta, setMeta } from '../../db/meta'
import { DEFAULT_FILTERS, META_CATALOG_FILTERS, normalizeFilters, tuneCountLabel } from './filters'
import { CATALOG_SORT_OPTIONS } from './catalogSort'
import { setCatalogSort } from './useCatalogSort'
import { IMPORT_TUNES } from '../import/importCopy'
import { countTunes } from '../selection/copy'
import { selectedTitle } from '../selection/selectionCopy'
import { ARCHIVE, ARCHIVED } from '../tune/archiveLabels'
import { DELETE_TUNE_TITLE, deleteTuneMessage } from '../tune/deleteTuneMessage'
import { EDIT_TUNE } from '../tune/tuneScreenCopy'
import { openTestDb } from '../../test/db'
import { viewTransitionsDone } from '../../test/viewTransitions'
import { FILTERS } from '../../ui/filterCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { CLEAR_SEARCH } from '../../ui/searchCopy'
import { SORT, sortControlName } from '../../ui/sortCopy'
import { TUNE } from '../tune/tunePageCopy'
import { destination } from '../../app/destinations'
import { COLUMN_WIDTH } from '../../app/Columns'
import { renderApp } from '../../test/renderApp'
import type { TuneFormLauncher } from '../tune/formLauncher'
import { DELETE } from '../../ui/Confirm'

import { FILTER_ROW } from './CatalogFilterRow'
import { STATUS_SCOPE, statusControlLabel } from './scope'
import { SIDEBAR } from '../../app/Sidebar'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }

const CATALOG = destination('catalog').label

interface Seeded {
  ids: Record<string, string>
}

/** Four visible tunes, out of title order, and one archived. */
async function seed(db: CrosstuneDb): Promise<Seeded> {
  const ids: Record<string, string> = {}
  const add = async (
    title: string,
    tune: Parameters<typeof createTune>[1] = { title },
    status: 'known' | 'learning' | 'want_to_learn' = 'known',
  ) => {
    ids[title] = (await createTune(db, { ...tune, title }, { status })).tuneId
  }
  await add("Soldier's Joy", { title: '', key: 'D', modes: ['major'] })
  await add('Cluck Old Hen', { title: '', key: 'A', modes: ['dorian'] }, 'learning')
  await add('Angeline the Baker', { title: '', key: 'D' }, 'want_to_learn')
  await add('Forked Deer', { title: '', key: 'D' })
  await add('Old Joe Clark', { title: '', key: 'A', modes: ['mixolydian'] })
  await db.user_tunes
    .where('tune_id')
    .equals(ids['Old Joe Clark']!)
    .modify({ archived_at: '2026-01-01T00:00:00.000Z' })
  return { ids }
}

function spyLauncher() {
  return { open: vi.fn<TuneFormLauncher['open']>() }
}

async function mount(
  db: CrosstuneDb,
  {
    path = '/catalog',
    frame = PHONE,
    density = 'pointer' as 'pointer' | 'touch',
    wrap,
  }: {
    path?: string
    frame?: { width: number; height: number }
    density?: 'pointer' | 'touch'
    wrap?: Parameters<typeof renderApp>[0]['wrap']
  } = {},
) {
  const launcher = spyLauncher()
  const app = await renderApp({
    path,
    db,
    frame,
    density,
    launcher,
    wrap,
  })
  return { ...app, launcher }
}

// A plain string with quotes in it does not survive the text locator's own quoting.
const literally = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

const tunes = () => page.getByRole('grid', { name: TUNE_LIST })
const row = (title: string) => tunes().getByRole('row', { name: new RegExp(title) })
const rowTitles = () =>
  tunes()
    .getByRole('row')
    .elements()
    .map((e) => e.querySelector('[data-row-title]')?.textContent)
const search = () => page.getByRole('searchbox', { name: SEARCH_TUNES })
const tunePage = () => page.getByRole('main', { name: TUNE })
const title = () => page.getByRole('heading', { level: 1 })

it('lists tunes in title order with their key pills', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db)
  await expect.element(row('Soldier')).toBeVisible()
  await expect
    .poll(rowTitles)
    .toEqual(['Angeline the Baker', 'Cluck Old Hen', 'Forked Deer', "Soldier's Joy"])
  await expect.element(row('Cluck Old Hen').getByText('A dor', { exact: true })).toBeVisible()
  await expect.element(row('Forked Deer').getByText('D', { exact: true })).toBeVisible()
  await expect.element(page.getByText(countTunes(4), { exact: true })).toBeVisible()
})

it('says each part of a row apart, with the tunings for the instruments played', async () => {
  const db = openTestDb()
  await createTune(
    db,
    {
      title: 'Bonaparte',
      key: 'A',
      modes: ['dorian'],
      tunings: { violin: { tuning: 'Cross A (AEAE)' } },
    },
    { status: 'learning' },
  )
  await setInstruments(db, 'user_1', ['violin'])
  await mount(db)
  await expect
    .element(row('Bonaparte'))
    .toHaveAccessibleName('Bonaparte, Key A dorian, Learning, Cross A (AEAE)')
})

it('opens a tune beside the list on wide', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  const { router } = await mount(db, { frame: WIDE })
  await row('Forked Deer').click()
  await expect.element(tunePage()).toBeVisible()
  await expect.element(tunes()).toBeVisible()
  expect(router.state.location.pathname).toBe(`/catalog/${ids['Forked Deer']}`)
  await expect.element(row('Forked Deer')).toHaveAttribute('aria-selected', 'true')
})

it('keeps a tune open when its row is clicked again on wide', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  const { router } = await mount(db, { frame: WIDE })
  await row('Forked Deer').click()
  await expect.element(tunePage()).toBeVisible()
  await row('Forked Deer').click()
  await expect.element(row('Forked Deer')).toHaveAttribute('aria-selected', 'true')
  await expect.element(tunePage()).toBeVisible()
  // The next tune replaces this one, and one step back is the list, so the second click left
  // no entry of its own.
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${ids["Soldier's Joy"]}`)
  await router.navigate(-1)
  await expect.poll(() => router.state.location.pathname).toBe('/catalog')
})

it('pushes a tune on the phone', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  const { router } = await mount(db)
  await row('Forked Deer').click()
  await expect.element(tunePage()).toBeVisible()
  await expect.element(tunes()).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe(`/catalog/${ids['Forked Deer']}`)
  expect(router.state.historyAction).toBe('PUSH')
})

it('walks the rows with the arrows on wide, and the page follows without filling history', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  const { router } = await mount(db, { frame: WIDE })
  await row('Angeline').click()
  await expect
    .poll(() => router.state.location.pathname)
    .toBe(`/catalog/${ids['Angeline the Baker']}`)
  expect(router.state.historyAction).toBe('PUSH')
  // Selection follows the arrows only once a tune is open, and the router moves before React
  // commits the open page, so each key waits for the committed row before the next.
  await expect.element(row('Angeline')).toHaveAttribute('aria-selected', 'true')
  await expect.element(row('Angeline')).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${ids['Cluck Old Hen']}`)
  await expect.element(row('Cluck Old Hen')).toHaveAttribute('aria-selected', 'true')
  await expect.element(row('Cluck Old Hen')).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${ids['Forked Deer']}`)
  expect(router.state.historyAction).toBe('REPLACE')
  await expect.element(row('Forked Deer')).toHaveAttribute('aria-selected', 'true')
  await expect.element(row('Forked Deer')).toHaveFocus()
  await router.navigate(-1)
  await expect.poll(() => router.state.location.pathname).toBe('/catalog')
})

it('sets the status from the phone title, and the scope survives a reload', async () => {
  const db = openTestDb()
  await seed(db)
  const first = await mount(db)
  const trigger = title().getByRole('button', { name: CATALOG })
  await trigger.click()
  const learning = page.getByRole('menuitemradio', { name: STATUS_LABELS.learning, exact: true })
  await expect.element(learning).toHaveAccessibleDescription(countTunes(1))
  await expect
    .element(page.getByRole('menuitemradio', { name: CATALOG, exact: true }))
    .toHaveAttribute('aria-checked', 'true')
  await learning.click()
  await expect.element(title()).toHaveTextContent(STATUS_LABELS.learning)
  await expect.poll(rowTitles).toEqual(['Cluck Old Hen'])
  await expect
    .poll(async () => normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null)).status)
    .toBe('learning')
  first.unmount()

  const phone = await mount(db)
  await expect.element(title()).toHaveTextContent(STATUS_LABELS.learning)
  phone.unmount()

  await mount(db, { frame: WIDE })
  await expect
    .element(
      page
        .getByRole('navigation', { name: SIDEBAR })
        .getByRole('button', { name: STATUS_LABELS.learning, exact: true }),
    )
    .toHaveAttribute('aria-current', 'page')
  await expect.element(title()).toHaveTextContent(STATUS_LABELS.learning)
})

it("shares one status between the phone's capsule and title and the sidebar", async () => {
  const db = openTestDb()
  await seed(db)
  const capsule = (status: Parameters<typeof statusControlLabel>[0]) =>
    page
      .getByRole('group', { name: FILTER_ROW })
      .getByRole('button', { name: statusControlLabel(status), exact: true })
  const phone = await mount(db)
  await capsule('all').click()
  await page.getByRole('menuitemradio', { name: STATUS_LABELS.learning, exact: true }).click()
  await expect.element(title()).toHaveTextContent(STATUS_LABELS.learning)
  await expect.element(capsule('learning')).toHaveAttribute('data-set')
  // The first menu fades out before the next one opens.
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await title().getByRole('button', { name: STATUS_LABELS.learning }).click()
  await page.getByRole('menuitemradio', { name: STATUS_LABELS.known, exact: true }).click()
  await expect.element(capsule('known')).toHaveAttribute('data-set')
  phone.unmount()

  await mount(db, { frame: WIDE })
  const sidebar = page.getByRole('navigation', { name: SIDEBAR })
  await expect
    .element(sidebar.getByRole('button', { name: STATUS_LABELS.known, exact: true }))
    .toHaveAttribute('aria-current', 'page')
  await sidebar.getByRole('button', { name: STATUS_LABELS.want_to_learn, exact: true }).click()
  await expect.poll(rowTitles).toEqual(['Angeline the Baker'])
  await expect.element(page.getByRole('group', { name: FILTER_ROW })).toBeVisible()
  await expect.element(capsule('want_to_learn')).not.toBeInTheDocument()
})

it('sets the status from the phone title through an action sheet on touch', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db, { density: 'touch' })
  await title().getByRole('button', { name: CATALOG }).click()
  const sheet = page.getByRole('dialog', { name: STATUS_SCOPE })
  await expect.element(sheet).toBeVisible()
  await expect
    .element(sheet.getByRole('menuitemradio', { name: CATALOG, exact: true }))
    .toHaveAttribute('aria-checked', 'true')
  await sheet.getByRole('menuitemradio', { name: STATUS_LABELS.learning, exact: true }).click()
  await expect.element(title()).toHaveTextContent(STATUS_LABELS.learning)
  await expect.poll(rowTitles).toEqual(['Cluck Old Hen'])
  // It opens again on the status chosen, not the first.
  await title().getByRole('button', { name: STATUS_LABELS.learning }).click()
  await expect
    .element(sheet.getByRole('menuitemradio', { name: STATUS_LABELS.learning, exact: true }))
    .toHaveFocus()
})

it('never opens a tune when Tab moves into the list on wide', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  const { router } = await mount(db, { frame: WIDE })
  await expect.element(row('Angeline')).toBeVisible()
  // The filter row's last control sits just before the sort button and the rows.
  page.getByRole('button', { name: FILTERS, exact: true }).element().focus()
  await userEvent.keyboard('{Tab}{Tab}')
  await expect.element(row('Angeline')).toHaveFocus()
  expect(router.state.location.pathname).toBe('/catalog')
  page.getByRole('separator', { name: COLUMN_WIDTH }).element().focus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(tunes().getByRole('row').first()).toHaveFocus()
  expect(router.state.location.pathname).toBe('/catalog')
  row('Angeline').element().focus()
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => router.state.location.pathname)
    .toBe(`/catalog/${ids['Angeline the Baker']}`)
  await expect.element(row('Angeline')).toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${ids['Cluck Old Hen']}`)
  expect(router.state.historyAction).toBe('REPLACE')
})

it('walks two rows on two quick arrow presses on wide', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  const { router } = await mount(db, { frame: WIDE })
  await expect.element(row('Angeline')).toBeVisible()
  row('Angeline').element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(row('Angeline')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(viewTransitionsDone).toBe(true)
  // React holds every commit while a view transition runs, so a keyboard pick starts none.
  let started = 0
  const original = document.startViewTransition.bind(document)
  document.startViewTransition = ((arg: StartViewTransitionOptions) => {
    started++
    return original(arg)
  }) as typeof document.startViewTransition
  onTestFinished(() => {
    document.startViewTransition = original
  })
  await userEvent.keyboard('{ArrowDown}{ArrowDown}')
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${ids['Forked Deer']}`)
  await expect
    .element(tunePage().getByRole('heading', { level: 1 }))
    .toHaveTextContent('Forked Deer')
  expect(started).toBe(0)
})

it('announces a new count when the scope changes, never while typing', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db)
  const live = () =>
    document.querySelector('[data-column="list"] [aria-live="polite"]')?.textContent
  await expect.element(row('Soldier')).toBeVisible()
  expect(live()).toBe('')
  await search().fill('o')
  await expect.poll(() => rowTitles().length).toBeLessThan(4)
  expect(live()).toBe('')
  await search().fill('')
  await title().getByRole('button', { name: CATALOG }).click()
  await page.getByRole('menuitemradio', { name: STATUS_LABELS.learning, exact: true }).click()
  await expect.poll(live).toBe(tuneCountLabel(1, 4))
})

it('offers to add another tune by a title already taken', async () => {
  const db = openTestDb()
  await seed(db)
  const { launcher } = await mount(db)
  await search().fill('Forked Deer')
  await page
    .getByRole('button', {
      name: addOfferLabel({ kind: 'create', title: 'Forked Deer', another: true }),
    })
    .click()
  await expect
    .poll(() => launcher.open)
    .toHaveBeenCalledWith({ source: 'search_offer', initialTitle: 'Forked Deer' })
})

it('names an exact match the filters hide', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  await setMeta(db, META_CATALOG_FILTERS, { ...DEFAULT_FILTERS, status: 'learning' })
  const { router } = await mount(db)
  await search().fill('Forked Deer')
  const hidden = {
    entry: { tune: { title: 'Forked Deer' } },
    reason: 'filtered',
  } as Parameters<typeof hiddenMatchText>[0]
  await expect.element(page.getByText(literally(hiddenMatchText(hidden)))).toBeVisible()
  await page.getByRole('link', { name: openTuneName('Forked Deer') }).click()
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${ids['Forked Deer']}`)
})

it('opens the only result on Enter', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  const { router } = await mount(db)
  await search().fill('cluck')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${ids['Cluck Old Hen']}`)
})

it('adds a tune by the typed title on Enter when nothing matches', async () => {
  const db = openTestDb()
  await seed(db)
  const { launcher, router } = await mount(db)
  await search().fill('Sally Goodin')
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => launcher.open)
    .toHaveBeenCalledWith({ source: 'search_offer', initialTitle: 'Sally Goodin' })
  await expect.element(search()).toHaveValue('')
  expect(router.state.location.pathname).toBe('/catalog')
})

it('only closes the keyboard on Enter with two or more results', async () => {
  const db = openTestDb()
  await seed(db)
  const { launcher, router } = await mount(db)
  await search().fill('o')
  await expect.poll(() => rowTitles().length).toBeGreaterThan(1)
  await userEvent.keyboard('{Enter}')
  await expect.element(search()).not.toHaveFocus()
  expect(router.state.location.pathname).toBe('/catalog')
  expect(launcher.open).not.toHaveBeenCalled()
})

it('names an exact match the archived setting hides, opens it from Open, and on Enter', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  const { router } = await mount(db)
  await search().fill('Old Joe Clark')
  const outcome = {
    entry: { tune: { title: 'Old Joe Clark' } },
    reason: 'archived',
  } as Parameters<typeof hiddenMatchText>[0]
  await expect.element(page.getByText(literally(hiddenMatchText(outcome)))).toBeVisible()
  await page.getByRole('link', { name: openTuneName('Old Joe Clark') }).click()
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${ids['Old Joe Clark']}`)
  // The page pushes in by a view transition, and React holds the next navigation until it
  // ends, so the catalog the search types into is back only after that.
  await expect.element(tunePage().getByRole('heading', { level: 1 })).toBeVisible()
  await expect.poll(viewTransitionsDone).toBe(true)

  await router.navigate('/catalog')
  await search().fill('Old Joe Clark')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${ids['Old Joe Clark']}`)
})

it('offers to add the typed title under the results', async () => {
  const db = openTestDb()
  await seed(db)
  const { launcher } = await mount(db)
  await search().fill('Joy')
  await expect.element(row('Soldier')).toBeVisible()
  const offer = page.getByRole('button', {
    name: addOfferLabel({ kind: 'create', title: 'Joy', another: false }),
  })
  await offer.click()
  await expect
    .poll(() => launcher.open)
    .toHaveBeenCalledWith({ source: 'search_offer', initialTitle: 'Joy' })
  await expect.element(search()).toHaveValue('')
})

it(`opens the tune form with the title from the empty state's Add`, async () => {
  const db = openTestDb()
  await createTune(db, { title: 'Forked Deer' }, { status: 'known' })
  const { launcher } = await mount(db)
  await search().fill("Soldier's Joy")
  await page
    .getByRole('button', {
      name: addOfferLabel({ kind: 'create', title: "Soldier's Joy", another: false }),
    })
    .click()
  await expect
    .poll(() => launcher.open)
    .toHaveBeenCalledWith({ source: 'search_offer', initialTitle: "Soldier's Joy" })
})

it('opens an empty tune form from Add', async () => {
  const db = openTestDb()
  await seed(db)
  const { launcher } = await mount(db)
  await page.getByRole('button', { name: ADD_TUNE }).click()
  await expect.poll(() => launcher.open).toHaveBeenCalledWith({ source: 'catalog' })
})

it('invites the first tune into an empty catalog', async () => {
  const { launcher } = await mount(openTestDb())
  await expect.element(page.getByRole('heading', { name: NO_TUNES_TITLE })).toBeVisible()
  await expect.element(page.getByText(NO_TUNES_HINT)).toBeVisible()
  const main = page.getByRole('main', { name: CATALOG })
  await main.getByRole('button', { name: ADD_TUNE }).last().click()
  await expect.poll(() => launcher.open).toHaveBeenCalledWith({ source: 'catalog' })
})

it('offers import in an empty catalog', async () => {
  const db = openTestDb()
  const analytics = recordingAnalytics()
  const { unmount } = await mount(db, {
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  const main = page.getByRole('main', { name: CATALOG })
  const offer = main.getByRole('button', { name: IMPORT_TUNES })
  await expect.element(offer).toBeVisible()
  await offer.click()
  await expect.element(page.getByRole('dialog', { name: IMPORT_TUNES })).toBeVisible()
  await expect
    .poll(() => analytics.sends().filter((send) => send.name === 'import_started'))
    .toEqual([{ name: 'import_started', props: { entry: 'empty_catalog' } }])
  await unmount()
  await seed(db)
  await mount(db)
  await expect.element(tunes()).toBeVisible()
  await expect.element(page.getByRole('button', { name: IMPORT_TUNES })).not.toBeInTheDocument()
})

it('hides archived tunes until Show archived, then dims them', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db)
  await expect.element(row('Soldier')).toBeVisible()
  await expect.element(row('Old Joe Clark')).not.toBeInTheDocument()
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  const show = page.getByRole('menuitemcheckbox', { name: SHOW_ARCHIVED })
  await expect.element(show).toHaveAttribute('aria-checked', 'false')
  await show.click()
  await expect.element(row('Old Joe Clark')).toBeVisible()
  await expect.element(row('Old Joe Clark')).toHaveAccessibleName(new RegExp(ARCHIVED))
  await expect.poll(() => getComputedStyle(row('Old Joe Clark').element()).opacity).toBe('0.6')
  expect(getComputedStyle(row('Forked Deer').element()).opacity).toBe('1')
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await expect
    .element(page.getByRole('menuitemcheckbox', { name: SHOW_ARCHIVED }))
    .toHaveAttribute('aria-checked', 'true')
})

it('holds Select tunes in More, which starts selecting', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db)
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_TUNES }).click()
  await expect.element(page.getByText(selectedTitle(0), { exact: true })).toBeVisible()
})

it('edits, archives, and deletes a tune from its row', async () => {
  const db = openTestDb()
  const { ids } = await seed(db)
  const { launcher } = await mount(db)
  await row('Forked Deer').click({ button: 'right' })
  await page.getByRole('menuitem', { name: EDIT_TUNE }).click()
  await expect
    .poll(() => launcher.open)
    .toHaveBeenCalledWith({ source: 'catalog', tuneId: ids['Forked Deer'] })

  await row('Forked Deer').click({ button: 'right' })
  await page.getByRole('menuitem', { name: ARCHIVE }).click()
  await expect.element(row('Forked Deer')).not.toBeInTheDocument()

  await row('Cluck Old Hen').click({ button: 'right' })
  await page.getByRole('menuitem', { name: DELETE }).click()
  const alert = page.getByRole('alertdialog', { name: DELETE_TUNE_TITLE })
  await expect.element(alert).toHaveAccessibleDescription(deleteTuneMessage('Cluck Old Hen', []))
  await alert.getByRole('button', { name: DELETE }).click()
  await expect.element(row('Cluck Old Hen')).not.toBeInTheDocument()
  await expect
    .poll(() => db.tunes.get(ids['Cluck Old Hen']!).then((t) => t?.deleted_at))
    .toBeTruthy()
})

it('walks back to the list when the open tune is deleted from its row on wide', async () => {
  const db = openTestDb()
  await seed(db)
  const { router } = await mount(db, { frame: WIDE })
  const listKey = router.state.location.key
  await row('Forked Deer').click()
  await expect.element(tunePage()).toBeVisible()
  await row('Forked Deer').click({ button: 'right' })
  await page.getByRole('menuitem', { name: DELETE }).click()
  await page
    .getByRole('alertdialog', { name: DELETE_TUNE_TITLE })
    .getByRole('button', { name: DELETE })
    .click()
  await expect.poll(() => router.state.location.pathname).toBe('/catalog')
  // Back to the entry the list was first shown in, so no second list entry sits behind it.
  expect(router.state.historyAction).toBe('POP')
  expect(router.state.location.key).toBe(listKey)
})

it('reverses the order from the sort menu', async () => {
  // The sort is kept per device in memory as well as in storage, so it is put back.
  onTestFinished(() => setCatalogSort({ sort: 'title', descending: false }))
  const db = openTestDb()
  await seed(db)
  await mount(db)
  const byTitle = { sort: 'title', descending: false } as const
  const sort = page.getByRole('button', { name: sortControlName(CATALOG_SORT_OPTIONS, byTitle) })
  await sort.click()
  await expect.element(page.getByRole('menu', { name: SORT })).toBeVisible()
  await page
    .getByRole('menuitemradio', { name: CATALOG_SORT_OPTIONS.labels.title, exact: true })
    .click()
  await expect
    .element(
      page.getByRole('button', {
        name: sortControlName(CATALOG_SORT_OPTIONS, { ...byTitle, descending: true }),
      }),
    )
    .toBeVisible()
  await expect
    .poll(rowTitles)
    .toEqual(["Soldier's Joy", 'Forked Deer', 'Cluck Old Hen', 'Angeline the Baker'])
})

it('shows Clear search only while the field has focus', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db)
  await search().fill('Joy')
  await expect.element(page.getByRole('button', { name: CLEAR_SEARCH })).toBeVisible()
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('button', { name: CLEAR_SEARCH })).not.toBeInTheDocument()
  await search().click()
  await page.getByRole('button', { name: CLEAR_SEARCH }).click()
  await expect.element(search()).toHaveValue('')
})

it('gives a title its full width in the default wide column while actions rest', async () => {
  const db = openTestDb()
  await createTune(db, { title: 'Billy in the Lowground', key: 'C' }, { status: 'learning' })
  await mount(db, { frame: WIDE })
  const title = () => row('Billy in the Lowground').element().querySelector('[data-row-title]')!
  await expect.element(row('Billy in the Lowground')).toBeVisible()
  await document.fonts.ready
  await expect.poll(() => title().scrollWidth <= title().clientWidth).toBe(true)
})

it('shows a row tuning whole or not at all on pointer', async () => {
  const db = openTestDb()
  await setInstruments(db, 'user_1', ['violin', 'five_string_banjo'])
  await createTune(
    db,
    { title: 'Duck River', key: 'A', tunings: { violin: { tuning: 'Cross A (AEAE)' } } },
    { status: 'want_to_learn' },
  )
  await createTune(
    db,
    {
      title: 'Cluck Old Hen',
      key: 'A',
      modes: ['dorian'],
      tunings: {
        violin: { tuning: 'Cross A (AEAE)' },
        five_string_banjo: { tuning: 'Sawmill (gDGCD)' },
      },
    },
    { status: 'learning' },
  )
  await mount(db, { frame: WIDE })
  const detail = (title: string) => row(title).element().querySelector('[data-row-detail]')
  const fit = (title: string) => () => {
    const element = detail(title)
    if (!element) return 'missing'
    const line = element.closest('[data-row-line]')!.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    if (box.top >= line.bottom) return 'hidden'
    return box.bottom <= line.bottom && box.right <= line.right + 0.5 ? 'whole' : 'fragment'
  }
  // A short tuning fits beside a short title, so it must show.
  await expect.poll(fit('Duck River')).toBe('whole')
  await expect.poll(fit('Cluck Old Hen')).toMatch(/^(whole|hidden)$/)
})
