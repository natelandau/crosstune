import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SETTINGS_STATS_PATH, statsTunePath } from '../settings/settingsPaths'
import { STATUS_LABELS } from '../../constants'
import { getMeta, setMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { SEARCH_TUNES } from '../catalog/catalogCopy'
import { DEFAULT_FILTERS, FACET_LABELS, META_CATALOG_FILTERS } from '../catalog/filters'
import { readSearchQuery, writeSearchQuery } from '../../ui/searchSession'
import {
  ACTIVITY_HEADER,
  COUNTS_HEADER,
  dayDetail,
  keyCellLabel,
  keyModeCellLabel,
  LEARNING_LABEL,
  rarityLine,
  showAllLabel,
  STATS_TITLE,
  summaryLine,
  tallyLine,
  TUNES_LABEL,
  valueLabel,
} from './copy'
import type { Day, Heatmap as HeatmapData } from './types'
import { openTestDb } from '../../test/db'
import { tuneRow, userTuneRow } from '../../test/rows'
import { destination } from '../../app/destinations'
import { SIDEBAR } from '../../app/Sidebar'
import { TUNE } from '../tune/tunePageCopy'
import { renderWithProviders } from '../../test/render'
import { renderApp } from '../../test/renderApp'
import { Heatmap } from './blocks/Heatmap'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const SETTINGS = destination('settings')
const CATALOG = destination('catalog')

const at = (router: { state: { location: { pathname: string } } }) => () =>
  router.state.location.pathname

async function addTune(
  db: CrosstuneDb,
  id: string,
  title: string,
  tune: Parameters<typeof tuneRow>[2] = {},
  status = 'known',
) {
  await db.tunes.put(tuneRow(id, title, tune))
  await db.user_tunes.put(userTuneRow(`u-${id}`, id, { status }))
}

async function mount(path: string, frame = PHONE, seed?: (db: CrosstuneDb) => Promise<unknown>) {
  const db = openTestDb()
  await seed?.(db)
  const app = await renderApp({ path, db, frame })
  return { ...app, db }
}

const counts = () => page.getByRole('region', { name: COUNTS_HEADER })

it('shows the tune total and the status split with each count', async () => {
  await mount(SETTINGS_STATS_PATH, PHONE, async (db) => {
    await addTune(db, 't1', 'Sally Ann', {}, 'known')
    await addTune(db, 't2', 'Cluck Old Hen', {}, 'known')
    await addTune(db, 't3', 'Angeline the Baker', {}, 'learning')
    await addTune(db, 't4', 'Bonaparte’s Retreat', {}, 'want_to_learn')
  })
  await expect
    .element(page.getByRole('heading', { level: 1, name: STATS_TITLE }))
    .toHaveClass(/t-page-title/)
  await expect.poll(() => counts().query()?.textContent).toMatch(new RegExp(`4\\s*${TUNES_LABEL}`))
  await expect
    .element(counts().getByRole('button', { name: valueLabel(STATUS_LABELS.known, 2) }))
    .toBeVisible()
  await expect
    .element(counts().getByRole('button', { name: valueLabel(STATUS_LABELS.learning, 1) }))
    .toBeVisible()
  await expect
    .element(counts().getByRole('button', { name: valueLabel(STATUS_LABELS.want_to_learn, 1) }))
    .toBeVisible()
  await expect
    .element(counts().getByText(tallyLine({ lists: 0, links: 0, scans: 0, scan_tunes: 0 })))
    .toBeVisible()
})

it('shows a long breakdown’s top 8 and expands it in place to every value', async () => {
  const genres = Array.from({ length: 12 }, (_, i) => `Genre ${String.fromCharCode(65 + i)}`)
  await mount(SETTINGS_STATS_PATH, PHONE, async (db) => {
    for (const [i, genre] of genres.entries()) await addTune(db, `t${i}`, `Tune ${i}`, { genre })
  })
  const block = page.getByRole('region', { name: FACET_LABELS.genre })
  const rows = () => block.getByRole('button', { name: /^Genre / }).elements().length
  await expect.poll(rows).toBe(8)
  const showAll = block.getByRole('button', { name: showAllLabel(12) })
  await showAll.click()
  await expect.poll(rows).toBe(12)
  await expect.element(showAll).not.toBeInTheDocument()
  // The first value it revealed takes focus, so the keyboard carries on where the button was.
  await expect.element(block.getByRole('button', { name: valueLabel(genres[8]!, 1) })).toHaveFocus()
})

it('opens the catalog with only the status chosen, the query cleared, and the sidebar agreeing', async () => {
  writeSearchQuery('catalog', 'reel')
  const { router, db } = await mount(SETTINGS_STATS_PATH, WIDE, async (db) => {
    await setMeta(db, META_CATALOG_FILTERS, {
      ...DEFAULT_FILTERS,
      status: 'known',
      genre: 'Irish',
      archived: true,
    })
    await addTune(db, 't1', 'Sally Ann', { genre: 'Irish' }, 'known')
    await addTune(db, 't2', 'Angeline the Baker', {}, 'learning')
  })
  await counts()
    .getByRole('button', { name: valueLabel(LEARNING_LABEL, 1) })
    .click()
  await expect.poll(at(router)).toBe(CATALOG.root)
  await expect
    .element(
      page
        .getByRole('navigation', { name: SIDEBAR })
        .getByRole('button', { name: LEARNING_LABEL, exact: true }),
    )
    .toHaveAttribute('aria-current', 'page')
  await expect.element(page.getByRole('searchbox', { name: SEARCH_TUNES })).toHaveValue('')
  await expect
    .poll(() => getMeta(db, META_CATALOG_FILTERS, null))
    .toEqual({ ...DEFAULT_FILTERS, status: 'learning' })
  expect(readSearchQuery('catalog')).toBe('')
})

it('filters the catalog by a key alone from its key cell, and by key and mode from a mode cell', async () => {
  const { router, db } = await mount(SETTINGS_STATS_PATH, PHONE, async (db) => {
    await setMeta(db, META_CATALOG_FILTERS, { ...DEFAULT_FILTERS, mode: 'minor' })
    await addTune(db, 't1', 'Sally Ann', { key: 'D', modes: ['major'] })
    await addTune(db, 't2', 'Red Haired Boy', { key: 'D', modes: ['mixolydian'] })
  })
  await page.getByRole('button', { name: keyCellLabel('D', 2) }).click()
  await expect.poll(at(router)).toBe(CATALOG.root)
  await expect
    .poll(() => getMeta(db, META_CATALOG_FILTERS, null))
    .toEqual({ ...DEFAULT_FILTERS, key: 'D' })

  await router.navigate(SETTINGS_STATS_PATH)
  await page.getByRole('button', { name: keyModeCellLabel('D', 'mixolydian', 1) }).click()
  await expect
    .poll(() => getMeta(db, META_CATALOG_FILTERS, null))
    .toEqual({ ...DEFAULT_FILTERS, key: 'D', mode: 'mixolydian' })
})

it('sits in the detail beside the settings on wide, and the stats block leaves a tune as Back', async () => {
  const { router } = await mount(SETTINGS.root, WIDE, async (db) => {
    for (const [i, key] of ['A', 'B', 'C'].entries())
      await addTune(db, `t${i}`, `Tune ${key}`, { key, modes: ['major'] })
  })
  const settings = page.getByRole('region', { name: SETTINGS.label })
  // The block's name goes on to say the split bar's counts.
  const block = settings.getByRole('link', {
    name: new RegExp(`^${summaryLine({ tunes: 3, lists: 0, recordings: 0, scans: 0, ms: 0 })}`),
  })
  await block.click()
  await expect.poll(at(router)).toBe(SETTINGS_STATS_PATH)
  await expect.element(settings.getByRole('grid')).toBeVisible()
  const detail = page.getByRole('main', { name: STATS_TITLE })
  await expect.element(detail.getByRole('heading', { level: 1, name: STATS_TITLE })).toBeVisible()
  // Wide shows the settings beside the page, so it has no Back.
  await expect.element(detail.getByRole('link', { name: SETTINGS.label })).not.toBeInTheDocument()
  const line = rarityLine({ attribute: 'key_mode', value: 'B major', tune_id: 't1' })
  await detail.getByRole('link', { name: new RegExp(`^${line}`) }).click()
  await expect.poll(at(router)).toBe(statsTunePath('t1'))
  await expect
    .element(
      page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1, name: 'Tune B' }),
    )
    .toBeVisible()
  await expect.element(settings.getByRole('grid')).toBeVisible()
  await expect.element(block).toHaveAttribute('aria-current', 'page')

  await block.click()
  await expect.poll(at(router)).toBe(SETTINGS_STATS_PATH)
  expect(router.state.historyAction).toBe('POP')
  await expect.element(detail.getByRole('heading', { level: 1, name: STATS_TITLE })).toBeVisible()
  await router.navigate(-1)
  await expect.poll(at(router)).toBe(SETTINGS.root)
})

