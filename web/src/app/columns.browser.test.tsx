import { render } from '@testing-library/react'
import { useEffect, useLayoutEffect } from 'react'
import {
  createMemoryRouter,
  Link,
  useParams,
  useSearchParams,
  type RouteObject,
} from 'react-router'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { CrosstuneDb } from '../db/schema'
import { OFFLINE } from '../sync/labels'
import { openTestDb } from '../test/db'
import { dataProviders, fakeEngine } from '../test/providers'
import { tuneRow, userTuneRow } from '../test/rows'
import { TUNE } from '../features/tune/tunePageCopy'
import { destination } from './destinations'
import { App } from './App'
import { drag } from '../test/gestures'
import { stampAxes } from '../test/render'
import { renderApp } from '../test/renderApp'
import { viewTransitionsDone } from '../test/viewTransitions'
import { COLUMN_WIDTH, Columns, useDetailPage } from './Columns'
import { usePane } from './pane'
import { CHOOSE_OR_PRESS_N, CHOOSE_OR_TAP_PLUS, NO_TUNE_SELECTED } from './DetailEmpty'
import { useNowPlaying } from './NowPlayingSlot'
import { PaneBar } from './PaneBar'
import { Shell } from './Shell'
import { SIDEBAR } from './Sidebar'
import { TAB_BAR } from './tabs'

// Settings pages read the signed-in user's name.
vi.mock('@clerk/react', () => import('../fixture/clerkStub'))

const PHONE = { width: 390, height: 844 }
const SPLIT = { width: 900, height: 800 }
const WIDE = { width: 1280, height: 800 }
const TABLET_PORTRAIT = { width: 820, height: 1180 }
const TABLET_LANDSCAPE = { width: 1180, height: 820 }

const CATALOG = destination('catalog').label

const pad = (n: number) => String(n).padStart(3, '0')

/** Enough tunes that the list scrolls well past one screen. */
// Enough rows to scroll even the tallest frame, and few enough to render fast on a slow runner.
async function seedMany(db: CrosstuneDb, count = 80) {
  const ids = Array.from({ length: count }, (_, i) => pad(i))
  await db.tunes.bulkPut(ids.map((id) => tuneRow(`t${id}`, `Tune ${id}`)))
  await db.user_tunes.bulkPut(ids.map((id) => userTuneRow(`u${id}`, `t${id}`)))
}

// The list is the main while it is the only pane, and a region beside the detail.
const catalog = () =>
  page.getByRole('region', { name: CATALOG }).or(page.getByRole('main', { name: CATALOG }))
const tune = () => page.getByRole('main', { name: TUNE })
// The page's heading, which shows once the tune has read, as its opening transition starts.
const tuneTitle = () => tune().getByRole('heading', { level: 1 })
const focusInDetail = () => detailColumn().contains(document.activeElement)
const listColumn = () => document.querySelector<HTMLElement>('[data-column="list"]')!
const detailColumn = () => document.querySelector<HTMLElement>('[data-column="detail"]')!
const backLink = () => tune().getByRole('link', { name: CATALOG, exact: true })

/** Scrolls the list column and waits for the scroll to be delivered, as a user's would be. */
async function scrollList(top: number) {
  const scroller = listColumn()
  const delivered = new Promise((resolve) =>
    scroller.addEventListener('scroll', resolve, { once: true }),
  )
  scroller.scrollTop = top
  await delivered
  return scroller.scrollTop
}

/** The first tune row that sits wholly inside the list column's visible area. */
function rowInView(): HTMLElement {
  const scroller = listColumn()
  const box = scroller.getBoundingClientRect()
  const rows = [...scroller.querySelectorAll<HTMLElement>('[role="row"]')]
  return rows.find((row) => {
    const r = row.getBoundingClientRect()
    return r.top >= box.top + 80 && r.bottom <= box.bottom
  })!
}

it('shows the list beside the open tune on wide', async () => {
  const db = openTestDb()
  await seedMany(db, 5)
  await renderApp({ path: '/catalog/t001', db, frame: WIDE })
  await expect.element(catalog()).toBeVisible()
  await expect.element(tune()).toBeVisible()
  await expect
    .element(catalog().getByRole('row', { name: /^Tune 001\b/ }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.element(backLink()).not.toBeInTheDocument()
  await expect.element(page.getByRole('region', { name: CATALOG })).toBeVisible()
  expect(page.getByRole('main').elements()).toHaveLength(1)
})

it('makes the list the one main while it is the only pane', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: PHONE })
  await expect.element(page.getByRole('main', { name: CATALOG })).toBeVisible()
  expect(page.getByRole('main').elements()).toHaveLength(1)
})

