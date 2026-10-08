import { act, render } from '@testing-library/react'
import { page } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import { StrictMode, use, useEffect } from 'react'
import { Outlet, RouterProvider, createMemoryRouter, useLocation } from 'react-router'
import { PlaybackEngineProvider } from '../features/player/PlaybackEngineProvider'
import { PlayerProvider } from '../features/player/PlayerProvider'
import { APPEARANCE } from '../features/settings/settingsCopy'
import { RECORD_LABEL } from './tabs'
import { STATS_TITLE } from '../features/stats/copy'
import { openTestDb } from '../test/db'
import { dataProviders } from '../test/providers'
import { tuneRow, userTuneRow } from '../test/rows'
import { renderApp } from '../test/renderApp'
import { ConfirmProvider } from '../ui/Confirm'
import { ToastProvider } from '../ui/Toast'
import { NOT_FOUND_TITLE, OPEN_CATALOG } from './NotFoundPage'
import { createAppRouter, type AppRouter } from './router'
import { routes } from './routes'
import { useDestination } from './useDestination'
import { AppRouterContext } from './appRouterContext'
import { usePageShown } from './usePageShown'
import { destination, type Destination, readStored, rememberLocation } from './destinations'
import { readStoredTrail, reloadBackTrailForTest } from './backTrail'

// Settings reads who is signed in, and the tests mount no Clerk.
vi.mock('@clerk/react', () => import('../fixture/clerkStub'))

const SETTINGS = destination('settings')

const probe: { dest?: ReturnType<typeof useDestination> } = {}

/**
 * Holds React's commit of any address under `prefix` until `release`, so a test can act while
 * the router has moved on and the screen still shows where it was, as on a slow phone.
 */
const hold: { prefix?: string; until?: Promise<void>; release?: () => void } = {}

function holdRender(prefix: string) {
  let release = () => {}
  const until = new Promise<void>((resolve) => (release = resolve))
  Object.assign(hold, { prefix, until, release })
  onTestFinished(() => {
    hold.release?.()
    Object.assign(hold, { prefix: undefined, until: undefined, release: undefined })
  })
}

function Hold() {
  const { pathname } = useLocation()
  if (hold.prefix && hold.until && pathname.startsWith(hold.prefix)) use(hold.until)
  return null
}

function Probe() {
  const destination = useDestination()
  useEffect(() => {
    probe.dest = destination
    return () => void (probe.dest = undefined)
  }, [destination])
  return (
    <>
      <Hold />
      <Outlet />
    </>
  )
}

const AT = '2026-01-01T00:00:00.000Z'
const LIST_NAME = 'Tuesday jam'

/** A database holding the tunes and the list the paths here name, since a page leaves once
 * what it shows is gone. */
async function seededDb() {
  const db = openTestDb()
  for (const id of ['t1', 't2']) {
    await db.tunes.put(tuneRow(id, `Tune ${id}`))
    await db.user_tunes.put(userTuneRow(`u-${id}`, id))
  }
  await db.lists.put({
    id: 'l1',
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    name: LIST_NAME,
    position: 0,
  })
  return db
}

/** The app's routes under a probe that exposes `useDestination` to the test. */
async function mount(
  path: string | string[],
  beforeRender?: (router: AppRouter) => void,
): Promise<AppRouter> {
  const initialEntries = typeof path === 'string' ? [path] : path
  const router = createMemoryRouter([{ element: <Probe />, children: routes }], {
    initialEntries,
    initialIndex: initialEntries.length - 1,
  })
  onTestFinished(() => router.dispose())
  beforeRender?.(router)
  // The catalog route reads the catalog and asks before a delete, a list reports through the
  // toast, and a tune's page plays its recordings, so the routes need a database, somewhere to
  // ask, a toast, and a player.
  const Data = dataProviders({ db: await seededDb() })
  // Awaited, since a tune's page suspends until its title reads.
  await act(async () => {
    render(
      <Data>
        <ConfirmProvider>
          <ToastProvider>
            <PlaybackEngineProvider>
              <PlayerProvider>
                <AppRouterContext value={router}>
                  <RouterProvider router={router} />
                </AppRouterContext>
              </PlayerProvider>
            </PlaybackEngineProvider>
          </ToastProvider>
        </ConfirmProvider>
      </Data>,
    )
  })
  await expect.poll(() => probe.dest).toBeDefined()
  return router
}

