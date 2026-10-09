import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem } from '../../db/types'
import { destination } from '../../app/destinations'
import { RECORD_LABEL } from '../../app/tabs'
import { NEW_RECORDING } from '../capture/recordCopy'
import { pauseListName, playListName, SHUFFLE } from './listPlayCopy'
import { PLAY } from '../player/transportCopy'
import { PLAYER_REGION } from '../player/playerCopy'
import { openTestDb } from '../../test/db'
import { fakeMediaForTest } from '../../test/fakeMedia'
import { FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import { linkRow, recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { renderApp } from '../../test/renderApp'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const AT = '2026-01-01T00:00:00.000Z'
const LISTS = destination('lists')

/**
 * Thursday jam holds a take this device holds and a link-only tune, so it plays. Session tunes
 * holds only the link-only tune, and Empty holds nothing, so neither plays.
 */
async function seed(db: CrosstuneDb) {
  const row = { created_at: AT, updated_at: AT, deleted_at: null, server_seq: 0 }
  const list = (id: string, name: string, position: number): LocalList => ({
    id,
    ...row,
    name,
    position,
  })
  const item = (listId: string, tuneId: string, position: number): LocalListItem => ({
    id: `${listId}-${tuneId}`,
    ...row,
    list_id: listId,
    user_tune_id: `u-${tuneId}`,
    position,
  })
  await db.tunes.bulkPut([tuneRow('t1', 'Old Joe Clark'), tuneRow('t2', 'Forked Deer')])
  await db.user_tunes.bulkPut([userTuneRow('u-t1', 't1'), userTuneRow('u-t2', 't2')])
  await db.recordings.put(
    recordingRow('r-t1', { tune_id: 't1', duration_ms: 3000, source_duration_ms: 3000 }),
  )
  await db.recording_files.put(
    recordingFile('r-t1', {
      blob: new Blob(['x'], { type: 'audio/mp4' }),
      local_duration_ms: 3000,
    }),
  )
  await db.recording_links.put(linkRow('k-t2', 't2'))
  await db.lists.bulkPut([
    list('l1', 'Thursday jam', 0),
    list('l2', 'Session tunes', 1),
    list('l3', 'Empty', 2),
  ])
  await db.list_items.bulkPut([item('l1', 't1', 0), item('l1', 't2', 1), item('l2', 't2', 0)])
}

async function mount(frame = WIDE, density: 'pointer' | 'touch' = 'pointer') {
  const db = openTestDb()
  await seed(db)
  const element = new FakeAudioElement()
  const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
  const app = await renderApp({ path: LISTS.root, db, frame, density, playbackEngine: engine })
  return { ...app, db, engine }
}

const listRow = (name: string) =>
  page.getByRole('grid', { name: LISTS.label }).getByRole('row', { name: new RegExp(name) })
const playList = (name: string) => page.getByRole('button', { name: playListName(name) })

it('offers Play on a list with something to play and on no other', async () => {
  await mount()
  await expect.element(playList('Thursday jam')).toBeInTheDocument()
  await expect.element(listRow('Session tunes')).toBeVisible()
  await expect.element(listRow('Empty')).toBeVisible()
  expect(playList('Session tunes').query()).toBeNull()
  expect(playList('Empty').query()).toBeNull()
})

it('shows Play on touch, where nothing hovers', async () => {
  await mount(PHONE, 'touch')
  await expect.element(playList('Thursday jam')).toBeVisible()
})

it('plays the list from its row without opening it', async () => {
  const { router } = await mount()
  await playList('Thursday jam').click()
  await expect.element(page.getByRole('region', { name: PLAYER_REGION })).toBeVisible()
  await expect.element(listRow('Thursday jam')).toHaveAttribute('data-playing')
  await expect.poll(() => router.state.location.pathname).toBe(LISTS.root)
})

it('pauses and resumes the playing list from its row', async () => {
  const { engine } = await mount()
  await playList('Thursday jam').click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await page.getByRole('button', { name: pauseListName('Thursday jam') }).click()
  await expect.poll(() => engine.getState().playing).toBe(false)
  await playList('Thursday jam').click()
  await expect.poll(() => engine.getState().playing).toBe(true)
})

it('offers Play and Shuffle in the menu of a list that plays', async () => {
  await mount()
  await listRow('Thursday jam').click({ button: 'right' })
  await expect.element(page.getByRole('menuitem', { name: PLAY, exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: SHUFFLE, exact: true }).click()
  await expect.element(listRow('Thursday jam')).toHaveAttribute('data-playing')
})

it('leaves Play and Shuffle out of the menu of a list with nothing to play', async () => {
  await mount()
  await expect.element(playList('Thursday jam')).toBeInTheDocument()
  await listRow('Session tunes').click({ button: 'right' })
  await expect.element(page.getByRole('menu')).toBeVisible()
  expect(page.getByRole('menuitem', { name: PLAY, exact: true }).query()).toBeNull()
  expect(page.getByRole('menuitem', { name: SHUFFLE, exact: true }).query()).toBeNull()
})

it('takes Play away while a take records', async () => {
  fakeMediaForTest()
  await mount()
  await expect.element(playList('Thursday jam')).toBeInTheDocument()
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  await expect.element(page.getByRole('dialog', { name: NEW_RECORDING })).toBeVisible()
  // The lists sit inert behind the record sheet.
  await expect
    .element(page.getByRole('button', { name: playListName('Thursday jam'), includeHidden: true }))
    .not.toBeInTheDocument()
})