it('keeps the tune open and the list in place when a wide window narrows to split', async () => {
  const db = openTestDb()
  await seedMany(db)
  const { router } = await renderApp({ path: '/catalog', db, frame: WIDE })
  await expect.element(catalog().getByRole('row', { name: /^Tune 079\b/ })).toBeInTheDocument()
  const top = await scrollList(1000)
  expect(top).toBeGreaterThan(0)
  const row = rowInView()
  row.focus()
  row.click()
  await expect.element(tuneTitle()).toBeVisible()
  await expect.element(catalog()).toBeVisible()
  const list = catalog().element()
  await expect.poll(viewTransitionsDone).toBe(true)

  await page.viewport(SPLIT.width, SPLIT.height)
  await expect.element(catalog()).not.toBeInTheDocument()
  expect(listColumn().hidden).toBe(true)
  expect(listColumn().inert).toBe(true)
  await expect.element(tune()).toBeVisible()
  // The row that held focus is hidden, so focus lands on the page instead of the body.
  await expect.poll(focusInDetail).toBe(true)

  await backLink().click()
  await expect.element(catalog()).toBeVisible()
  await expect.element(tune()).not.toBeInTheDocument()
  // Back walks history when the entry behind is the catalog, instead of pushing a new one.
  expect(router.state.historyAction).toBe('POP')
  expect(catalog().element()).toBe(list)
  await expect.poll(() => listColumn().scrollTop).toBe(top)
  await expect.poll(() => document.activeElement).toBe(row)
})

it('fills the detail column with the empty state when split widens with the list showing', async () => {
  const db = openTestDb()
  await seedMany(db, 5)
  await renderApp({ path: '/catalog', db, frame: SPLIT })
  await expect.element(catalog()).toBeVisible()
  await expect
    .element(page.getByRole('heading', { name: NO_TUNE_SELECTED }))
    .not.toBeInTheDocument()
  await page.viewport(WIDE.width, WIDE.height)
  await expect.element(page.getByRole('heading', { name: NO_TUNE_SELECTED })).toBeVisible()
  await expect.element(page.getByText(CHOOSE_OR_PRESS_N)).toBeVisible()
  await expect.element(catalog()).toBeVisible()
})

it('offers tap + as the empty hint on touch', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE, density: 'touch' })
  await expect.element(page.getByText(CHOOSE_OR_TAP_PLUS)).toBeVisible()
})

it('keeps the open tune, the list, and its scroll across a tablet rotation', async () => {
  const db = openTestDb()
  await seedMany(db)
  await renderApp({ path: '/catalog', db, frame: TABLET_LANDSCAPE })
  await expect.element(catalog().getByRole('row', { name: /^Tune 079\b/ })).toBeInTheDocument()
  const top = await scrollList(1000)
  expect(top).toBeGreaterThan(0)
  rowInView().click()
  await expect.element(tuneTitle()).toBeVisible()
  const list = catalog().element()
  const opened = tune().element()
  await expect.poll(viewTransitionsDone).toBe(true)

  await page.viewport(TABLET_PORTRAIT.width, TABLET_PORTRAIT.height)
  await expect.element(catalog()).not.toBeInTheDocument()
  expect(tune().element()).toBe(opened)

  await page.viewport(TABLET_LANDSCAPE.width, TABLET_LANDSCAPE.height)
  await expect.element(catalog()).toBeVisible()
  expect(tune().element()).toBe(opened)
  expect(catalog().element()).toBe(list)
  await expect.poll(() => listColumn().scrollTop).toBe(top)
})

it('keeps the same catalog when a phone window widens past the tab bar', async () => {
  const db = openTestDb()
  await seedMany(db, 5)
  await renderApp({ path: '/catalog', db, frame: PHONE })
  await expect.element(page.getByRole('navigation', { name: TAB_BAR })).toBeVisible()
  const list = catalog().element()
  await page.viewport(SPLIT.width, SPLIT.height)
  await expect.element(page.getByRole('navigation', { name: SIDEBAR })).toBeVisible()
  expect(catalog().element()).toBe(list)
})

it.each([
  ['phone', PHONE],
  ['split', SPLIT],
])('Back from a deep link on %s opens the catalog root', async (_name, frame) => {
  const db = openTestDb()
  await seedMany(db, 5)
  const { router } = await renderApp({ path: '/catalog/t001', db, frame })
  await expect.element(tune()).toBeVisible()
  await expect.element(catalog()).not.toBeInTheDocument()
  await expect.poll(focusInDetail).toBe(true)
  await backLink().click()
  await expect.element(catalog()).toBeVisible()
  expect(router.state.location.pathname).toBe('/catalog')
  // Nothing is behind a deep link, so the catalog replaces the page.
  expect(router.state.historyAction).toBe('REPLACE')
})

