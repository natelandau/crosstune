import { page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished } from 'vitest'
import { RECORD_LABEL, RECORD_TEXT, TAB_BAR } from './tabs'
import { addToList, createList } from '../commands/lists'
import { createTune } from '../commands/tunes'
import { STATUS_LABELS } from '../constants'
import type { CrosstuneDb } from '../db/schema'
import { getMeta, setMeta } from '../db/meta'
import { META_CATALOG_FILTERS, normalizeFilters } from '../features/catalog/filters'
import { readSearchQuery, writeSearchQuery } from '../features/catalog/searchSession'
import { countTunes } from '../features/selection/copy'
import { OFFLINE } from '../sync/labels'
import { contrastRatio, glyphInk, paintedBackground } from '../test/contrast'
import { openTestDb } from '../test/db'
import { restoreSystemDark, stubSystemDark } from '../test/scheme'
import { destination, DESTINATIONS } from './destinations'
import { renderApp } from '../test/renderApp'
import { TUNE } from '../features/tune/tunePageCopy'
import { CANCEL } from '../ui/Confirm'
import { renderWithProviders } from '../test/render'
import { RecordControl } from './RecordControl'
import { NEW_LIST, SIDEBAR } from './Sidebar'
import { RECORD_UNAVAILABLE } from './recordLauncher'

const PHONE = { width: 390, height: 844 }
const SPLIT = { width: 820, height: 1180 }
const WIDE = { width: 1280, height: 800 }
const CATALOG = destination('catalog')

async function seed(db: CrosstuneDb) {
  await createTune(db, { title: 'Angeline' }, { status: 'known' })
  await createTune(db, { title: 'Arkansas Traveler' }, { status: 'known' })
  const { userTuneId } = await createTune(db, { title: 'Bill Cheatham' }, { status: 'learning' })
  const { userTuneId: archived } = await createTune(db, { title: 'Old' }, { status: 'learning' })
  await db.user_tunes.update(archived, { archived_at: '2026-01-01T00:00:00.000Z' })
  const listId = await createList(db, 'Tuesday jam')
  await addToList(db, listId, userTuneId)
  await createList(db, 'Contest')
}

/** The wash is a translucent color(srgb ...), which the contrast helpers do not read. */
function washOver(wash: string, ground: string): string {
  const [r, g, b, alpha = 1] = (/color\(srgb ([^)]*)\)/.exec(wash)?.[1] ?? '')
    .split(/[\s/]+/)
    .map(Number)
  const [gr, gg, gb] = ground.match(/[\d.]+/g)!.map(Number)
  const mix = (top: number, under: number) => Math.round(top * 255 * alpha + under * (1 - alpha))
  return `rgb(${mix(r!, gr!)}, ${mix(g!, gg!)}, ${mix(b!, gb!)})`
}

const sidebar = () => page.getByRole('navigation', { name: SIDEBAR })

it('holds five tab controls in order with Record in the middle on the phone', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: PHONE })
  const tabs = page.getByRole('navigation', { name: TAB_BAR })
  await expect.element(tabs).toBeVisible()
  const controls = tabs.getByRole('link').or(tabs.getByRole('button'))
  await expect
    .poll(() => controls.elements().map((e) => e.textContent || e.ariaLabel))
    .toEqual(['Catalog', 'Lists', RECORD_LABEL, 'Recordings', 'Settings'])
  await expect
    .element(tabs.getByRole('link', { name: 'Catalog', exact: true }))
    .toHaveAttribute('aria-current', 'page')
  await expect.element(page.getByRole('navigation', { name: SIDEBAR })).not.toBeInTheDocument()
})

it('offers Record with no reason against it', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: PHONE })
  const record = page.getByRole('button', { name: RECORD_LABEL })
  await expect.element(record).toBeEnabled()
  await expect.element(record).not.toHaveAccessibleDescription(RECORD_UNAVAILABLE)
})