it('stands alone on the phone with Back to Settings', async () => {
  const { router } = await mount(SETTINGS_STATS_PATH)
  const back = page.getByRole('main').getByRole('link', { name: SETTINGS.label })
  await expect.element(page.getByRole('heading', { level: 1, name: STATS_TITLE })).toBeVisible()
  // The page keeps to the readable width wherever the column is wider.
  expect(getComputedStyle(page.getByRole('article').element()).maxWidth).toBe('680px')
  await back.click()
  await expect.poll(at(router)).toBe(SETTINGS.root)
})

const blankDay = (date: string, level: Day['level'], recordings: number): Day => ({
  date,
  music_ms: 0,
  plays: 0,
  practice_sessions: 0,
  scan_views: 0,
  tunes_added: 0,
  recordings,
  status_changes: 0,
  level,
})

it('moves the heatmap’s detail line with the arrow keys, a week across and a day down', async () => {
  // Two weeks from a Sunday; every day recorded something, so each one has a detail.
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, 20 + i)).toISOString().slice(0, 10)
    return blankDay(date, ((i % 4) + 1) as Day['level'], i + 1)
  })
  const heatmap: HeatmapData = { visible: true, start: '2026-09-20', days }
  const today = '2026-10-03'
  renderWithProviders(<Heatmap heatmap={heatmap} today={today} />)
  const grid = page.getByRole('group', { name: ACTIVITY_HEADER })
  grid.element().focus()
  const detail = (day: Day) => page.getByText(dayDetail(day, today), { exact: true })
  await userEvent.keyboard('{End}')
  await expect.element(detail(days[13]!)).toBeVisible()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.element(detail(days[6]!)).toBeVisible()
  await userEvent.keyboard('{ArrowUp}')
  await expect.element(detail(days[5]!)).toBeVisible()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(detail(days[12]!)).toBeVisible()
  await expect.element(grid).toHaveFocus()
})
