import { expect, it, onTestFinished } from 'vitest'
import { page } from 'vitest/browser'
import { META_RECORDINGS_ORIGIN } from '../db/meta'
import type { CrosstuneDb } from '../db/schema'
import { SEARCH_TUNES, SELECT_TUNES } from '../features/catalog/catalogCopy'
import { SEARCH_RECORDINGS } from '../features/recordings/recordingsCopy'
import { SELECT_ALL } from '../features/selection/selectionCopy'
import { OFFLINE } from '../sync/labels'
import { DONE } from '../ui/confirmCopy'
import { MORE_ACTIONS } from '../ui/menuCopy'
import { contrastRatio, glyphInk, paintedBackground, washOver } from '../test/contrast'
import { openTestDb } from '../test/db'
import { restoreSystemDark, stubSystemDark } from '../test/scheme'
import { recordingRow, tuneRow, userTuneRow } from '../test/rows'
import { renderApp } from '../test/renderApp'
import { destination } from './destinations'
import { ACCOUNT_BUTTON, PHONE_TABS } from './tabs'

const PHONE = { width: 390, height: 844 }
const SPLIT = { width: 900, height: 800 }
const NARROW_PHONE = { width: 320, height: 640 }
const CATALOG = destination('catalog')

const pad = (n: number) => String(n).padStart(3, '0')

/** Enough tunes for the list to scroll well past the bar. */
async function seedTunes(db: CrosstuneDb, count = 40) {
  const ids = Array.from({ length: count }, (_, i) => pad(i))
  await db.tunes.bulkPut(ids.map((id) => tuneRow(`t${id}`, `Tune ${id}`)))
  await db.user_tunes.bulkPut(ids.map((id) => userTuneRow(`u${id}`, `t${id}`)))
}

const listColumn = () => document.querySelector<HTMLElement>('[data-column="list"]')!
const rootBar = () => document.querySelector<HTMLElement>('[data-root-bar]')
const rootBarLocator = () => page.elementLocator(rootBar()!)
const account = () => page.getByRole('link', { name: ACCOUNT_BUTTON, exact: true })

/** Scrolls the list column and waits for the scroll to be delivered, as a user's would be. */
async function scrollList(top: number) {
  const scroller = listColumn()
  const delivered = new Promise((resolve) =>
    scroller.addEventListener('scroll', resolve, { once: true }),
  )
  scroller.scrollTop = top
  await delivered
}

it('puts the title, the verbs, then the account button in one row on each phone root', async () => {
  const { router } = await renderApp({ path: '/catalog', db: openTestDb(), frame: PHONE })
  for (const id of PHONE_TABS) {
    const { label, root } = destination(id)
    await router.navigate(root)
    const main = page.getByRole('main', { name: label, exact: true })
    await expect.element(main.getByRole('heading', { level: 1, name: label })).toBeVisible()
    await expect.poll(() => rootBar()?.querySelector('h1')?.textContent).toBe(label)
    const controls = [...rootBar()!.querySelectorAll('[data-root-row] a, [data-root-row] button')]
    expect(controls.at(-1)?.getAttribute('aria-label') ?? controls.at(-1)?.textContent).toBe(
      ACCOUNT_BUTTON,
    )
    expect(main.element().querySelector('[data-pane-bar]')).toBeNull()
    expect(main.element().querySelector('[data-column-title]')).toBeNull()
  }
})

it('collapses the title into the pinned row once the list scrolls', async () => {
  const db = openTestDb()
  await seedTunes(db)
  await renderApp({ path: '/catalog', db, frame: PHONE })
  await expect.element(page.getByRole('row', { name: /^Tune 039\b/ })).toBeInTheDocument()
  await expect.poll(rootBar).not.toBeNull()
  await expect.element(rootBarLocator()).toHaveAttribute('data-collapsed', 'false')
  await scrollList(600)
  await expect.element(rootBarLocator()).toHaveAttribute('data-collapsed', 'true')
  const row = () => rootBar()!.querySelector<HTMLElement>('[data-root-row]')!
  await expect
    .poll(() => Math.round(row().getBoundingClientRect().top))
    .toBe(Math.round(listColumn().getBoundingClientRect().top))
  await expect.element(account()).toBeVisible()
  await scrollList(0)
  await expect.element(rootBarLocator()).toHaveAttribute('data-collapsed', 'false')
})

it('starts collapsed when the pane opens scrolled', async () => {
  const db = openTestDb()
  await seedTunes(db)
  await renderApp({ path: '/catalog', db, frame: SPLIT })
  await expect.element(page.getByRole('row', { name: /^Tune 039\b/ })).toBeInTheDocument()
  await scrollList(600)
  // The phone's bar mounts into the pane already scrolled; what it holds on insertion is what
  // paints first.
  const firstState = new Promise<string | null>((resolve) => {
    const observer = new MutationObserver(() => {
      const bar = rootBar()
      if (!bar) return
      observer.disconnect()
      resolve(bar.getAttribute('data-collapsed'))
    })
    observer.observe(listColumn(), { childList: true, subtree: true })
    onTestFinished(() => observer.disconnect())
  })
  await page.viewport(PHONE.width, PHONE.height)
  expect(await firstState).toBe('true')
  await expect.element(rootBarLocator()).toHaveAttribute('data-collapsed', 'true')
})

