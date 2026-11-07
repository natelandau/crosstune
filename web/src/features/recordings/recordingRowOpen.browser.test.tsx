import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem } from '../../db/types'
import { destination } from '../../layout/destinations'
import { openTestDb } from '../../test/db'
import { planSheet } from '../../test/planSheet'
import { fakePlaybackEngine, fakePlayer } from '../../test/providers'
import { entitlementRow, recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { renderApp } from '../../test/renderApp'
import { PHONE, WIDE } from '../../test/practice'
import { DELETE } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { SPLIT } from '../practice/splitCopy'
import { TRIM } from '../practice/trimCopy'
import type { Player } from '../player/usePlayer'
import { PLAY_FIRST_IN_LISTS } from '../tune/playSourceText'
import { openOn } from './recordingCopy'
import { downloadName, GO_TO_TUNE, playName } from './recordingNames'

const RECORDINGS = destination('recordings')
const TUNE_PATH = '/catalog/t1'
const LIST_TUNE_PATH = '/lists/l1/tunes/t1'
const HELD = 'Fast version'
const REMOTE = 'Slow version'
const AT = '2025-03-04T12:00:00.000Z'

/** A tune in a list with a recording this device holds and one only the server holds. */
async function seed(db: CrosstuneDb) {
  await db.tunes.put(tuneRow('t1', 'Old Joe Clark'))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  await db.recordings.bulkPut([
    recordingRow('rA', { tune_id: 't1', label: HELD, position: 0, duration_ms: 60_000 }),
    recordingRow('rB', { tune_id: 't1', label: REMOTE, position: 1, duration_ms: 60_000 }),
  ])
  await db.recording_files.put(
    recordingFile('rA', {
      blob: new Blob(['x'], { type: 'audio/mp4' }),
      local_duration_ms: 60_000,
    }),
  )
  const list: LocalList = {
    id: 'l1',
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    name: 'Thursday jam',
    position: 0,
  }
  const item: LocalListItem = {
    id: 'l1-t1',
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    list_id: 'l1',
    user_tune_id: 'u-t1',
    position: 0,
  }
  await db.lists.put(list)
  await db.list_items.put(item)
}

async function mount(
  path: string,
  {
    frame = WIDE,
    player,
    lapsed = false,
    before,
  }: {
    frame?: { width: number; height: number }
    player?: Player
    lapsed?: boolean
    before?: (db: CrosstuneDb) => Promise<unknown>
  } = {},
) {
  const db = openTestDb()
  await seed(db)
  await before?.(db)
  if (lapsed) await db.entitlements.put(entitlementRow())
  const analytics = recordingAnalytics()
  const download = vi.fn(async () => null)
  const app = await renderApp({
    path,
    db,
    frame,
    player,
    playbackEngine: fakePlaybackEngine(),
    sync: { download },
    wrap: (root) => <AnalyticsProvider client={analytics}>{root}</AnalyticsProvider>,
  })
  return { ...app, db, analytics, download }
}

const row = (title: string) => page.getByRole('row', { name: new RegExp(`^${title}`) })
// On the title, since in a narrow column the row's hover actions reach its middle.
const tapRow = (title: string) => row(title).getByText(title, { exact: true }).click()
const opened = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name === 'recording_page_opened')

it.each([
  ['the Recordings list', RECORDINGS.root, `${RECORDINGS.root}/recording/rA`, 'recordings_list'],
  ['the tune page', TUNE_PATH, `${TUNE_PATH}/recordings/rA`, 'tune'],
  ["a list's tune page", LIST_TUNE_PATH, `${LIST_TUNE_PATH}/recordings/rA`, 'tune'],
] as const)('a row tap opens the recording page from %s', async (_, path, to, source) => {
  const player = fakePlayer()
  const { router, analytics } = await mount(path, { player })
  await tapRow(HELD)
  await expect.poll(() => router.state.location.pathname).toBe(to)
  await expect
    .poll(() => opened(analytics).map((send) => send.props))
    .toEqual([expect.objectContaining({ recording_id: 'rA', source })])
  expect(player.play).not.toHaveBeenCalled()
})

it('the play glyph plays without opening the page', async () => {
  const player = fakePlayer()
  const { router } = await mount(TUNE_PATH, { player })
  await row(HELD)
    .getByRole('button', { name: playName(HELD), exact: true })
    .click()
  await expect
    .poll(() => vi.mocked(player.play).mock.calls[0]?.[0])
    .toEqual({ kind: 'recording', id: 'rA' })
  expect(router.state.location.pathname).toBe(TUNE_PATH)
})