it.each([
  ['split', SPLIT],
  ['wide', WIDE],
])('shows the sidebar with counts at the %s frame', async (_name, frame) => {
  const db = openTestDb()
  await seed(db)
  await renderApp({ path: '/catalog', db, frame })
  const bar = sidebar()
  await expect.element(bar.getByRole('link', { name: 'Catalog', exact: true })).toBeVisible()
  await expect
    .element(bar.getByRole('button', { name: STATUS_LABELS.known, exact: true }))
    .toBeVisible()
  await expect
    .element(bar.getByRole('button', { name: STATUS_LABELS.learning, exact: true }))
    .toBeVisible()
  // Zero hides the count, not the row.
  await expect
    .element(bar.getByRole('button', { name: STATUS_LABELS.want_to_learn, exact: true }))
    .toBeVisible()
  await expect.element(bar.getByRole('link', { name: 'Recordings' })).toBeVisible()
  await expect.element(bar.getByRole('link', { name: 'Tuesday jam', exact: true })).toBeVisible()
  await expect.element(bar.getByRole('link', { name: 'Contest', exact: true })).toBeVisible()
  await expect.element(bar.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect.element(bar.getByRole('button', { name: RECORD_LABEL })).toBeVisible()
  await expect.element(page.getByRole('navigation', { name: TAB_BAR })).not.toBeInTheDocument()
})

it('describes each count in words and keeps it out of the name', async () => {
  const db = openTestDb()
  await seed(db)
  await renderApp({ path: '/catalog', db, frame: WIDE })
  const bar = sidebar()
  await expect
    .element(bar.getByRole('link', { name: 'Catalog', exact: true }))
    .toHaveAccessibleDescription(countTunes(3))
  await expect
    .element(bar.getByRole('button', { name: STATUS_LABELS.known, exact: true }))
    .toHaveAccessibleDescription(countTunes(2))
  await expect
    .element(bar.getByRole('button', { name: STATUS_LABELS.learning, exact: true }))
    .toHaveAccessibleDescription(countTunes(1))
  await expect
    .element(bar.getByRole('link', { name: 'Tuesday jam', exact: true }))
    .toHaveAccessibleDescription(countTunes(1))
})

it('counts a status the client does not know as Unknown', async () => {
  const db = openTestDb()
  const { userTuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
  await db.user_tunes.update(userTuneId, { status: 'mystery' })
  await renderApp({ path: '/catalog', db, frame: WIDE })
  await expect
    .element(sidebar().getByRole('button', { name: STATUS_LABELS.want_to_learn, exact: true }))
    .toHaveAccessibleDescription(countTunes(1))
  await expect
    .element(sidebar().getByRole('button', { name: STATUS_LABELS.known, exact: true }))
    .not.toHaveAccessibleDescription(countTunes(1))
})

it.each([
  ['light', false],
  ['dark', true],
])('keeps a selected row count at 4.5:1 in %s', async (_name, dark) => {
  stubSystemDark(dark)
  onTestFinished(restoreSystemDark)
  const db = openTestDb()
  await seed(db)
  await setMeta(db, META_CATALOG_FILTERS, { status: 'learning' })
  await renderApp({ path: '/catalog', db, frame: WIDE })
  const row = sidebar().getByRole('button', { name: STATUS_LABELS.learning, exact: true })
  await expect.element(row).toHaveAttribute('aria-current', 'page')
  await expect.poll(() => document.documentElement.dataset.scheme).toBe(dark ? 'dark' : 'light')
  await expect.poll(() => row.element().querySelector('[data-count]')).not.toBeNull()
  const count = row.element().querySelector('[data-count]')!
  const ground = paintedBackground(row.element().parentElement!)
  expect(
    contrastRatio(
      glyphInk(count),
      washOver(getComputedStyle(row.element()).backgroundColor, ground),
    ),
  ).toBeGreaterThanOrEqual(4.5)
})

it('offers New list on the Lists heading, and shows the capsule label', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE })
  await expect.element(sidebar().getByRole('button', { name: NEW_LIST })).toBeEnabled()
  await expect.element(sidebar().getByText(RECORD_TEXT)).toBeVisible()
})