it('resizes the content column from the keyboard and keeps the width', async () => {
  const first = await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE })
  const separator = page.getByRole('separator', { name: COLUMN_WIDTH })
  await expect.element(separator).toHaveAttribute('aria-valuenow', '340')
  await expect.element(separator).toHaveAttribute('aria-valuemin', '280')
  await expect.element(separator).toHaveAttribute('aria-valuemax', '480')
  await expect.element(separator).toHaveAttribute('aria-orientation', 'vertical')
  separator.element().focus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(separator).toHaveAttribute('aria-valuenow', '356')
  await expect.poll(() => listColumn().getBoundingClientRect().width).toBe(356)
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
  await expect.element(separator).toHaveAttribute('aria-valuenow', '324')
  await userEvent.keyboard('{End}')
  await expect.element(separator).toHaveAttribute('aria-valuenow', '480')
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(separator).toHaveAttribute('aria-valuenow', '480')
  await userEvent.keyboard('{Home}{ArrowRight}')
  await expect.element(separator).toHaveAttribute('aria-valuenow', '296')
  first.unmount()

  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE })
  await expect
    .element(page.getByRole('separator', { name: COLUMN_WIDTH }))
    .toHaveAttribute('aria-valuenow', '296')
})

it('resizes the content column by dragging', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE })
  const separator = page.getByRole('separator', { name: COLUMN_WIDTH })
  await expect.element(separator).toHaveAttribute('aria-valuenow', '340')
  await drag(separator, 60, 0, { pointerType: 'mouse' })
  await expect.element(separator).toHaveAttribute('aria-valuenow', '400')
  await drag(separator, 400, 0, { pointerType: 'mouse' })
  await expect.element(separator).toHaveAttribute('aria-valuenow', '480')
  expect(localStorage.getItem('crosstune.columnWidth')).toBe('480')
})

it('gives the separator a full touch target', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE, density: 'touch' })
  const separator = page.getByRole('separator', { name: COLUMN_WIDTH })
  await expect.element(separator).toBeInTheDocument()
  expect(getComputedStyle(separator.element(), '::before').width).toBe('44px')
})

it('keeps the separator clear of the list scrollbar on pointer', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE })
  const separator = page.getByRole('separator', { name: COLUMN_WIDTH })
  await expect.element(separator).toBeInTheDocument()
  const box = listColumn().getBoundingClientRect()
  const hit = document.elementFromPoint(box.right - 4, box.top + box.height / 2)
  expect(listColumn().contains(hit)).toBe(true)
  const beyond = separator.element().getBoundingClientRect().right + 4
  expect(document.elementFromPoint(beyond, box.top + box.height / 2)).toBe(separator.element())
})

it('falls back to the default width when the stored one is not a width', async () => {
  localStorage.setItem('crosstune.columnWidth', 'wide')
  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE })
  await expect
    .element(page.getByRole('separator', { name: COLUMN_WIDTH }))
    .toHaveAttribute('aria-valuenow', '340')
})

it('shows the pane bar title only once the column title scrolls away', async () => {
  const db = openTestDb()
  await seedMany(db, 60)
  await renderApp({ path: '/catalog', db, frame: PHONE })
  await expect.element(catalog().getByRole('heading', { name: CATALOG })).toBeVisible()
  await expect.element(catalog().getByRole('row', { name: /^Tune 059\b/ })).toBeInTheDocument()
  const barTitle = () => listColumn().querySelector<HTMLElement>('[data-pane-title]')!
  await expect.poll(() => barTitle()).not.toBeNull()
  await expect.poll(() => getComputedStyle(barTitle()).opacity).toBe('0')
  expect(barTitle()).toHaveAttribute('aria-hidden', 'true')
  await scrollList(600)
  await expect.poll(() => getComputedStyle(barTitle()).opacity).toBe('1')
  expect(barTitle()).not.toHaveAttribute('aria-hidden')
  listColumn().scrollTop = 0
  await expect.poll(() => getComputedStyle(barTitle()).opacity).toBe('0')
})

it('shows Offline beside the catalog title on the phone', async () => {
  await renderApp({
    path: '/catalog',
    db: openTestDb(),
    frame: PHONE,
    sync: { status: () => 'offline' },
  })
  const title = catalog().getByRole('heading', { name: CATALOG })
  await expect.element(title).toBeVisible()
  const badge = page.getByTestId('sync-status')
  await expect.element(badge).toHaveTextContent(OFFLINE)
  expect(badge.element().closest('[data-column-title]')).toBe(
    title.element().closest('[data-column-title]'),
  )
})

