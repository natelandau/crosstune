import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type * as recordings from '../../commands/recordings'
import { updateRecording } from '../../commands/recordings'
import type { CrosstuneDb } from '../../db/schema'
import type { PlaybackEngine } from '../player/playbackEngine'
import {
  SAVE_TRIM,
  TRIM_CHANGED_ELSEWHERE,
  TRIM_CONFIRM_ACTION,
  TRIM_CONFIRM_TITLE,
  TRIM_NOT_SAVED,
} from './trimViewCopy'
import { TRIM } from './trimCopy'
import { START_HANDLE } from './TrimStrip'
import { CANCEL, CLOSE } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { drag } from '../../test/gestures'
import { PALETTE } from '../../theme/tokens'
import { renderHookWithProviders } from '../../test/render'
import { useOverlayClaim } from '../../ui/overlayClaim'
import { mountPlaying, openPractice, PHONE, practice, press, TAKE, WIDE } from '../../test/practice'

vi.mock('../../commands/recordings', { spy: true })

const practiceDialog = () => page.getByRole('dialog', { name: TAKE })
const trimDialog = () => page.getByRole('dialog', { name: TRIM })
const more = () => practiceDialog().getByRole('button', { name: MORE_ACTIONS })
const startHandle = () => trimDialog().getByRole('slider', { name: START_HANDLE })

/** Practice opened on the take, then Trim chosen from More, once the audio's length is known. */
async function openTrim(engine: PlaybackEngine) {
  await openPractice()
  await more().click()
  await page.getByRole('menuitem', { name: TRIM }).click()
  await expect.element(startHandle()).toBeVisible()
  await expect.poll(() => engine.getState().lengthMs).toBeGreaterThan(0)
}

/** The playhead parked at `ms`, then the start set there with `[`. */
async function setStartAt(engine: PlaybackEngine, ms: number) {
  engine.pause()
  engine.seek(ms)
  press('[')
  await expect.element(startHandle()).toHaveAttribute('aria-valuenow', String(ms))
}

/** Back in practice with focus on More, which opened trim. */
async function expectBackOnMore() {
  await expect.element(more()).toBeVisible()
  await expect.element(page.getByRole('slider', { name: START_HANDLE })).not.toBeInTheDocument()
  await expect.poll(() => document.activeElement).toBe(more().element())
}

const trimStart = async (db: CrosstuneDb) => (await db.recordings.get('r1'))?.trim_start_ms

it('opens from More in place of practice, with white handles', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  expect(practice()).not.toBeNull()
  const marks = [...practice()!.querySelectorAll<HTMLElement>('[data-handle] span')]
  expect(marks.length).toBeGreaterThan(0)
  await expect
    .poll(() => marks.map((mark) => getComputedStyle(mark).backgroundColor))
    .toEqual(marks.map(() => 'rgb(255, 255, 255)'))
  await expect
    .poll(() => document.activeElement)
    .toBe(trimDialog().getByRole('button', { name: CANCEL }).element())
})

it('sets the start at the playhead with [', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await setStartAt(engine, 5000)
})

it('saves after confirming, then returns to practice with focus on More', async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await setStartAt(engine, 5000)
  await trimDialog().getByRole('button', { name: SAVE_TRIM }).click()
  const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(55_000) })
  await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()

  await expect.poll(() => trimStart(db)).toBe(5000)
  await expectBackOnMore()
})

it('discards the edit on Cancel', async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await setStartAt(engine, 5000)
  await trimDialog().getByRole('button', { name: CANCEL }).click()

  await expectBackOnMore()
  expect(await trimStart(db)).toBe(0)
  expect(await db.outbox.where({ table: 'recordings', row_id: 'r1' }).count()).toBe(0)
})

it('steps back out to practice with Escape', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  press('Escape')
  await expectBackOnMore()
  expect(practice()).not.toBeNull()
})

it('gives way to a trim written elsewhere, and says so', async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await db.recordings.update('r1', { trim_start_ms: 3000 })
  await expectBackOnMore()
  await expect.element(practiceDialog().getByText(TRIM_CHANGED_ELSEWHERE)).toBeVisible()
})