it('names why Record is unavailable outside the recorder, and disables it', async () => {
  renderWithProviders(<RecordControl shape="capsule" />)
  const record = page.getByRole('button', { name: RECORD_LABEL })
  await expect.element(record).toBeDisabled()
  await expect.element(record).toHaveAccessibleDescription(RECORD_UNAVAILABLE)
})

it('keeps the solid disc of a disabled dome', async () => {
  renderWithProviders(<RecordControl shape="dome" />)
  const dome = page.getByRole('button', { name: RECORD_LABEL })
  await expect.element(dome).toBeDisabled()
  expect(getComputedStyle(dome.element()).opacity).toBe('1')
})

it('marks the Lists heading selected on the Lists root', async () => {
  const db = openTestDb()
  await seed(db)
  await renderApp({ path: '/lists', db, frame: WIDE })
  await expect
    .element(sidebar().getByRole('link', { name: 'Lists', exact: true }))
    .toHaveAttribute('aria-current', 'page')
})

/** Holds every read-write transaction until released, so a test can see what waits on a write. */
function gateWrites(db: CrosstuneDb) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const original = db.transaction.bind(db) as (...args: unknown[]) => Promise<unknown>
  let started = 0
  db.transaction = ((...args: unknown[]) => {
    if (args[0] !== 'rw') return original(...args)
    started++
    return gate.then(() => original(...args))
  }) as typeof db.transaction
  return { release, started: () => started }
}

const catalogShown = () => document.querySelector('section[aria-label="Catalog"]') !== null

/** Resolves 'held' once the catalog has stayed hidden across several polls, 'shown' if it appears. */
function heldHidden() {
  let polls = 0
  return () => {
    if (catalogShown()) return 'shown'
    return ++polls >= 5 ? 'held' : 'waiting'
  }
}

it('opens the catalog from the Catalog row only after the all scope is saved', async () => {
  const db = openTestDb()
  await seed(db)
  await setMeta(db, META_CATALOG_FILTERS, { status: 'learning' })
  await renderApp({ path: '/lists', db, frame: WIDE })
  const writes = gateWrites(db)
  await sidebar().getByRole('link', { name: 'Catalog', exact: true }).click()
  await expect.poll(writes.started).toBeGreaterThan(0)
  await expect.poll(heldHidden()).toBe('held')
  writes.release()
  // Wide shows the list as a region beside the detail, which is the one main.
  await expect.element(page.getByRole('region', { name: 'Catalog' })).toBeVisible()
  expect(normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null)).status).toBe('all')
})

it('opens the catalog from a status row only after its scope is saved', async () => {
  const db = openTestDb()
  await seed(db)
  await renderApp({ path: '/lists', db, frame: WIDE })
  const writes = gateWrites(db)
  await sidebar().getByRole('button', { name: STATUS_LABELS.learning, exact: true }).click()
  await expect.poll(writes.started).toBeGreaterThan(0)
  await expect.poll(heldHidden()).toBe('held')
  writes.release()
  await expect.element(page.getByRole('region', { name: 'Catalog' })).toBeVisible()
  expect(normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null)).status).toBe('learning')
})

it('keeps the other filters and the query when a status is chosen', async () => {
  const db = openTestDb()
  await seed(db)
  await setMeta(db, META_CATALOG_FILTERS, { key: 'G', tune_type: 'reel', unheard: true })
  writeSearchQuery('catalog', 'ang')
  onTestFinished(() => writeSearchQuery('catalog', ''))
  await renderApp({ path: '/lists', db, frame: WIDE })
  await sidebar().getByRole('button', { name: STATUS_LABELS.known, exact: true }).click()
  await expect
    .poll(async () => normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null)))
    .toMatchObject({ status: 'known', key: 'G', tune_type: 'reel', unheard: true })
  expect(readSearchQuery('catalog')).toBe('ang')
})

