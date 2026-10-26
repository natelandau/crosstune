import { page, userEvent } from 'vitest/browser'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import * as tunes from '../../commands/tunes'
import type { AppRouter } from '../../app/router'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import { recordingAnalytics } from '../../usage/testing'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { UNDO } from '../../ui/Toast'
import { ADD_TUNE } from '../catalog/catalogCopy'
import { NEW_TUNE_TITLE, QUICK_FIND } from '../keyboard/keymap'
import { QUICK_FIND_PLACEHOLDER } from '../quickFind/quickFindResults'
import { destination } from '../../layout/destinations'
import { NEW_TUNE_PATH } from '../../layout/tuneHome'
import { clearFresh } from './freshTune'
import { TUNE_TITLE_LABEL } from './tuneFormCopy'
import { TUNE } from './tunePageCopy'
import { addedMessage, KEY_TILE_EMPTY } from './tuneScreenCopy'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))
vi.mock('../../commands/tunes', async (original) => {
  const actual = await original<typeof tunes>()
  return {
    ...actual,
    createTune: vi.fn(actual.createTune),
    deleteTune: vi.fn(actual.deleteTune),
  }
})

afterEach(clearFresh)

const CATALOG = destination('catalog')
const title = () => page.getByRole('textbox', { name: TUNE_TITLE_LABEL })
const keyTile = () => page.getByRole('button', { name: KEY_TILE_EMPTY })

async function setup(frame?: { width: number; height: number }) {
  const db = openTestDb()
  await createTune(db, { title: 'Forked Deer' }, { status: 'known' })
  const analytics = recordingAnalytics()
  const app = await renderApp({
    path: CATALOG.root,
    db,
    frame,
    wrap: (node) => <AnalyticsProvider client={analytics}>{node}</AnalyticsProvider>,
  })
  return { ...app, db, analytics }
}

const created = (analytics: ReturnType<typeof recordingAnalytics>) =>
  (analytics.sends().find((sent) => sent.name === 'tune_created')?.props as { source?: string })
    ?.source

const count = (db: CrosstuneDb) => db.tunes.count()

it('Add opens a new tune page with the title focused', async () => {
  const { router } = await setup()
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await expect.poll(() => router.state.location.pathname).toBe(NEW_TUNE_PATH)
  await expect.element(page.getByRole('main', { name: TUNE })).toBeVisible()
  await expect.element(title()).toHaveFocus()
  await expect.element(keyTile()).not.toBeInTheDocument()
})

it('Enter creates the tune and focuses Add key', async () => {
  const { db, router, analytics } = await setup()
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill('  Elzic’s Farewell ')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => count(db)).toBe(2)
  const [made] = await db.tunes.where('title').equals('Elzic’s Farewell').toArray()
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${made!.id}`)
  await expect.element(keyTile()).toHaveFocus()
  await expect
    .element(page.getByRole('status').getByText(addedMessage('Elzic’s Farewell')))
    .toBeVisible()
  await expect.element(page.getByRole('status').getByRole('button', { name: UNDO })).toBeVisible()
  await expect.poll(() => created(analytics)).toBe('catalog')
})

/** Back to the catalog, and its rows rendered, so what Back did has settled. */
async function backToCatalog(router: AppRouter) {
  await page.getByRole('main', { name: TUNE }).getByRole('link', { name: CATALOG.label }).click()
  await expect.poll(() => router.state.location.pathname).toBe(CATALOG.root)
  await expect.element(page.getByRole('row', { name: /Forked Deer/ })).toBeVisible()
}

/** The catalog's titles, in order, once a create the test makes has landed. */
const titles = async (db: CrosstuneDb) =>
  (await db.tunes.orderBy('title').toArray()).map((t) => t.title)

/** Makes "Sally Ann" from a fresh new-tune page and waits for it, so anything an earlier step
 * would have written has landed. */
async function createAnother(db: CrosstuneDb) {
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill('Sally Ann')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => db.tunes.where('title').equals('Sally Ann').count()).toBe(1)
}

it.each(['', '   '])('leaving with the title %j creates nothing', async (typed) => {
  const { db, router } = await setup()
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  if (typed) await title().fill(typed)
  await backToCatalog(router)
  await createAnother(db)
  expect(await titles(db)).toEqual(['Forked Deer', 'Sally Ann'])
})

it('Back with text creates the tune and lands on the catalog', async () => {
  const { db, router } = await setup()
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill('Soldier’s Joy')
  await backToCatalog(router)
  await expect.poll(() => count(db)).toBe(2)
  await expect
    .element(page.getByRole('status').getByText(addedMessage('Soldier’s Joy')))
    .toBeVisible()
  expect(router.state.location.pathname).toBe(CATALOG.root)
})

it('switching away from the window creates nothing', async () => {
  const { db, router, analytics } = await setup()
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill('Soldier’s Joy')
  ;(document.activeElement as HTMLElement).blur()
  window.dispatchEvent(new Event('blur'))
  await expect.element(title()).toHaveValue('Soldier’s Joy')
  await expect.poll(() => router.state.location.pathname).toBe(NEW_TUNE_PATH)
  await title().click()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => count(db)).toBe(2)
  // Only Enter opens the tune with focus on its key tile, so the blur made nothing before it.
  const [made] = await db.tunes.where('title').equals('Soldier’s Joy').toArray()
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${made!.id}`)
  await expect.element(keyTile()).toHaveFocus()
  expect(await titles(db)).toEqual(['Forked Deer', 'Soldier’s Joy'])
  expect(analytics.sends().filter((sent) => sent.name === 'tune_created')).toHaveLength(1)
})