it('keeps the sync badge beside the small title once collapsed', async () => {
  const db = openTestDb()
  await seedTunes(db)
  await renderApp({ path: '/catalog', db, frame: PHONE, sync: { status: () => 'offline' } })
  await expect.element(page.getByRole('row', { name: /^Tune 039\b/ })).toBeInTheDocument()
  const badge = page.getByTestId('sync-status')
  await expect.element(badge).toHaveTextContent(OFFLINE)
  await scrollList(600)
  await expect.element(rootBarLocator()).toHaveAttribute('data-collapsed', 'true')
  const title = rootBar()!.querySelector('h1')!
  const gap = () =>
    badge.element().getBoundingClientRect().left - title.getBoundingClientRect().right
  await expect.poll(gap).toBeGreaterThanOrEqual(0)
  await expect.poll(gap).toBeLessThanOrEqual(8)
})

it('keeps search pinned under the row', async () => {
  const db = openTestDb()
  await seedTunes(db)
  await renderApp({ path: '/catalog', db, frame: PHONE })
  await expect.element(page.getByRole('row', { name: /^Tune 039\b/ })).toBeInTheDocument()
  await scrollList(600)
  await expect.element(rootBarLocator()).toHaveAttribute('data-collapsed', 'true')
  const search = page.getByRole('searchbox', { name: SEARCH_TUNES })
  const row = rootBar()!.querySelector<HTMLElement>('[data-root-row]')!
  const field = () => search.element().closest('[data-root-search]')!.getBoundingClientRect()
  await expect
    .poll(() => Math.round(field().top))
    .toBe(Math.round(row.getBoundingClientRect().bottom))
  expect(field().bottom).toBeLessThanOrEqual(window.innerHeight)
  await expect.element(search).toBeVisible()
  expect(rootBar()!.contains(search.element())).toBe(true)
})

it('pins the recordings search under the row too', async () => {
  const db = openTestDb()
  await db.recordings.bulkPut(
    Array.from({ length: 30 }, (_, i) => recordingRow(`r${i}`, { label: `Take ${pad(i)}` })),
  )
  await renderApp({ path: '/recordings', db, frame: PHONE })
  const search = page.getByRole('searchbox', { name: SEARCH_RECORDINGS })
  await expect.element(search).toBeVisible()
  await expect.poll(() => rootBar()?.contains(search.element())).toBe(true)
})

it('replaces the row with the selection controls and keeps search', async () => {
  const db = openTestDb()
  await seedTunes(db, 5)
  await renderApp({ path: '/catalog', db, frame: PHONE })
  await expect.element(page.getByRole('row', { name: /^Tune 004\b/ })).toBeInTheDocument()
  await rootBarLocator().getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_TUNES }).click()
  const done = () => rootBarLocator().getByRole('button', { name: DONE, exact: true })
  await expect.element(done()).toBeVisible()
  await expect.element(rootBarLocator().getByRole('button', { name: SELECT_ALL })).toBeVisible()
  await expect.element(account()).not.toBeInTheDocument()
  await expect
    .element(rootBarLocator().getByRole('searchbox', { name: SEARCH_TUNES }))
    .toBeVisible()
  expect(document.querySelectorAll('[data-root-bar]')).toHaveLength(1)
  await done().click()
  await expect
    .element(rootBarLocator().getByRole('heading', { level: 1, name: CATALOG.label }))
    .toBeVisible()
  await expect.element(account()).toBeVisible()
})

it('truncates a long title before the controls at the roomy size on a 320px phone', async () => {
  const html = document.documentElement
  html.dataset.textSize = 'roomy'
  onTestFinished(() => {
    delete html.dataset.textSize
  })
  const db = openTestDb()
  // A source filter that is set keeps Filters in the bar beside Upload.
  await db.meta.put({ key: META_RECORDINGS_ORIGIN, value: 'slippery_hill' })
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
  await renderApp({ path: '/recordings', db, frame: NARROW_PHONE, density: 'touch' })
  const title = () => rootBar()!.querySelector<HTMLElement>('h1')!
  await expect.poll(rootBar).not.toBeNull()
  await expect.element(account()).toBeVisible()
  await expect.element(page.getByRole('button', { name: /^Filters/ }).first()).toBeVisible()
  await expect.poll(() => title().scrollWidth > title().clientWidth).toBe(true)
  const box = account().element().getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth)
  for (const control of rootBar()!.querySelectorAll('[data-root-row] button')) {
    expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
    expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1)
  }
})

it.each([
  ['the catalog', 'light', '/catalog', false],
  ['the catalog', 'dark', '/catalog', true],
  ['the tuner', 'light', '/tuner', false],
  ['the tuner', 'dark', '/tuner', true],
])('keeps the account initials at 4.5:1 on %s in %s', async (_where, _name, path, dark) => {
  stubSystemDark(dark)
  onTestFinished(restoreSystemDark)
  await renderApp({ path, db: openTestDb(), frame: PHONE })
  await expect.poll(() => document.documentElement.dataset.scheme).toBe(dark ? 'dark' : 'light')
  await expect.element(account()).toBeVisible()
  const disc = account().element().querySelector('span')!
  // The disc eases into the scheme's colors, so measure once the transition has run.
  await expect.poll(() => disc.getAnimations().length).toBe(0)
  const ground = paintedBackground(account().element())
  expect(
    contrastRatio(glyphInk(disc), washOver(getComputedStyle(disc).backgroundColor, ground)),
  ).toBeGreaterThanOrEqual(4.5)
})