it('sets the stored status filter and marks the row current', async () => {
  const db = openTestDb()
  await seed(db)
  await renderApp({ path: '/lists', db, frame: WIDE })
  await sidebar().getByRole('button', { name: STATUS_LABELS.learning, exact: true }).click()
  await expect.element(page.getByRole('region', { name: 'Catalog' })).toBeVisible()
  await expect
    .poll(async () => normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null)).status)
    .toBe('learning')
  await expect
    .element(sidebar().getByRole('button', { name: STATUS_LABELS.learning, exact: true }))
    .toHaveAttribute('aria-current', 'page')
  await expect
    .element(sidebar().getByRole('link', { name: 'Catalog', exact: true }))
    .not.toHaveAttribute('aria-current')

  await sidebar().getByRole('link', { name: 'Catalog', exact: true }).click()
  await expect
    .poll(async () => normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null)).status)
    .toBe('all')
  await expect
    .element(sidebar().getByRole('link', { name: 'Catalog', exact: true }))
    .toHaveAttribute('aria-current', 'page')
})

it('renders a deep link inside the shell at 1280', async () => {
  const db = openTestDb()
  const { tuneId } = await createTune(db, { title: 'Forked Deer' }, { status: 'known' })
  await renderApp({ path: `/catalog/${tuneId}`, db, frame: WIDE })
  await expect.element(sidebar()).toBeVisible()
  await expect
    .element(page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1 }))
    .toHaveTextContent('Forked Deer')
})

it('tabs from the sidebar to the content column, then the detail column, on wide', async () => {
  const db = openTestDb()
  const { tuneId } = await createTune(db, { title: 'Forked Deer' }, { status: 'known' })
  await renderApp({ path: `/catalog/${tuneId}`, db, frame: WIDE })
  const detail = page.getByRole('main', { name: TUNE })
  await expect.element(detail.getByRole('heading', { level: 1 })).toHaveTextContent('Forked Deer')
  const panes = [
    ['sidebar', sidebar()],
    ['content', page.getByRole('region', { name: CATALOG.label, exact: true })],
    ['detail', detail],
  ] as const
  const paneOf = (element: Element | null) =>
    panes.find(([, pane]) => pane.element().contains(element))?.[0]

  sidebar().getByRole('link').first().element().focus()
  await expect.poll(() => paneOf(document.activeElement)).toBe('sidebar')
  const visited = ['sidebar']
  for (let press = 0; press < 80 && visited.at(-1) !== 'detail'; press++) {
    const before = document.activeElement
    await userEvent.keyboard('{Tab}')
    await expect.poll(() => document.activeElement).not.toBe(before)
    const pane = paneOf(document.activeElement)
    if (pane && pane !== visited.at(-1)) visited.push(pane)
  }
  expect(visited).toEqual(['sidebar', 'content', 'detail'])
})

it('shows the sync badge only when it needs attention', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE })
  const badge = sidebar().getByTestId('sync-status')
  await expect.element(badge).toHaveAttribute('data-status', 'idle')
  await expect.element(badge).toHaveTextContent('')
})

it('reports the status and the last clean run for the end-to-end suite', async () => {
  await renderApp({
    path: '/catalog',
    db: openTestDb(),
    frame: WIDE,
    sync: { lastSyncedAt: () => '2026-09-18T00:00:00.000Z' },
  })
  const badge = sidebar().getByTestId('sync-status')
  await expect.element(badge).toHaveAttribute('data-status', 'idle')
  await expect.element(badge).toHaveAttribute('data-synced-at', '2026-09-18T00:00:00.000Z')
})

it('shows Offline when the engine is offline', async () => {
  await renderApp({
    path: '/catalog',
    db: openTestDb(),
    frame: WIDE,
    sync: { status: () => 'offline' },
  })
  await expect.element(sidebar().getByTestId('sync-status')).toHaveTextContent(OFFLINE)
})

it.each([
  ['phone', PHONE],
  ['wide', WIDE],
])('stands the %s Record control down while a dialog is open', async (_name, frame) => {
  await renderApp({ path: '/kit', db: openTestDb(), frame })
  const record = page.getByTestId('record-control')
  await expect.element(record).not.toHaveAttribute('aria-hidden')
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await expect.element(record).toHaveAttribute('aria-hidden', 'true')
  await expect.element(record).toHaveAttribute('inert')
  await page.getByRole('button', { name: CANCEL }).click()
  await expect.element(record).not.toHaveAttribute('aria-hidden')
})