/**
 * Hides the tab, as the browser does before it closes or switches away. The page hears closing
 * by the same shared listener, and a test cannot fire `pagehide`, which Vitest reads as the
 * test frame unloading.
 */
function hideTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  onTestFinished(() => {
    Reflect.deleteProperty(document, 'visibilityState')
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

it('hiding the tab creates the tune once, which takes the page', async () => {
  const { db, router } = await setup()
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill('Soldier’s Joy')
  hideTab()
  document.dispatchEvent(new Event('visibilitychange'))
  await expect.poll(() => db.tunes.where('title').equals('Soldier’s Joy').count()).toBe(1)
  const [made] = await db.tunes.where('title').equals('Soldier’s Joy').toArray()
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${made!.id}`)
  Reflect.deleteProperty(document, 'visibilityState')
  await router.navigate(CATALOG.root)
  await createAnother(db)
  expect(await titles(db)).toEqual(['Forked Deer', 'Sally Ann', 'Soldier’s Joy'])
})

it('hiding the tab with a blank title creates nothing', async () => {
  const { db, router } = await setup()
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill('   ')
  hideTab()
  Reflect.deleteProperty(document, 'visibilityState')
  await backToCatalog(router)
  await createAnother(db)
  expect(await titles(db)).toEqual(['Forked Deer', 'Sally Ann'])
})

it('Undo after creating from the page leaves no dead address behind', async () => {
  const { db, router } = await setup()
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill('Soldier’s Joy')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => count(db)).toBe(2)
  const [made] = await db.tunes.where('title').equals('Soldier’s Joy').toArray()
  const dead = `/catalog/${made!.id}`
  await expect.poll(() => router.state.location.pathname).toBe(dead)
  const toast = page.getByRole('status').getByText(addedMessage('Soldier’s Joy'))
  await toast.hover()
  const visited: string[] = []
  const stop = router.subscribe((state) => visited.push(state.location.pathname))
  onTestFinished(stop)
  await page.getByRole('status').getByRole('button', { name: UNDO }).click()
  await expect.poll(async () => (await db.tunes.get(made!.id))?.deleted_at).toBeTruthy()
  await expect.poll(() => router.state.location.pathname).toBe(CATALOG.root)
  await router.navigate(-1)
  expect(router.state.location.pathname).not.toBe(dead)
})

it('shows a message when Undo cannot delete the tune', async () => {
  const { db, router } = await setup()
  vi.mocked(tunes.deleteTune).mockRejectedValueOnce(new Error('Delete refused'))
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill('Soldier’s Joy')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => count(db)).toBe(2)
  await page.getByRole('status').getByText(addedMessage('Soldier’s Joy')).hover()
  await page.getByRole('status').getByRole('button', { name: UNDO }).click()
  await expect.element(page.getByRole('status').getByText('Delete refused')).toBeVisible()
  expect(router.state.location.pathname).not.toBe(CATALOG.root)
})

it('Back while the create is still running keeps the page Back went to', async () => {
  const { db, router } = await setup()
  const actual = await vi.importActual<typeof tunes>('../../commands/tunes')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(tunes.createTune).mockImplementationOnce(async (...args) => {
    await gate
    return actual.createTune(...args)
  })
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill('Soldier’s Joy')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => vi.mocked(tunes.createTune)).toHaveBeenCalledTimes(2)
  await backToCatalog(router)
  release()
  await expect
    .element(page.getByRole('status').getByText(addedMessage('Soldier’s Joy')))
    .toBeVisible()
  expect(await db.tunes.where('title').equals('Soldier’s Joy').count()).toBe(1)
  await expect.poll(() => router.state.location.pathname).toBe(CATALOG.root)
})

it("Quick Find's New tune opens the same page", async () => {
  // Cmd is the command key only on a Mac.
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  const { router, db, analytics } = await setup()
  await userEvent.keyboard('{Meta>}k{/Meta}')
  const finder = page.getByRole('dialog', { name: QUICK_FIND })
  await finder.getByPlaceholder(QUICK_FIND_PLACEHOLDER).fill(NEW_TUNE_TITLE)
  await finder.getByRole('option', { name: new RegExp(`^${NEW_TUNE_TITLE}`) }).click()
  await expect.poll(() => router.state.location.pathname).toBe(NEW_TUNE_PATH)
  await expect.element(title()).toHaveFocus()
  await userEvent.keyboard('Soldier’s Joy{Enter}')
  await expect.poll(() => count(db)).toBe(2)
  await expect.poll(() => created(analytics)).toBe('menu')
})

/** Creates a tune from the new-tune page and waits on its page; resolves to its id. */
async function createFromPage(db: CrosstuneDb, router: AppRouter, typed: string) {
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await title().fill(typed)
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => db.tunes.where('title').equals(typed).count()).toBe(1)
  const [made] = await db.tunes.where('title').equals(typed).toArray()
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${made!.id}`)
  // Held under the pointer, so the toast outlasts the steps before its Undo.
  await page.getByRole('status').getByText(addedMessage(typed)).hover()
  return made!.id
}

/**
 * How many tunes the catalog lists, read from the list column even while a page covers it. A
 * hidden list mounts none of its rows, so the count is the grid's own.
 */
const listedCount = () =>
  Number(
    document.querySelector('[data-column="list"] [role="grid"]')?.getAttribute('aria-rowcount'),
  )

const undo = () => page.getByRole('status').getByRole('button', { name: UNDO }).click()

it('Undo leaves the musician on the other tune they opened', async () => {
  const { db, router } = await setup()
  const made = await createFromPage(db, router, 'Soldier’s Joy')
  const [other] = await db.tunes.where('title').equals('Forked Deer').toArray()
  await router.navigate(`/catalog/${other!.id}`)
  await expect.element(page.getByRole('heading', { level: 1, name: 'Forked Deer' })).toBeVisible()
  await expect.poll(listedCount).toBeGreaterThan(1)
  const listed = listedCount()
  await undo()
  await expect.poll(async () => (await db.tunes.get(made))?.deleted_at).toBeTruthy()
  // The catalog, held behind the page, drops the row once it has read the delete, so anything
  // the delete would set off has run.
  await expect.poll(listedCount).toBe(listed - 1)
  expect(router.state.location.pathname).toBe(`/catalog/${other!.id}`)
  await expect.element(page.getByRole('heading', { level: 1, name: 'Forked Deer' })).toBeVisible()
})

it('Undo while typing a new title creates nothing and keeps the page', async () => {
  const { db, router } = await setup()
  const made = await createFromPage(db, router, 'Soldier’s Joy')
  await router.navigate(NEW_TUNE_PATH)
  await title().fill('Sally Ann')
  await undo()
  await expect.poll(async () => (await db.tunes.get(made))?.deleted_at).toBeTruthy()
  // The field still holds the title, so the page stayed; Enter then makes the only Sally Ann.
  await expect.element(title()).toHaveValue('Sally Ann')
  await title().click()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => db.tunes.where('title').equals('Sally Ann').count()).toBe(1)
  const [sally] = await db.tunes.where('title').equals('Sally Ann').toArray()
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${sally!.id}`)
  expect(await db.tunes.where('title').equals('Sally Ann').count()).toBe(1)
})

it.each([
  ['phone', { width: 390, height: 844 }],
  ['wide', { width: 1280, height: 800 }],
] as const)('the header keeps its gutter as the tune is created (%s)', async (_, frame) => {
  const { db } = await setup(frame)
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  await expect.element(title()).toHaveFocus()
  const before = title().element().getBoundingClientRect().left
  await userEvent.keyboard('Soldier’s Joy{Enter}')
  await expect.poll(() => count(db)).toBe(2)
  // The key tile leads the created page's header where the field led the new one's.
  await expect.element(keyTile()).toBeVisible()
  await expect.poll(() => keyTile().element().getBoundingClientRect().left).toBe(before)
})