it('keeps the sync badge in the sidebar alone on wide', async () => {
  await renderApp({
    path: '/catalog',
    db: openTestDb(),
    frame: WIDE,
    sync: { status: () => 'offline' },
  })
  await expect
    .element(page.getByRole('navigation', { name: SIDEBAR }).getByTestId('sync-status'))
    .toHaveTextContent(OFFLINE)
  expect(page.getByTestId('sync-status').elements()).toHaveLength(1)
})

function Docked() {
  const { set } = useNowPlaying()
  useEffect(() => {
    set(<p>Playing Angeline</p>)
    return () => set(null)
  }, [set])
  return (
    <Columns
      list={<p>List</p>}
      listLabel="List"
      detail={null}
      detailLabel="Page"
      empty={<p>Empty</p>}
    />
  )
}

/** Mounts `routes` inside the shell at `frame`, starting at `path`. */
async function mountShell(
  frame: { width: number; height: number },
  routes: RouteObject[],
  path = '/',
) {
  await page.viewport(frame.width, frame.height)
  onTestFinished(() => page.viewport(PHONE.width, PHONE.height))
  stampAxes({ density: 'pointer' })
  const router = createMemoryRouter([{ element: <Shell />, children: routes }], {
    initialEntries: [path],
  })
  onTestFinished(() => router.dispose())
  render(<App router={router} />, {
    wrapper: dataProviders({ db: openTestDb(), engine: fakeEngine() }),
  })
  return router
}

async function mountDocked(frame: { width: number; height: number }) {
  await mountShell(frame, [{ path: '/', element: <Docked /> }])
  await expect.element(page.getByText('Playing Angeline')).toBeVisible()
  return page.getByText('Playing Angeline').element()
}

const aboveTabBar = (node: Element) =>
  node.closest('[data-now-playing]')?.nextElementSibling?.getAttribute('aria-label') === TAB_BAR

it('docks now playing across the foot of the detail column on wide, and keeps it across frames', async () => {
  const node = await mountDocked(WIDE)
  expect(node.closest('[data-column="detail"]')).not.toBeNull()

  await page.viewport(SPLIT.width, SPLIT.height)
  await expect.poll(() => node.closest('[data-column]')).toBeNull()
  expect(node.closest('[data-columns]')).not.toBeNull()

  await page.viewport(PHONE.width, PHONE.height)
  await expect.poll(() => aboveTabBar(node)).toBe(true)
  await expect.element(page.getByText('Playing Angeline')).toBeVisible()
  expect(page.getByText('Playing Angeline').element()).toBe(node)
  expect(page.getByText('Playing Angeline').elements()).toHaveLength(1)
})

it.each([
  ['split', SPLIT, '[data-columns]'],
  ['wide', WIDE, '[data-column="detail"]'],
])(
  'moves now playing from above the tab bar into the columns on %s and back',
  async (_name, frame, place) => {
    const node = await mountDocked(PHONE)
    expect(aboveTabBar(node)).toBe(true)

    await page.viewport(frame.width, frame.height)
    await expect.poll(() => node.closest(place)).not.toBeNull()
    await expect.element(page.getByText('Playing Angeline')).toBeVisible()
    expect(page.getByText('Playing Angeline').element()).toBe(node)

    await page.viewport(PHONE.width, PHONE.height)
    await expect.poll(() => aboveTabBar(node)).toBe(true)
    await expect.element(page.getByText('Playing Angeline')).toBeVisible()
    expect(page.getByText('Playing Angeline').element()).toBe(node)
  },
)

it('reserves no space at the foot of a pane while nothing plays', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE })
  await expect.element(catalog()).toBeVisible()
  expect(document.querySelector('[data-now-playing]')).toBeNull()
  expect(detailColumn()).not.toBeNull()
})

function TallPage() {
  const { id } = useParams()
  return <p style={{ height: 3000 }}>Page {id}</p>
}

function Pages() {
  const { id } = useParams()
  return (
    <Columns
      list={
        <>
          <Link to="/t/a">A</Link>
          <Link to="/t/b">B</Link>
        </>
      }
      listLabel="List"
      detail={id ? <TallPage /> : null}
      detailLabel="Page"
      empty={<p>Empty</p>}
    />
  )
}