it.each([
  ['phone', PHONE, TAB_BAR],
  ['wide', WIDE, SIDEBAR],
])('marks no destination current outside the four on the %s', async (_name, frame, nav) => {
  await renderApp({ path: '/kit', db: openTestDb(), frame })
  const navigation = page.getByRole('navigation', { name: nav })
  await expect
    .element(navigation.getByRole('link', { name: DESTINATIONS[0]!.label, exact: true }))
    .toBeVisible()
  expect(navigation.element().querySelectorAll('[aria-current]')).toHaveLength(0)
})

it('recedes the whole shell behind a touch sheet', async () => {
  const db = openTestDb()
  await seed(db)
  await renderApp({ path: '/catalog', db, frame: PHONE, density: 'touch' })
  const tabs = page.getByRole('navigation', { name: TAB_BAR })
  await expect.element(tabs).toBeVisible()
  await page.getByRole('button', { name: /^Filters/ }).click()
  await expect.element(page.getByRole('dialog')).toBeVisible()
  const scale = () => {
    const root = tabs.element().closest<HTMLElement>('[data-sheet-root]')
    const value = /scale\(([\d.]+)\)/.exec(root?.style.transform ?? '')?.[1]
    return value === undefined ? 1 : Number(value)
  }
  await expect.poll(scale).toBeLessThan(1)
})

it.each([
  ['phone', PHONE],
  ['split', SPLIT],
  ['wide', WIDE],
])('scrolls only inside its columns at the %s frame', async (_name, frame) => {
  const db = openTestDb()
  for (let index = 0; index < 40; index++) {
    await createTune(db, { title: `Tune ${String(index).padStart(2, '0')}` }, { status: 'known' })
  }
  await renderApp({ path: '/catalog', db, frame })
  await expect.element(page.getByRole('row', { name: /Tune 00/ })).toBeVisible()
  // A long list's hidden announcers must not stretch the window, which would scroll the whole
  // shell, sidebar and bars included, past the column's own scroll.
  await expect.poll(() => document.documentElement.scrollHeight).toBe(window.innerHeight)
})

/**
 * Screen reader text at the end of a window-tall run of content in `scroller`, as in a long
 * column's last row. Tailwind's sr-only is absolute, so only a positioned scroller keeps it from
 * stretching the window.
 */
function appendHiddenText(scroller: Element) {
  const row = document.createElement('div')
  const filler = document.createElement('div')
  filler.style.height = `${window.innerHeight}px`
  const text = document.createElement('span')
  text.className = 'sr-only'
  text.textContent = 'Hidden'
  row.append(filler, text)
  scroller.append(row)
  onTestFinished(() => row.remove())
}

it.each([
  ['split', SPLIT],
  ['wide', WIDE],
])("keeps a long sidebar's hidden text inside it at the %s frame", async (_name, frame) => {
  const db = openTestDb()
  for (let index = 0; index < 40; index++) {
    await createList(db, `List ${String(index).padStart(2, '0')}`)
  }
  await renderApp({ path: '/catalog', db, frame })
  await expect
    .element(sidebar().getByRole('link', { name: 'List 39', exact: true }))
    .toBeInTheDocument()
  const nav = sidebar().element()
  await expect.poll(() => nav.scrollHeight).toBeGreaterThan(nav.clientHeight)
  appendHiddenText(nav)
  await expect.poll(() => document.documentElement.scrollHeight).toBe(window.innerHeight)
})

it.each([
  ['split', SPLIT],
  ['wide', WIDE],
])(
  "keeps hidden text in the shell's own scroller inside it at the %s frame",
  async (_name, frame) => {
    await renderApp({ path: '/catalog', db: openTestDb(), frame })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    const scroller = document.querySelector('[data-sheet-root] > div:last-child > div')!
    appendHiddenText(scroller)
    await expect.poll(() => document.documentElement.scrollHeight).toBe(window.innerHeight)
  },
)