const at = (router: AppRouter) => () => router.state.location.pathname
const go = (to: Destination) => act(() => probe.dest?.go(to))

it('returns to where a destination last was, then to its root', async () => {
  const router = await mount('/catalog/t1')
  await expect.element(page.getByRole('main', { name: 'Tune' })).toBeVisible()
  await go('lists')
  await expect.poll(at(router)).toBe('/lists')
  // The router moves before React commits the screen that follows it.
  await expect.poll(() => probe.dest?.current).toBe('lists')
  await go('catalog')
  await expect.poll(at(router)).toBe('/catalog/t1')
  await go('catalog')
  await expect.poll(at(router)).toBe('/catalog')
})

it('a second tap on a destination opens its root before the first tap has rendered', async () => {
  const router = await mount('/settings/appearance')
  await expect.element(page.getByRole('main', { name: APPEARANCE })).toBeVisible()
  await router.navigate('/catalog/t1')
  await expect.element(page.getByRole('main', { name: 'Tune' })).toBeVisible()
  holdRender('/settings')
  // Both taps read the destination the screen still shows, as a double tap on the bar does.
  const { go: tap } = probe.dest!
  await act(async () => {
    tap('settings')
    await expect.poll(at(router)).toBe('/settings/appearance')
    tap('settings')
  })
  await expect.poll(at(router)).toBe('/settings')
  await act(async () => hold.release?.())
  await expect.element(page.getByRole('main', { name: SETTINGS.label })).toBeVisible()
})

it('a quick switch back keeps the place the screen still shows', async () => {
  const router = await mount('/catalog/t1')
  await expect.element(page.getByRole('main', { name: 'Tune' })).toBeVisible()
  holdRender('/settings')
  const { go: tap } = probe.dest!
  await act(async () => {
    tap('settings')
    await expect.poll(at(router)).toBe('/settings')
    tap('catalog')
  })
  await expect.poll(at(router)).toBe('/catalog/t1')
  await act(async () => hold.release?.())
  await expect.element(page.getByRole('main', { name: 'Tune' })).toBeVisible()
})

it('a second tap lands on the root while the first tap is still loading', async () => {
  let release = () => {}
  const loading = new Promise<null>((resolve) => (release = () => resolve(null)))
  onTestFinished(() => release())
  const router = createMemoryRouter(
    [
      {
        element: <Probe />,
        children: [
          { path: '/catalog', element: <p>catalog</p> },
          { path: '/settings', element: <p>settings</p> },
          // A page whose data is still on its way, so the router holds the tap as pending.
          { path: '/settings/:page', loader: () => loading, element: <p>page</p> },
        ],
      },
    ],
    { initialEntries: ['/catalog'] },
  )
  onTestFinished(() => router.dispose())
  rememberLocation('settings', '/settings/appearance')
  render(
    <AppRouterContext value={router}>
      <RouterProvider router={router} />
    </AppRouterContext>,
  )
  await expect.poll(() => probe.dest?.current).toBe('catalog')
  const { go: tap } = probe.dest!
  await act(async () => {
    tap('settings')
    await expect.poll(() => router.state.navigation.location?.pathname).toBe('/settings/appearance')
    expect(router.state.location.pathname).toBe('/catalog')
    tap('settings')
  })
  await expect.poll(at(router)).toBe('/settings')
  release()
  await expect.element(page.getByText('settings', { exact: true })).toBeVisible()
})

it('opens the root of a destination never visited', async () => {
  const router = await mount('/catalog')
  await go('recordings')
  await expect.poll(at(router)).toBe('/recordings')
})