it('opens another page in the detail at its top', async () => {
  const router = await mountShell(WIDE, [{ path: '/t/:id', element: <Pages /> }], '/t/a')
  await expect.element(page.getByText('Page a')).toBeVisible()
  const scroller = detailColumn().firstElementChild!
  scroller.scrollTop = 1500
  await expect.poll(() => scroller.scrollTop).toBe(1500)
  await router.navigate('/t/b')
  await expect.element(page.getByText('Page b')).toBeVisible()
  await expect.poll(() => scroller.scrollTop).toBe(0)
})

// The detail's scroll at each layout pass of a held page, by address and shown page.
const scrollAt = new Map<string, number>()

/** A page that keeps showing `?shown=` while the address names the next one. */
function useHeld() {
  const { id } = useParams()
  const [params] = useSearchParams()
  return { id, shown: params.get('shown') ?? id! }
}

function HeldPage() {
  const { shown } = useHeld()
  useDetailPage(shown)
  return <p style={{ height: 3000 }}>Page {shown}</p>
}

/** Records the scroll in the same commit, after its sibling page has claimed the column. */
function ScrollProbe() {
  const { id, shown } = useHeld()
  const scroller = usePane()?.scroller
  useLayoutEffect(() => {
    scrollAt.set(`${id}:${shown}`, scroller?.current?.scrollTop ?? -1)
  })
  return null
}

function HeldPages() {
  return (
    <Columns
      list={<p>List</p>}
      listLabel="List"
      detail={
        <>
          <HeldPage />
          <ScrollProbe />
        </>
      }
      detailLabel="Page"
      empty={null}
    />
  )
}

it('keeps a held page at its scroll, and starts the next one at its top in its own commit', async () => {
  scrollAt.clear()
  const router = await mountShell(WIDE, [{ path: '/t/:id', element: <HeldPages /> }], '/t/a')
  await expect.element(page.getByText('Page a')).toBeVisible()
  const scroller = detailColumn().firstElementChild!
  scroller.scrollTop = 1500
  await expect.poll(() => scroller.scrollTop).toBe(1500)

  // The address moves on while the page on screen stays.
  await router.navigate('/t/b?shown=a')
  await expect.poll(() => scrollAt.get('b:a')).toBe(1500)
  await expect.element(page.getByText('Page a')).toBeVisible()
  expect(scroller.scrollTop).toBe(1500)

  await router.navigate('/t/b')
  await expect.element(page.getByText('Page b')).toBeVisible()
  expect(scrollAt.get('b:b')).toBe(0)
})

it('shows a pane bar title outright in a pane with no column title', async () => {
  await mountShell(WIDE, [
    {
      path: '/',
      element: (
        <Columns
          list={<p>List</p>}
          listLabel="List"
          detail={<PaneBar title="Notes" />}
          detailLabel="Page"
          empty={null}
        />
      ),
    },
  ])
  const title = () => detailColumn().querySelector<HTMLElement>('[data-pane-title]')
  await expect.poll(title).not.toBeNull()
  await expect.poll(() => getComputedStyle(title()!).opacity).toBe('1')
  expect(title()).not.toHaveAttribute('aria-hidden')
})

it('rings no pushed page title it hands focus to', async () => {
  // A key last, not a click, so the browser takes the hand-off for keyboard focus.
  await userEvent.keyboard('{Shift}')
  await renderApp({ path: '/settings/sync', db: openTestDb(), frame: PHONE })
  const title = page.getByRole('main').getByRole('heading', { level: 1 })
  await expect.element(title).toHaveFocus()
  expect(title.element().matches(':focus-visible')).toBe(true)
  expect(getComputedStyle(title.element()).outlineStyle).toBe('none')
})

it('shows the separator can be dragged under the pointer and while it is', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), frame: WIDE })
  const separator = page.getByRole('separator', { name: COLUMN_WIDTH })
  await expect.element(separator).toBeInTheDocument()
  const bar = separator.element().querySelector<HTMLElement>('[aria-hidden]')!
  const shown = () => Number(getComputedStyle(bar).opacity)
  // The test pointer stays where an earlier test left it.
  await userEvent.unhover(separator)
  await expect.poll(shown).toBe(0)
  await userEvent.hover(separator)
  await expect.poll(shown).toBeCloseTo(0.4)
  onTestFinished(() => userEvent.unhover(separator))
  const at = separator.element().getBoundingClientRect()
  const fire = (type: string) =>
    separator.element().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 5,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        clientX: at.left,
        clientY: at.top + 20,
      }),
    )
  fire('pointerdown')
  await expect.element(separator).toHaveAttribute('data-dragging')
  await expect.poll(shown).toBe(1)
  fire('pointerup')
  await expect.element(separator).not.toHaveAttribute('data-dragging')
  await expect.poll(shown).toBeCloseTo(0.4)
})
