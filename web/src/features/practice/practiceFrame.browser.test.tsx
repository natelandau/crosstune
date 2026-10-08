import { expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem } from '../../db/types'
import { listPosition, NEXT_TUNE, PREVIOUS_TUNE } from '../player/playerCopy'
import { OPEN_RECORDING, PLAY } from '../player/transportCopy'
import { openTestDb } from '../../test/db'
import { FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import { recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import {
  mountPlaying,
  openPractice,
  PHONE,
  practice,
  press,
  TAKE,
  waveform,
  WIDE,
} from '../../test/practice'
import { renderApp } from '../../test/renderApp'
import { SIDEBAR } from '../../app/Sidebar'

import { DELETE_LOOP, LOOP_NAME_SUGGESTIONS, NEW_LOOP } from './practiceCopy'
import { TAB_BAR } from '../../app/tabs'

const dialog = () => page.getByRole('dialog', { name: TAKE })
const box = (selector: string) =>
  practice()?.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null

it('centers the transport in a wide window', async () => {
  await mountPlaying(WIDE)
  await openPractice()
  await expect.poll(() => box('[data-practice-transport]')?.width ?? 0).toBeGreaterThan(0)
  const transport = box('[data-practice-transport]')!
  expect(Math.abs(transport.left + transport.width / 2 - WIDE.width / 2)).toBeLessThan(2)
})

it.each([
  ['768x1024', 'regular', { width: 768, height: 1024 }],
  ['810x1080', 'regular', { width: 810, height: 1080 }],
  ['820x1180', 'regular', { width: 820, height: 1180 }],
  ['768x1024', 'roomy', { width: 768, height: 1024 }],
  ['810x1080', 'roomy', { width: 810, height: 1080 }],
  ['820x1180', 'roomy', { width: 820, height: 1180 }],
] as const)(
  'shows every control on a %s touch tablet at the %s text size, unscrolled',
  async (_name, textSize, frame) => {
    if (textSize === 'roomy') {
      document.documentElement.dataset.textSize = 'roomy'
      onTestFinished(() => {
        delete document.documentElement.dataset.textSize
      })
    }
    const { db } = await mountPlaying(frame, { density: 'touch' })
    await db.tunes.update('t1', { part_structure: 'AABB' })
    await openPractice()
    await dialog().getByRole('button', { name: NEW_LOOP, exact: true }).click()
    await expect.poll(() => practice()?.querySelector('button[data-name-tab]')).not.toBeNull()
    practice()!.querySelector<HTMLElement>('button[data-name-tab]')!.click()
    const chips = dialog().getByRole('group', { name: LOOP_NAME_SUGGESTIONS })
    await expect.element(chips.getByRole('button', { name: 'A part' })).toBeVisible()

    const below = practice()!.querySelector<HTMLElement>('[data-practice-below]')!
    expect(below.scrollHeight).toBeLessThanOrEqual(below.clientHeight)
    const shown = below.getBoundingClientRect()
    const controls = [
      '[data-practice-transport]',
      '[data-mode-selector]',
      '[data-mode-panel="loops"]',
      '[data-practice-zoom]',
    ].map((selector) => practice()!.querySelector<HTMLElement>(selector)!)
    for (const name of [NEW_LOOP, DELETE_LOOP]) {
      controls.push(dialog().getByRole('button', { name, exact: true }).element() as HTMLElement)
    }
    controls.push(chips.getByRole('button', { name: 'A part' }).element() as HTMLElement)
    for (const control of controls) {
      const rect = control.getBoundingClientRect()
      expect(rect.top).toBeGreaterThanOrEqual(0)
      expect(rect.bottom).toBeLessThanOrEqual(Math.min(shown.bottom, frame.height) + 0.5)
    }
  },
)

it('holds the screen awake while practice shows', async () => {
  const release = vi.fn(async () => {})
  const request = vi.fn(async () => {
    const sentinel = new EventTarget() as WakeLockSentinel
    Object.assign(sentinel, { released: false, type: 'screen', release })
    return sentinel
  })
  vi.spyOn(navigator, 'wakeLock', 'get').mockReturnValue({ request } as unknown as WakeLock)
  await mountPlaying(WIDE)
  await openPractice()
  await expect.poll(() => request.mock.calls.length).toBe(1)
  press('Escape')
  await expect.poll(practice).toBeNull()
  await expect.poll(() => release.mock.calls.length).toBe(1)
  expect(request).toHaveBeenCalledTimes(1)
})

const shellNav = (name: string) => document.querySelector(`nav[aria-label="${name}"]`)

it('keeps playing in place across a frame change', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openPractice()
  await expect.poll(() => engine.getState().playing).toBe(true)
  engine.seek(20_000)
  await expect.poll(() => engine.getState().positionMs).toBe(20_000)
  const shown = waveform()

  await page.viewport(PHONE.width, PHONE.height)
  await expect.poll(() => shellNav(TAB_BAR)).not.toBeNull()
  expect(engine.getState().playing).toBe(true)
  expect(engine.getState().positionMs).toBe(20_000)
  // Practice itself lives on through the change, so its zoom and loops do too.
  expect(waveform()).toBe(shown)

  await page.viewport(WIDE.width, WIDE.height)
  await expect.poll(() => shellNav(SIDEBAR)).not.toBeNull()
  expect(engine.getState().playing).toBe(true)
  expect(engine.getState().positionMs).toBe(20_000)
  expect(waveform()).toBe(shown)
})

const TITLES = { t1: 'Old Joe Clark', t2: 'Forked Deer', t3: "Soldier's Joy" } as const
const AT = '2026-01-01T00:00:00.000Z'

type TuneId = keyof typeof TITLES

/** Thursday jam: each tune with a take this device holds. */
async function seedList(db: CrosstuneDb, tunes: TuneId[]) {
  const row = { created_at: AT, updated_at: AT, deleted_at: null, server_seq: 0 }
  for (const [position, id] of tunes.entries()) {
    await db.tunes.put(tuneRow(id, TITLES[id]))
    await db.user_tunes.put(userTuneRow(`u-${id}`, id))
    const item: LocalListItem = {
      id: `i-${id}`,
      ...row,
      list_id: 'l1',
      user_tune_id: `u-${id}`,
      position,
    }
    await db.list_items.put(item)
    await db.recordings.put(
      recordingRow(`r-${id}`, {
        tune_id: id,
        label: `${TITLES[id]} take`,
        duration_ms: 3000,
        source_duration_ms: 3000,
      }),
    )
    await db.recording_files.put(
      recordingFile(`r-${id}`, {
        blob: new Blob(['x'], { type: 'audio/mp4' }),
        local_duration_ms: 3000,
      }),
    )
  }
  const list: LocalList = { id: 'l1', ...row, name: 'Thursday jam', position: 0 }
  await db.lists.put(list)
}

const subtitle = () => practice()?.querySelector('[data-recording-subtitle]')?.textContent

it("reads a playing list's place in the header and steps to the next tune", async () => {
  const db = openTestDb()
  await seedList(db, ['t1', 't2', 't3'])
  const engine = fakePlaybackEngine(new FakeAudioElement() as unknown as HTMLAudioElement)
  await renderApp({ path: '/lists/l1', db, frame: WIDE, playbackEngine: engine })
  const play = page.getByRole('button', { name: PLAY, exact: true })
  await expect.element(play).toBeEnabled()
  await play.click()
  await page.getByRole('button', { name: OPEN_RECORDING(`${TITLES.t1} take`) }).click()
  const header = () => page.getByRole('dialog')
  await expect.poll(subtitle).toBe(listPosition('Thursday jam', 1, 3))
  await expect.element(header().getByRole('button', { name: PREVIOUS_TUNE })).toBeVisible()

  await header().getByRole('button', { name: NEXT_TUNE }).click()
  await expect.element(page.getByRole('dialog', { name: `${TITLES.t2} take` })).toBeVisible()
  await expect.poll(subtitle).toBe(listPosition('Thursday jam', 2, 3))
})