it('root always opens the destination root', async () => {
  const router = await mount('/lists/l1')
  await expect.element(page.getByRole('main', { name: LIST_NAME })).toBeVisible()
  await act(() => probe.dest?.root('lists'))
  await expect.poll(at(router)).toBe('/lists')
})

it('keeps the place across a reload', async () => {
  const first = await mount('/settings/stats')
  await expect.element(page.getByRole('main', { name: STATS_TITLE })).toBeVisible()
  await first.navigate('/lists')
  await expect.poll(at(first)).toBe('/lists')
  // A reload re-reads sessionStorage; the stored value must be what the map held.
  expect(JSON.parse(sessionStorage.getItem('crosstune.destinations') ?? '{}')).toMatchObject({
    settings: '/settings/stats',
  })
})

it('walks back to the parent after a reload when a gone tune leaves', async () => {
  const router = await mount(['/catalog', '/catalog/gone'], (router) => {
    // The trail this session wrote before the reload, read back as a reload does.
    sessionStorage.setItem(
      'crosstune.backTrail',
      JSON.stringify([[router.state.location.key, '/catalog']]),
    )
    reloadBackTrailForTest()
  })
  await expect.poll(at(router)).toBe('/catalog')
  expect(router.state.historyAction).toBe('POP')
})

it('mirrors each pushed entry to the session, and drops a malformed mirror', async () => {
  const router = await mount('/catalog')
  await router.navigate('/catalog/t1')
  await expect.poll(at(router)).toBe('/catalog/t1')
  await expect.poll(() => readStoredTrail().get(router.state.location.key)).toBe('/catalog')
  sessionStorage.setItem('crosstune.backTrail', JSON.stringify([['k', 1], 'x', ['a', 'b']]))
  expect([...readStoredTrail()]).toEqual([['a', 'b']])
  sessionStorage.setItem('crosstune.backTrail', '{not json')
  expect(readStoredTrail().size).toBe(0)
})

it('reports the destination of the current path', async () => {
  await mount('/recordings/t1')
  await expect.poll(() => probe.dest?.current).toBe('recordings')
})

it('Back from a tune opened in a list returns to the list', async () => {
  const router = await mount('/lists/l1')
  await router.navigate('/lists/l1/tunes/t1')
  await expect.element(page.getByRole('main', { name: 'Tune' })).toBeVisible()
  await router.navigate(-1)
  await expect.poll(at(router)).toBe('/lists/l1')
})

it('mounts the app on its first entry, settled, without moving history', async () => {
  const { router } = await renderApp({ path: '/catalog', db: await seededDb() })
  expect(router.state.initialized).toBe(true)
  expect(router.state.historyAction).toBe('POP')
  expect(router.state.location.key).toBe('default')
})

it('redirects /tunes/:id to the tune home path in place', async () => {
  const app = await renderApp({ path: '/tunes/t1', db: await seededDb() })
  await expect.element(page.getByRole('main', { name: 'Tune' })).toBeVisible()
  await expect.poll(at(app.router)).toBe('/catalog/t1')
  expect(app.router.state.historyAction).toBe('REPLACE')
})

it.each(['/songs/t1', '/lists/l1/songs/t1', '/nowhere'])(
  'shows the not-found page at %s, inside the shell',
  async (path) => {
    const { router } = await renderApp({ path, db: await seededDb() })
    await expect
      .element(page.getByRole('heading', { name: NOT_FOUND_TITLE, level: 1 }))
      .toBeVisible()
    await expect.element(page.getByRole('main', { name: NOT_FOUND_TITLE })).toBeVisible()
    await expect.element(page.getByRole('button', { name: RECORD_LABEL })).toBeVisible()
    expect(router.state.location.pathname).toBe(path)
  },
)

it("never remembers a not-found address as a destination's place", async () => {
  const router = await mount('/lists/l1/songs/t1')
  await go('catalog')
  await expect.poll(at(router)).toBe('/catalog')
  await go('lists')
  await expect.poll(at(router)).toBe('/lists')
})