it('Enter on a focused row opens the recording page', async () => {
  const player = fakePlayer()
  const { router } = await mount(TUNE_PATH, { player })
  await expect.element(row(HELD)).toBeVisible()
  ;(row(HELD).element() as HTMLElement).focus()
  await expect.element(row(HELD)).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => router.state.location.pathname).toBe(`${TUNE_PATH}/recordings/rA`)
  expect(player.play).not.toHaveBeenCalled()
})

it.each([
  ['Enter', '{Enter}'],
  ['Space', ' '],
] as const)('%s on the focused play glyph plays without opening the page', async (_, key) => {
  const player = fakePlayer()
  const { router } = await mount(TUNE_PATH, { player })
  const slot = row(HELD).getByRole('button', { name: playName(HELD), exact: true })
  await expect.element(slot).toBeVisible()
  ;(slot.element() as HTMLElement).focus()
  await expect.element(slot).toHaveFocus()
  await userEvent.keyboard(key)
  await expect
    .poll(() => vi.mocked(player.play).mock.calls.map(([item]) => item))
    .toEqual([{ kind: 'recording', id: 'rA' }])
  expect(router.state.location.pathname).toBe(TUNE_PATH)
})

it('the download glyph downloads without opening the page', async () => {
  const { router, download } = await mount(TUNE_PATH)
  await row(REMOTE)
    .getByRole('button', { name: downloadName(REMOTE), exact: true })
    .click()
  await expect.poll(() => download.mock.calls).toEqual([['rB']])
  expect(router.state.location.pathname).toBe(TUNE_PATH)
})

it("a row's only swipe and menu action is Delete", async () => {
  await mount(TUNE_PATH)
  const target = row(HELD)
  await expect.element(target).toBeVisible()
  await expect
    .poll(() =>
      target
        .getByRole('button')
        .elements()
        .map((button) => button.getAttribute('aria-label')),
    )
    .toEqual([DELETE, playName(HELD)])
  await target.click({ button: 'right' })
  await expect.element(page.getByRole('menuitem', { name: DELETE })).toBeVisible()
  await expect
    .poll(() =>
      page
        .getByRole('menuitem')
        .elements()
        .map((item) => item.textContent),
    )
    .toEqual([DELETE])
})

it('the page menu holds Pin, Go to tune, Trim, Split, and Delete, and pins the recording', async () => {
  const { db } = await mount(`${TUNE_PATH}/recordings/rA`, { frame: PHONE })
  await page.getByRole('main').getByRole('button', { name: MORE_ACTIONS }).click()
  await expect.element(page.getByRole('menuitem', { name: DELETE })).toBeVisible()
  await expect
    .poll(() =>
      page
        .getByRole('menuitem')
        .elements()
        .map((item) => item.textContent),
    )
    .toEqual([PLAY_FIRST_IN_LISTS, GO_TO_TUNE, TRIM, SPLIT, DELETE])
  await page.getByRole('menuitem', { name: PLAY_FIRST_IN_LISTS }).click()
  await expect.poll(async () => (await db.user_tunes.get('u-t1'))?.play_recording_id).toBe('rA')
})

it('the page menu offers Open on the site an import came from', async () => {
  await mount(`${TUNE_PATH}/recordings/rA`, {
    frame: PHONE,
    before: (db) =>
      db.recordings.update('rA', {
        origin: 'slippery_hill',
        origin_url: 'https://www.slippery-hill.com/content/x',
      }),
  })
  await page.getByRole('main').getByRole('button', { name: MORE_ACTIONS }).click()
  await expect.element(page.getByRole('menuitem', { name: openOn('Slippery-Hill') })).toBeVisible()
})

it("a lapsed account's row slot opens the Plan sheet and the row opens the page", async () => {
  const player = fakePlayer()
  // The Recordings list, since a lapsed tune page folds its recordings away.
  const { router } = await mount(RECORDINGS.root, { player, lapsed: true })
  await row(HELD)
    .getByRole('button', { name: playName(HELD), exact: true })
    .click()
  await expect.element(planSheet()).toBeVisible()
  expect(player.play).not.toHaveBeenCalled()
  expect(router.state.location.pathname).toBe(RECORDINGS.root)
  await userEvent.keyboard('{Escape}')
  await expect.element(planSheet()).not.toBeInTheDocument()
  await tapRow(HELD)
  await expect.poll(() => router.state.location.pathname).toBe(`${RECORDINGS.root}/recording/rA`)
})
