import { page, userEvent } from 'vitest/browser'
import { act } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem } from '../../db/types'
import { destination } from '../../layout/destinations'
import type * as RecordStateModule from '../capture/RecordState'
import { pauseListName, playListName, SHUFFLE } from './listPlayCopy'
import { PLAY } from '../player/transportCopy'
import { PLAYER_REGION } from '../player/playerCopy'
import { openTestDb } from '../../test/db'
import { FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import { linkRow, recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { renderApp } from '../../test/renderApp'

/** Forces the recorder's `recording` flag, so a test can hold a recording without a microphone. */
const recorder = vi.hoisted(() => {
  let recording = false
  const listeners = new Set<() => void>()
  return {
    get: () => recording,
    set: (next: boolean) => {
      recording = next
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})

vi.mock('../capture/RecordState', async (importOriginal) => {
  const actual = await importOriginal<typeof RecordStateModule>()
  return {
    ...actual,
    useRecordState: () => {
      const state = actual.useRecordState()
      const forced = useSyncExternalStore(recorder.subscribe, recorder.get)
      return { ...state, recording: state.recording || forced }
    },
  }
})

const WIDE = { width: 1280, height: 800 }
const AT = '2026-01-01T00:00:00.000Z'
const LISTS = destination('lists')

/**
 * Thursday jam holds a recording this device holds and a link-only tune, so it plays. Session tunes
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

/** Waits until the lists' sources have read, when Thursday jam's menu offers Play. */
async function sourcesRead() {
  await listRow('Thursday jam').click({ button: 'right' })
  await expect.element(page.getByRole('menuitem', { name: PLAY, exact: true })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
}

/** Plays a list from its row's menu. */
async function playFromMenu(name: string) {
  await listRow(name).click({ button: 'right' })
  await page.getByRole('menuitem', { name: PLAY, exact: true }).click()
}

it('offers no play button on a list until it plays', async () => {
  await mount()
  await sourcesRead()
  expect(playList('Thursday jam').query()).toBeNull()
  expect(playList('Session tunes').query()).toBeNull()
  expect(playList('Empty').query()).toBeNull()
})

it('plays the list from its row menu without opening it', async () => {
  const { router } = await mount()
  await playFromMenu('Thursday jam')
  await expect.element(page.getByRole('region', { name: PLAYER_REGION })).toBeVisible()
  await expect.element(listRow('Thursday jam')).toHaveAttribute('data-playing')
  await expect.poll(() => router.state.location.pathname).toBe(LISTS.root)
})

it('shows the playing list as playing, and pauses and resumes it from its row', async () => {
  const { engine } = await mount()
  await playFromMenu('Thursday jam')
  await expect.poll(() => engine.getState().playing).toBe(true)
  const pause = page.getByRole('button', { name: pauseListName('Thursday jam') })
  await expect.element(pause).toBeEnabled()
  expect(pause.element().querySelector('[data-playing-glyph]')).not.toBeNull()
  await pause.click()
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
  await sourcesRead()
  await listRow('Session tunes').click({ button: 'right' })
  await expect.element(page.getByRole('menu')).toBeVisible()
  expect(page.getByRole('menuitem', { name: PLAY, exact: true }).query()).toBeNull()
  expect(page.getByRole('menuitem', { name: SHUFFLE, exact: true }).query()).toBeNull()
})

it('leaves Play and Shuffle out of the menu while a recording is under way, then offers them', async () => {
  await mount()
  await sourcesRead()
  act(() => recorder.set(true))
  try {
    await listRow('Thursday jam').click({ button: 'right' })
    await expect.element(page.getByRole('menu')).toBeVisible()
    await expect
      .element(page.getByRole('menuitem', { name: PLAY, exact: true }))
      .not.toBeInTheDocument()
    expect(page.getByRole('menuitem', { name: SHUFFLE, exact: true }).query()).toBeNull()
  } finally {
    act(() => recorder.set(false))
  }
  await userEvent.keyboard('{Escape}')
  await sourcesRead()
})