it('opens the catalog from the not-found page', async () => {
  const { router } = await renderApp({ path: '/songs/t1', db: await seededDb() })
  await page.getByRole('button', { name: OPEN_CATALOG }).click()
  await expect.poll(at(router)).toBe('/catalog')
})

it('redirects / to the catalog in place', async () => {
  const router = await mount('/')
  await expect.poll(at(router)).toBe('/catalog')
  expect(router.state.historyAction).toBe('REPLACE')
})

it.each([
  ['/settings', SETTINGS.label],
  ['/settings/appearance', APPEARANCE],
])('renders %s', async (path, name) => {
  await renderApp({ path, db: await seededDb() })
  await expect.element(page.getByRole('main', { name })).toBeVisible()
})

it('sends an unknown settings page to Settings', async () => {
  const { router } = await renderApp({ path: '/settings/nope', db: await seededDb() })
  await expect.poll(at(router)).toBe(SETTINGS.root)
  expect(router.state.historyAction).toBe('REPLACE')
})

it('keeps a stored place that carries a query or hash, and drops the rest', () => {
  sessionStorage.setItem(
    'crosstune.destinations',
    JSON.stringify({
      catalog: '/catalog?status=known',
      lists: '/catalog/t1',
      recordings: '/recordings/t1#top',
      settings: 'nope',
    }),
  )
  expect(readStored()).toEqual({
    catalog: '/catalog?status=known',
    recordings: '/recordings/t1#top',
  })
  sessionStorage.setItem('crosstune.destinations', '{not json')
  expect(readStored()).toEqual({})
})

function Shown({ onShown }: { onShown: () => void }) {
  usePageShown(onShown)
  return <main aria-label="Shown" />
}

it('usePageShown fires once on mount and again on return, not while a child is open', async () => {
  let calls = 0
  const router = createMemoryRouter(
    [
      {
        path: '/a',
        element: (
          <>
            <Shown onShown={() => calls++} />
            <Outlet />
          </>
        ),
        children: [{ path: 'child', element: <p>child</p> }],
      },
      { path: '/b', element: <p>b</p> },
    ],
    { initialEntries: ['/a'] },
  )
  onTestFinished(() => router.dispose())
  render(<RouterProvider router={router} />)
  await expect.poll(() => calls).toBe(1)
  await router.navigate('/a/child')
  await expect.element(page.getByText('child')).toBeVisible()
  expect(calls).toBe(1)
  await router.navigate(-1)
  await expect.poll(() => calls).toBe(2)
  await router.navigate('/b')
  await expect.element(page.getByText('b', { exact: true })).toBeVisible()
  await router.navigate(-1)
  await expect.poll(() => calls).toBe(3)
})

it('usePageShown fires once on first mount under StrictMode', async () => {
  let calls = 0
  const router = createMemoryRouter(
    [
      {
        path: '/a',
        element: (
          <>
            <Shown onShown={() => calls++} />
            <Outlet />
          </>
        ),
        children: [{ path: 'child', element: <p>child</p> }],
      },
    ],
    { initialEntries: ['/a'] },
  )
  onTestFinished(() => router.dispose())
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
  await expect.poll(() => calls).toBeGreaterThan(0)
  await router.navigate('/a/child')
  await expect.element(page.getByText('child')).toBeVisible()
  expect(calls).toBe(1)
})

it('usePageShown treats a trailing slash as the same location', async () => {
  let calls = 0
  const router = createMemoryRouter(
    [
      { path: '/a', element: <Shown onShown={() => calls++} /> },
      { path: '/b', element: <p>b</p> },
    ],
    { initialEntries: ['/a/'] },
  )
  onTestFinished(() => router.dispose())
  render(<RouterProvider router={router} />)
  await expect.poll(() => calls).toBe(1)
})

it('reads its place from the root of the address bar', () => {
  const before = location.href
  history.replaceState(null, '', '/catalog')
  onTestFinished(() => history.replaceState(null, '', before))
  const router = createAppRouter()
  onTestFinished(() => router.dispose())
  expect(router.state.errors).toBeNull()
  expect(router.state.matches.at(-1)?.pathname).toBe('/catalog')
})
