import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { STATS_TITLE } from '../features/stats/copy'
import { openTestDb } from '../test/db'
import { recordingRow, tuneRow, userTuneRow } from '../test/rows'
import { SETTINGS_PAGES } from '../features/settings/settingsPages'
import { renderApp } from '../test/renderApp'
import { TUNE } from '../features/tune/tunePageCopy'
import { destination } from './destinations'
import { NOT_FOUND_TITLE } from './NotFoundPage'

// Settings reads who is signed in, and the tests mount no Clerk.
vi.mock('@clerk/react', () => import('../fixture/clerkStub'))

const AT = '2026-01-01T00:00:00.000Z'
const LIST_NAME = 'Tuesday jam'

const FRAMES = [
  ['phone', { width: 390, height: 844 }],
  ['split', { width: 820, height: 1180 }],
  ['wide', { width: 1280, height: 800 }],
] as const

/** A tune in a list with a recording filed under it, so every tune path has something to show. */
async function seededDb() {
  const db = openTestDb()
  await db.tunes.put(tuneRow('t1', "Soldier's Joy"))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  await db.lists.put({
    id: 'l1',
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    name: LIST_NAME,
    position: 0,
  })
  await db.list_items.put({
    id: 'l1-t1',
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    list_id: 'l1',
    user_tune_id: 'u-t1',
    position: 0,
  })
  await db.recordings.put(recordingRow('r1', { tune_id: 't1', label: 'Jam recording' }))
  return db
}

/** Each address a refresh or a shared link can land on, and the pane it shows. */
const SHAPES: [path: string, pane: string][] = [
  ['/catalog', destination('catalog').label],
  ['/catalog/t1', TUNE],
  ['/lists', destination('lists').label],
  ['/lists/l1', LIST_NAME],
  ['/lists/l1/tunes/t1', TUNE],
  ['/recordings', destination('recordings').label],
  ['/recordings/t1', TUNE],
  ['/settings', destination('settings').label],
  ...SETTINGS_PAGES.map((spec): [string, string] => [`/settings/${spec.id}`, spec.title]),
  ['/settings/stats', STATS_TITLE],
  ['/settings/stats/tunes/t1', TUNE],
]

/**
 * Whether a content pane by this name shows: the main region alone, or the list column beside
 * the detail. Only the panes carry an aria-label; the sidebar's groups are named by headings.
 */
const paneShows = (name: string) => () =>
  [...document.querySelectorAll(`[aria-label="${CSS.escape(name)}"]`)].some(
    (pane) => ['MAIN', 'SECTION'].includes(pane.tagName) && pane.checkVisibility(),
  )

describe.each(FRAMES)('on the %s frame', (_, frame) => {
  it.each(SHAPES)('opens %s by its address', async (path, name) => {
    const { router } = await renderApp({ path, db: await seededDb(), frame })
    await expect.poll(paneShows(name)).toBe(true)
    expect(router.state.location.pathname).toBe(path)
  })

  it('shows the not-found page for an old /songs link, keeping the address', async () => {
    const { router } = await renderApp({ path: '/songs/t1', db: await seededDb(), frame })
    await expect
      .element(page.getByRole('heading', { name: NOT_FOUND_TITLE, level: 1 }))
      .toBeVisible()
    expect(router.state.location.pathname).toBe('/songs/t1')
  })

  it('opens a /tunes link as the tune in the catalog, replacing the link', async () => {
    const { router } = await renderApp({ path: '/tunes/t1', db: await seededDb(), frame })
    await expect.element(page.getByRole('main', { name: TUNE })).toBeVisible()
    expect(router.state.location.pathname).toBe('/catalog/t1')
    expect(router.state.historyAction).toBe('REPLACE')
  })
})