it("plays at 100% while trimming and at the take's own speed after", async () => {
  const { engine } = await mountPlaying(WIDE, { take: { speed_percent: 90 } })
  await openPractice()
  await expect.poll(() => engine.getState().speedPercent).toBe(90)
  await more().click()
  await page.getByRole('menuitem', { name: TRIM }).click()
  await expect.element(startHandle()).toBeVisible()
  await expect.poll(() => engine.getState().speedPercent).toBe(100)

  await trimDialog().getByRole('button', { name: CANCEL }).click()
  await expect.element(more()).toBeVisible()
  await expect.poll(() => engine.getState().speedPercent).toBe(90)
})

it('holds Cancel and Escape while the confirmed trim is written', async () => {
  const actual = await vi.importActual<typeof recordings>('../../commands/recordings')
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  vi.mocked(updateRecording).mockImplementationOnce(async (...args) => {
    await held
    return actual.updateRecording(...args)
  })
  const { db, engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await setStartAt(engine, 5000)
  await trimDialog().getByRole('button', { name: SAVE_TRIM }).click()
  const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(55_000) })
  await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()

  const cancel = trimDialog().getByRole('button', { name: CANCEL })
  await expect.element(cancel).toBeDisabled()
  await expect.poll(() => vi.mocked(updateRecording).mock.calls.length).toBe(1)
  // Trim takes keys again only once the question has gone.
  await expect.element(question).not.toBeInTheDocument()
  press('Escape')
  // A key pressed after Escape is handled after it, so trim still taking `[` proves Escape
  // left it open.
  engine.seek(8000)
  press('[')
  await expect.element(startHandle()).toHaveAttribute('aria-valuenow', '8000')
  await expect.element(trimDialog()).toBeVisible()

  release()
  await expect.poll(() => trimStart(db)).toBe(5000)
  await expectBackOnMore()
})

it("says a failed save in the dark scheme's danger, in the light appearance too", async () => {
  vi.mocked(updateRecording).mockRejectedValueOnce(new Error('offline'))
  const { engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await setStartAt(engine, 5000)
  await trimDialog().getByRole('button', { name: SAVE_TRIM }).click()
  const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(55_000) })
  await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()

  const alert = trimDialog().getByRole('alert')
  await expect.element(alert).toHaveTextContent(TRIM_NOT_SAVED)
  const danger = PALETTE.dark.danger
  const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(danger.slice(i, i + 2), 16)).join(', ')})`
  await expect.poll(() => getComputedStyle(alert.element()).color).toBe(rgb)
})

it('trims on the phone, where a drag on its header leaves practice open', async () => {
  const { engine } = await mountPlaying(PHONE)
  await openTrim(engine)
  const dialog = trimDialog()
  await expect.element(dialog.getByRole('button', { name: CANCEL })).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: SAVE_TRIM })).toBeVisible()

  await drag(page.elementLocator(practice()!.querySelector('[data-trim-header]')!), 0, 600)
  await expect.element(startHandle()).toBeVisible()
  expect(practice()).not.toBeNull()
  await expect.poll(() => practice()!.getBoundingClientRect().top).toBe(0)
})

it('returns focus to More once, so a later overlay on practice leaves focus alone', async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await setStartAt(engine, 5000)
  await trimDialog().getByRole('button', { name: SAVE_TRIM }).click()
  const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(55_000) })
  await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()
  await expect.poll(() => trimStart(db)).toBe(5000)
  await expectBackOnMore()

  const close = practiceDialog().getByRole('button', { name: CLOSE })
  ;(close.element() as HTMLElement).focus()
  await expect.poll(() => document.activeElement).toBe(close.element())
  // Mounting and unmounting run in act, so practice has seen itself go under and come back on
  // top by the time each returns.
  const stacked = renderHookWithProviders(() => useOverlayClaim({ close: () => {} }))
  stacked.unmount()
  expect(document.activeElement).toBe(close.element())
})
