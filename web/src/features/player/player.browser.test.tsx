import { page } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem, LocalRecording } from '../../db/types'
import { REMOVE } from '../lists/listsCopy'
import { PLAYER_REGION } from './playerCopy'
import { CLOSE_PLAYER, ELAPSED, PAUSE, PLAY, PROGRESS, SPEED_BADGE } from './transportCopy'
import { formatDuration } from '../../text/format'
import { playName } from '../recordings/recordingNames'
import { openTestDb } from '../../test/db'
import { fakePlaybackEngine } from '../../test/providers'
import { linkRow, recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { destination } from '../../app/destinations'

import { renderApp } from '../../test/renderApp'
import { TUNE } from '../tune/tunePageCopy'
import { UNDO } from '../../ui/Toast'
import { TAB_BAR } from '../../app/tabs'
import { TUNE_LIST } from '../catalog/catalogCopy'
import { VIDEO_HEIGHT_PX } from './playerHeight'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
// A short window keeps the phone frame, and leaves an embed less room than it asks for.
const PHONE_LANDSCAPE = { width: 844, height: 390 }

const CATALOG = destination('catalog')

const AT = '2026-01-01T00:00:00.000Z'
const TAKE = 'Fast take'

async function seedTune(db: CrosstuneDb, id: string, title: string) {
  await db.tunes.put(tuneRow(id, title))
  await db.user_tunes.put(userTuneRow(`u-${id}`, id))
}

/** A take of `tuneId` this device holds, three seconds long, so it plays at once. */
async function seedTake(db: CrosstuneDb, tuneId: string, extra: Partial<LocalRecording> = {}) {
  await db.recordings.put(
    recordingRow('r1', {
      tune_id: tuneId,
      label: TAKE,
      duration_ms: 3000,
      source_duration_ms: 3000,
      ...extra,
    }),
  )
  await db.recording_files.put(
    recordingFile('r1', {
      blob: new Blob(['x'], { type: 'audio/mp4' }),
      local_duration_ms: 3000,
    }),
  )
}

const YOUTUBE_TITLE = 'Old Joe Clark on YouTube'

/** A tune with a YouTube link, which plays in an embed. */
async function seedLink(db: CrosstuneDb) {
  await seedTune(db, 't1', 'Old Joe Clark')
  await db.recording_links.put(
    linkRow('k1', 't1', {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: YOUTUBE_TITLE,
    }),
  )
}

async function playLink() {
  await tunePage()
    .getByRole('row', { name: new RegExp(YOUTUBE_TITLE) })
    .click()
  await expect.element(player()).toBeVisible()
}

/** Thursday jam: Old Joe Clark, whose take plays, then Forked Deer. */
async function seedList(db: CrosstuneDb) {
  const row = { created_at: AT, updated_at: AT, deleted_at: null, server_seq: 0 }
  const list: LocalList = { id: 'l1', ...row, name: 'Thursday jam', position: 0 }
  const item = (id: string, tuneId: string, position: number): LocalListItem => ({
    id,
    ...row,
    list_id: 'l1',
    user_tune_id: `u-${tuneId}`,
    position,
  })
  await seedTune(db, 't1', 'Old Joe Clark')
  await seedTune(db, 't2', 'Forked Deer')
  await seedTake(db, 't1')
  await db.lists.put(list)
  await db.list_items.bulkPut([item('i1', 't1', 0), item('i2', 't2', 1)])
}

const embedFrame = () => player().element().querySelector('iframe')

async function mount(
  path: string,
  frame: { width: number; height: number },
  seed: (db: CrosstuneDb) => Promise<unknown>,
) {
  const db = openTestDb()
  await seed(db)
  const engine = fakePlaybackEngine()
  const app = await renderApp({ path, db, frame, playbackEngine: engine })
  return { ...app, db, engine }
}

const player = () => page.getByRole('region', { name: PLAYER_REGION })
const box = (element: Element) => element.getBoundingClientRect()
const tunePage = () => page.getByRole('main', { name: TUNE })
const takeRow = () => tunePage().getByRole('row', { name: new RegExp(`^${PLAY} ${TAKE}`) })

async function playTake() {
  const row = takeRow()
  await expect.element(row).toBeVisible()
  const opener = row.element()
  await row.click()
  await expect.element(player()).toBeVisible()
  return opener
}

it('floats the phone bar just above the tab bar, with Play and Pause swapping', async () => {
  await mount('/catalog/t1', PHONE, async (db) => {
    await seedTune(db, 't1', 'Old Joe Clark')
    await seedTake(db, 't1')
  })
  await playTake()

  const tabs = page.getByRole('navigation', { name: TAB_BAR })
  await expect
    .poll(() => box(tabs.element()).top - box(player().element()).bottom)
    .toSatisfy((gap: number) => gap > 0 && gap <= 12)
  await player().getByRole('button', { name: PAUSE }).click()
  await expect.element(player().getByRole('button', { name: PLAY, exact: true })).toBeVisible()
  await player().getByRole('button', { name: PLAY, exact: true }).click()
  await expect.element(player().getByRole('button', { name: PAUSE })).toBeVisible()
})

it('docks inside the detail pane on wide, its time and scrubber following the engine', async () => {
  const { engine } = await mount('/catalog/t1', WIDE, async (db) => {
    await seedTune(db, 't1', 'Old Joe Clark')
    await seedTake(db, 't1')
  })
  await playTake()

  const detail = document.querySelector('[data-column="detail"]')!
  await expect
    .poll(() => {
      const dock = box(player().element())
      const pane = box(detail)
      return (
        dock.left >= pane.left &&
        dock.right <= pane.right &&
        dock.top >= pane.top &&
        dock.bottom <= pane.bottom
      )
    })
    .toBe(true)

  await expect.element(player().getByRole('button', { name: PAUSE })).toBeVisible()
  engine.seek(1500)
  const scrubber = player().getByRole('slider', { name: PROGRESS(TAKE) })
  await expect.poll(() => (scrubber.element() as HTMLInputElement).valueAsNumber).toBe(1500)
  await expect
    .element(player().getByRole('timer', { name: ELAPSED(formatDuration(1500)) }))
    .toBeVisible()
})

it('keeps the recording playing as the window crosses from phone to wide', async () => {
  const { engine } = await mount('/catalog/t1', PHONE, async (db) => {
    await seedTune(db, 't1', 'Old Joe Clark')
    await seedTake(db, 't1')
  })
  const load = vi.spyOn(engine, 'load')
  const unload = vi.spyOn(engine, 'unload')
  await playTake()
  await expect.element(player().getByRole('button', { name: PAUSE })).toBeVisible()
  engine.seek(1500)

  await page.viewport(WIDE.width, WIDE.height)
  await expect.element(player().getByRole('slider', { name: PROGRESS(TAKE) })).toBeInTheDocument()
  // The dock now shows, so any reload the frame change caused has already happened.
  await expect.poll(() => load.mock.calls.length).toBe(1)
  await expect.poll(() => unload.mock.calls.length).toBe(0)
  await expect.poll(() => engine.getState()).toMatchObject({ playing: true, positionMs: 1500 })
})

it('closes, and hands focus back to the row that opened it', async () => {
  await mount('/catalog/t1', PHONE, async (db) => {
    await seedTune(db, 't1', 'Old Joe Clark')
    await seedTake(db, 't1')
  })
  const opener = await playTake()

  await player().getByRole('button', { name: CLOSE_PLAYER, exact: true }).click()
  await expect.element(player()).not.toBeInTheDocument()
  await expect.poll(() => document.activeElement).toBe(opener)
})

it('lets the last catalog row scroll fully above the bar', async () => {
  await mount('/catalog/t1', PHONE, async (db) => {
    await seedTune(db, 't1', 'Old Joe Clark')
    await seedTake(db, 't1')
    for (let n = 10; n < 40; n++) await seedTune(db, `t${n}`, `Reel number ${n}`)
  })
  await playTake()
  await tunePage().getByRole('link', { name: CATALOG.label }).click()

  const grid = page.getByRole('grid', { name: TUNE_LIST })
  await expect.element(grid).toBeVisible()
  const last = () => [...grid.element().querySelectorAll('[role="row"]')].at(-1)!
  await expect.poll(() => grid.element().querySelectorAll('[role="row"]').length).toBe(31)
  // Every scroller the row sits in, scrolled as far as it goes.
  for (let el = last().parentElement; el; el = el.parentElement) el.scrollTop = el.scrollHeight
  await expect.poll(() => box(last()).bottom <= box(player().element()).top + 0.5).toBe(true)
  await expect.poll(() => box(last()).bottom > 0).toBe(true)
})

it('grows an embed up out of the bar, at most 40% of the pane', async () => {
  await mount('/catalog/t1', PHONE_LANDSCAPE, seedLink)
  await playLink()

  await expect.poll(() => embedFrame()?.getBoundingClientRect().height ?? 0).toBeGreaterThan(0)
  await expect
    .poll(() => embedFrame()!.getBoundingClientRect().height)
    .toBeLessThanOrEqual(window.innerHeight * 0.4)
})

it('gives an embed its full height when the phone has room for it', async () => {
  await mount('/catalog/t1', PHONE, seedLink)
  await playLink()

  // Read once the cap is set, since the embed shows uncapped for the moment before.
  const capped = () => {
    const panel = document.querySelector<HTMLElement>('[data-embed]')
    return panel?.style.getPropertyValue('--embed-cap')
      ? embedFrame()!.getBoundingClientRect().height
      : 0
  }
  await expect.poll(capped).toBe(VIDEO_HEIGHT_PX)
})

it('caps an embed at 40% of the detail pane on wide', async () => {
  await mount('/catalog/t1', WIDE, seedLink)
  await playLink()

  const detail = document.querySelector('[data-column="detail"]')!
  await expect.poll(() => embedFrame()?.getBoundingClientRect().height ?? 0).toBeGreaterThan(0)
  await expect
    .poll(() => embedFrame()!.getBoundingClientRect().height)
    .toBeLessThanOrEqual(box(detail).height * 0.4)
})

it('keeps the same embed as the window crosses from phone to wide', async () => {
  await mount('/catalog/t1', PHONE, seedLink)
  await playLink()
  await expect.poll(embedFrame).not.toBeNull()
  const before = embedFrame()

  await page.viewport(WIDE.width, WIDE.height)
  const detail = () => document.querySelector('[data-column="detail"]')
  await expect.poll(() => !!detail()?.contains(player().element())).toBe(true)
  // Only an atomic move keeps a frame's document; a browser without one reloads it.
  if ('moveBefore' in Element.prototype) await expect.poll(embedFrame).toBe(before)
})

it('washes the catalog row of the tune that plays', async () => {
  await mount('/catalog/t1', WIDE, async (db) => {
    await seedTune(db, 't1', 'Old Joe Clark')
    await seedTune(db, 't2', 'Forked Deer')
    await seedTake(db, 't1')
  })
  const rows = page.getByRole('grid', { name: TUNE_LIST })
  const row = (title: string) => rows.getByRole('row', { name: new RegExp(`^${title}`) })
  await expect.element(row('Old Joe Clark')).not.toHaveAttribute('data-playing')
  await playTake()

  await expect.element(row('Old Joe Clark')).toHaveAttribute('data-playing')
  await expect.element(row('Forked Deer')).not.toHaveAttribute('data-playing')
})

it('shows the speed badge only away from the default speed', async () => {
  const { db } = await mount('/catalog/t1', PHONE, async (db) => {
    await seedTune(db, 't1', 'Old Joe Clark')
    await seedTake(db, 't1', { speed_percent: 90 })
  })
  await playTake()
  const badge = () => player().element().querySelector('[data-playback-badge]')
  await expect.poll(() => badge()?.textContent).toContain(SPEED_BADGE(90))

  await db.recordings.update('r1', { speed_percent: 100 })
  await expect.element(player().getByRole('button', { name: PAUSE })).toBeVisible()
  await expect.poll(badge).toBeNull()
})

it('sets a toast above the phone bar', async () => {
  await mount('/lists/l1', PHONE, seedList)
  const rows = page.getByRole('grid', { name: TUNE_LIST })
  await rows.getByRole('button', { name: playName('Old Joe Clark') }).click()
  await expect.element(player()).toBeVisible()

  const row = rows.getByRole('row', { name: /Forked Deer/ })
  await row.hover()
  await row.getByRole('button', { name: REMOVE }).click()
  const undo = page.getByRole('button', { name: UNDO })
  await expect.element(undo).toBeVisible()
  await expect
    .poll(() => box(undo.element().parentElement!).bottom <= box(player().element()).top)
    .toBe(true)
})

it('sets a toast above the floating tab bar when nothing plays', async () => {
  await mount('/lists/l1', PHONE, seedList)
  const rows = page.getByRole('grid', { name: TUNE_LIST })
  const row = rows.getByRole('row', { name: /Forked Deer/ })
  await row.hover()
  await row.getByRole('button', { name: REMOVE }).click()
  const undo = page.getByRole('button', { name: UNDO })
  await expect.element(undo).toBeVisible()
  const tabs = page.getByRole('navigation', { name: TAB_BAR })
  await expect
    .poll(() => box(undo.element().parentElement!).bottom <= box(tabs.element()).top)
    .toBe(true)
})

it('sets a toast at the bottom center of the detail pane on wide', async () => {
  await mount('/lists/l1', WIDE, seedList)
  const rows = page.getByRole('grid', { name: TUNE_LIST })
  await rows.getByRole('button', { name: playName('Old Joe Clark') }).click()
  await expect.element(player()).toBeVisible()

  const row = rows.getByRole('row', { name: /Forked Deer/ })
  await row.hover()
  await row.getByRole('button', { name: REMOVE }).click()
  const undo = page.getByRole('button', { name: UNDO })
  await expect.element(undo).toBeVisible()
  const detail = document.querySelector('[data-column="detail"]')!
  await expect
    .poll(() => {
      const toast = box(undo.element().parentElement!)
      const pane = box(detail)
      const center = (toast.left + toast.right) / 2
      return (
        Math.abs(center - (pane.left + pane.right) / 2) <= 1 &&
        toast.bottom <= box(player().element()).top
      )
    })
    .toBe(true)
})

it("washes a list row while any of its tune's recordings or links plays", async () => {
  await mount('/lists/l1/tunes/t1', WIDE, async (db) => {
    await seedList(db)
    await seedLink(db)
  })
  const rows = page.getByRole('grid', { name: TUNE_LIST })
  const row = (title: string) => rows.getByRole('row', { name: new RegExp(title) })
  await expect.element(row('Old Joe Clark')).not.toHaveAttribute('data-playing')
  // The link, though the row's own control would play the take.
  await playLink()

  await expect.element(row('Old Joe Clark')).toHaveAttribute('data-playing')
  await expect.element(row('Forked Deer')).not.toHaveAttribute('data-playing')
})
