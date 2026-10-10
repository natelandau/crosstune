import { cdp, page } from 'vitest/browser'
import { MotionGlobalConfig } from 'motion/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecording } from '../../db/types'
import { PLAYER_REGION } from './playerCopy'
import { CLOSE_PLAYER, PLAY } from './transportCopy'
import { openTestDb } from '../../test/db'
import { fakePlaybackEngine } from '../../test/providers'
import { linkRow, recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { renderApp } from '../../test/renderApp'
import { TUNE } from '../tune/tunePageCopy'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const FAST = 'Fast take'
const SLOW = 'Slow take'
const YOUTUBE_TITLE = 'Old Joe Clark on YouTube'

/** Old Joe Clark with two takes this device holds, and a YouTube link that plays in an embed. */
async function seed(db: CrosstuneDb) {
  await db.tunes.put(tuneRow('t1', 'Old Joe Clark'))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  const take = async (id: string, label: string, extra: Partial<LocalRecording> = {}) => {
    await db.recordings.put(
      recordingRow(id, {
        tune_id: 't1',
        label,
        duration_ms: 3000,
        source_duration_ms: 3000,
        ...extra,
      }),
    )
    await db.recording_files.put(
      recordingFile(id, { blob: new Blob(['x'], { type: 'audio/mp4' }), local_duration_ms: 3000 }),
    )
  }
  await take('r1', FAST)
  await take('r2', SLOW, { added_at: '2026-01-02T12:00:00.000Z' })
  await db.recording_links.put(
    linkRow('k1', 't1', {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: YOUTUBE_TITLE,
    }),
  )
}

async function mount(frame: { width: number; height: number }) {
  const db = openTestDb()
  await seed(db)
  const engine = fakePlaybackEngine()
  await renderApp({ path: '/catalog/t1', db, frame, playbackEngine: engine })
  await expect.element(takeRow(SLOW)).toBeVisible()
  return engine
}

const player = () => page.getByRole('region', { name: PLAYER_REGION })
const tunePage = () => page.getByRole('main', { name: TUNE })
const takeRow = (label: string) =>
  tunePage().getByRole('row', { name: new RegExp(`^${PLAY} ${label}`) })
const linkRowOnPage = () => tunePage().getByRole('row', { name: new RegExp(YOUTUBE_TITLE) })
const titleIn = (label: string) =>
  player().getByText(label, { exact: true }).element() as HTMLElement

/**
 * Runs `step` with Motion's clock held, so a slide started inside it stays where it began until
 * the test reads it. Motion keeps its own frame loop, which fake timers cannot reach; manual
 * timing stops the time that loop reads, and letting it go runs every held slide out.
 */
async function holdingMotion(step: () => Promise<void>) {
  MotionGlobalConfig.useManualTiming = true
  try {
    await step()
  } finally {
    MotionGlobalConfig.useManualTiming = false
  }
}

/** Opens the player from `row` and waits for the bar to finish rising into place. */
async function open(row: ReturnType<typeof takeRow>) {
  await row.click()
  await expect.element(player()).toBeVisible()
  const bar = () => player().element().firstElementChild as HTMLElement
  await expect.poll(() => bar().style.transform).toBe('none')
}

/**
 * Every copy a closing bar leaves in its place, caught as it is added, so a copy that has
 * already slid out and gone is still seen.
 */
function watchLeaving(): HTMLElement[] {
  const copies: HTMLElement[] = []
  const observer = new MutationObserver((records) => {
    for (const added of records.flatMap((record) => [...record.addedNodes])) {
      if (!(added instanceof HTMLElement) || added.getAttribute('aria-hidden') !== 'true') continue
      if (added.querySelector('section')) copies.push(added)
    }
  })
  observer.observe(document.body, { childList: true })
  onTestFinished(() => observer.disconnect())
  return copies
}

/** The bar inside a copy, which slides down out of the copy's box. */
const slidingBar = (copy: HTMLElement) =>
  copy.querySelector('section')!.firstElementChild as HTMLElement

it.each([
  ['phone', PHONE],
  ['wide', WIDE],
])('slides in a new title on a track change on %s, never the first one', async (_, frame) => {
  await mount(frame)
  await holdingMotion(async () => {
    await takeRow(FAST).click()
    await expect.element(player()).toBeVisible()
    expect(titleIn(FAST).style.transform).toBe('none')
    await takeRow(SLOW).click()
    await expect.element(player().getByText(SLOW, { exact: true })).toBeInTheDocument()
    expect(titleIn(SLOW).style.transform).not.toBe('none')
  })
  await expect.poll(() => titleIn(SLOW).style.transform).toBe('none')
})

it('closes at once and leaves an inert, hidden copy that slides out and goes', async () => {
  const engine = await mount(PHONE)
  const unload = vi.spyOn(engine, 'unload')
  await open(takeRow(FAST))
  const copies = watchLeaving()
  await holdingMotion(async () => {
    await player().getByRole('button', { name: CLOSE_PLAYER, exact: true }).click()
    await expect.element(player()).not.toBeInTheDocument()
    await expect.poll(() => unload.mock.calls.length).toBeGreaterThan(0)
    await expect.poll(() => copies.length).toBe(1)
    const [copy] = copies as [HTMLElement]
    // Still on the page once the slot it came from has gone, with its slide under way.
    expect(document.querySelector('[data-now-playing]')).toBeNull()
    expect(copy.isConnected).toBe(true)
    expect(slidingBar(copy).style.transform).not.toBe('translateY(100%)')
    expect(copy.inert).toBe(true)
    expect(copy.querySelector('section')!.hasAttribute('aria-label')).toBe(false)
    expect(copy.querySelectorAll('[id]')).toHaveLength(0)
  })
  await expect.poll(() => copies[0]!.isConnected).toBe(false)
})

it("leaves no live embed in a closing link's copy", async () => {
  await mount(PHONE)
  await open(linkRowOnPage())
  await expect.poll(() => player().element().querySelector('iframe')).not.toBeNull()
  const copies = watchLeaving()
  await player().getByRole('button', { name: CLOSE_PLAYER, exact: true }).click()
  await expect.poll(() => copies.length).toBe(1)
  expect(copies[0]!.querySelectorAll('iframe, video, audio')).toHaveLength(0)
  await expect.poll(() => copies[0]!.isConnected).toBe(false)
})

it('clears a closing copy still on its way out when the player opens again', async () => {
  await mount(PHONE)
  await open(takeRow(FAST))
  const copies = watchLeaving()
  await holdingMotion(async () => {
    await player().getByRole('button', { name: CLOSE_PLAYER, exact: true }).click()
    await expect.poll(() => copies.length).toBe(1)
    expect(copies[0]!.isConnected).toBe(true)
    await takeRow(SLOW).click()
    await expect.element(player()).toBeVisible()
    await expect.poll(() => copies[0]!.isConnected).toBe(false)
  })
})

it('leaves no copy behind under reduced motion', async () => {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  onTestFinished(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [] })
  })
  await expect.poll(() => matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
  await mount(PHONE)
  await open(takeRow(FAST))
  const copies = watchLeaving()
  await player().getByRole('button', { name: CLOSE_PLAYER, exact: true }).click()
  await expect.element(player()).not.toBeInTheDocument()
  // Opening the player again proves the close has long since committed.
  await takeRow(SLOW).click()
  await expect.element(player()).toBeVisible()
  expect(copies).toHaveLength(0)
})

it('leaves no copy when a resize moves the bar to the other frame, only on a close', async () => {
  await mount(PHONE)
  await open(takeRow(FAST))
  const slot = () => player().element().closest('[data-now-playing]')
  const phoneSlot = slot()
  const copies = watchLeaving()
  await page.viewport(WIDE.width, WIDE.height)
  // The playing bar moves to the wide frame's slot rather than mounting again.
  await expect.poll(() => slot() !== phoneSlot).toBe(true)
  expect(copies).toHaveLength(0)
  await player().getByRole('button', { name: CLOSE_PLAYER, exact: true }).click()
  await expect.element(player()).not.toBeInTheDocument()
  await expect.poll(() => copies.length).toBe(1)
})

it('leaves no copy when the app goes away with the bar open', async () => {
  const db = openTestDb()
  await seed(db)
  const app = await renderApp({
    path: '/catalog/t1',
    db,
    frame: PHONE,
    playbackEngine: fakePlaybackEngine(),
  })
  await expect.element(takeRow(SLOW)).toBeVisible()
  await open(takeRow(FAST))
  const copies = watchLeaving()
  app.unmount()
  await expect.element(player()).not.toBeInTheDocument()
  expect(copies).toHaveLength(0)
  expect(document.querySelector('[aria-hidden="true"] section')).toBeNull()
})
