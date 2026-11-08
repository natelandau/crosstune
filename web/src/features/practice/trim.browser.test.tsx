import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
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
  GO_TO_END,
  GO_TO_START,
} from './trimViewCopy'
import { TRIM } from './trimCopy'
import { START_HANDLE } from './TrimStrip'
import { NUDGE_LARGE_MS } from './panel'
import { CANCEL } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { drag } from '../../test/gestures'
import { PALETTE } from '../../theme/tokens'
import { renderHookWithProviders } from '../../test/render'
import { useOverlayClaim } from '../../ui/overlayClaim'
import {
  mountPlaying,
  openPractice,
  PHONE,
  practice,
  recordingPage,
  press,
  WIDE,
} from '../../test/practice'
import { stubSystemDarkForTest } from '../../test/scheme'
import { computedColor } from '../../test/color'

vi.mock('../../commands/recordings', { spy: true })

const practiceDialog = () => recordingPage()
const trimDialog = () => page.getByRole('dialog', { name: TRIM })
const more = () => practiceDialog().getByRole('button', { name: MORE_ACTIONS })
const startHandle = () => trimDialog().getByRole('slider', { name: START_HANDLE })

/** Practice opened on the recording, then Trim chosen from More, once the audio's length is set. */
async function openTrim(engine: PlaybackEngine) {
  await openPractice()
  await more().click()
  await page.getByRole('menuitem', { name: TRIM }).click()
  await expect.element(startHandle()).toBeVisible()
  await expect.poll(() => engine.getState().lengthMs).toBeGreaterThan(0)
}

/** The start handle moved from where it is to `ms`, a whole number of seconds, with Page Up. */
async function setStartAt(ms: number) {
  const handle = startHandle()
  const from = Number(handle.element().getAttribute('aria-valuenow'))
  ;(handle.element() as HTMLElement).focus()
  for (let at = from; at < ms; at += NUDGE_LARGE_MS) await userEvent.keyboard('{PageUp}')
  await expect.element(handle).toHaveAttribute('aria-valuenow', String(ms))
}

/** Back in practice with focus on More, which opened trim. */
async function expectBackOnMore() {
  await expect.element(more()).toBeVisible()
  await expect.element(page.getByRole('slider', { name: START_HANDLE })).not.toBeInTheDocument()
  await expect.poll(() => document.activeElement).toBe(more().element())
}

const trimStart = async (db: CrosstuneDb) => (await db.recordings.get('r1'))?.trim_start_ms

it('opens from More in place of practice, with a grip on each handle', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  expect(practice()).not.toBeNull()
  const lines = [...practice()!.querySelectorAll<HTMLElement>('[data-handle] > span:first-child')]
  expect(lines.length).toBeGreaterThan(0)
  await expect
    .poll(() => practice()!.querySelectorAll('[data-handle] [data-grip]').length)
    .toBe(lines.length)
  await expect
    .poll(() => document.activeElement)
    .toBe(trimDialog().getByRole('button', { name: CANCEL }).element())
})

it.each(['light', 'dark'] as const)(
  "draws its handles in the trim slot's loop color in %s",
  async (scheme) => {
    stubSystemDarkForTest(scheme === 'dark')
    const { engine } = await mountPlaying(WIDE)
    await openTrim(engine)
    const loop = document.createElement('span')
    loop.className = 'loop-color bg-(--loop)'
    loop.dataset.color = practice()!.querySelector<HTMLElement>('[data-handle]')!.dataset.color!
    practice()!.append(loop)
    const lines = [...practice()!.querySelectorAll<HTMLElement>('[data-handle] > span:first-child')]
    try {
      expect(lines.length).toBeGreaterThan(0)
      await expect
        .poll(() => lines.map((line) => getComputedStyle(line).backgroundColor))
        .toEqual(lines.map(() => getComputedStyle(loop).backgroundColor))
    } finally {
      loop.remove()
    }
  },
)

it('centers the detail on a handle with Go to start and Go to end', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  const detailHandle = (edge: string) =>
    practice()!.querySelector(`[data-trim-detail] [data-handle="${edge}"]`)
  await expect.poll(() => detailHandle('start')).not.toBeNull()
  await expect.poll(() => detailHandle('end')).toBeNull()
  engine.pause()
  await expect.poll(() => engine.getState().playing).toBe(false)
  const positionMs = engine.getState().positionMs
  await trimDialog().getByRole('button', { name: GO_TO_END }).click()
  await expect.poll(() => detailHandle('end')).not.toBeNull()
  await expect.poll(() => detailHandle('start')).toBeNull()
  await trimDialog().getByRole('button', { name: GO_TO_START }).click()
  await expect.poll(() => detailHandle('start')).not.toBeNull()
  expect(engine.getState().positionMs).toBe(positionMs)
})

it('tints the kept range from the start handle to the end handle', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  const overview = () => practice()!.querySelector<HTMLElement>('[data-trim-range]')!
  await expect.poll(() => overview().style.left).toBe('0%')
  await expect.poll(() => overview().style.width).toBe('100%')
  await setStartAt(5000)
  await expect
    .poll(() => parseFloat(overview().style.left))
    .toBeCloseTo((5000 / engine.getState().lengthMs) * 100, 3)
})

it('saves after confirming, then returns to practice with focus on More', async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await setStartAt(5000)
  await trimDialog().getByRole('button', { name: SAVE_TRIM }).click()
  const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(55_000) })
  await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()

  await expect.poll(() => trimStart(db)).toBe(5000)
  await expectBackOnMore()
})

it('discards the edit on Cancel', async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await setStartAt(5000)
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

it("plays at 100% while trimming and at the recording's own speed after", async () => {
  const { engine } = await mountPlaying(WIDE, { recording: { speed_percent: 90 } })
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
  await setStartAt(5000)
  await trimDialog().getByRole('button', { name: SAVE_TRIM }).click()
  const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(55_000) })
  await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()

  const cancel = trimDialog().getByRole('button', { name: CANCEL })
  await expect.element(cancel).toBeDisabled()
  await expect.poll(() => vi.mocked(updateRecording).mock.calls.length).toBe(1)
  // Trim takes keys again only once the question has gone.
  await expect.element(question).not.toBeInTheDocument()
  press('Escape')
  // A key pressed after Escape is handled after it, so the start handle still taking Page Up
  // proves Escape left trim open.
  ;(startHandle().element() as HTMLElement).focus()
  await userEvent.keyboard('{PageUp}')
  await expect.element(startHandle()).toHaveAttribute('aria-valuenow', '6000')
  await expect.element(trimDialog()).toBeVisible()

  release()
  await expect.poll(() => trimStart(db)).toBe(5000)
  await expectBackOnMore()
})

it.each(['light', 'dark'] as const)(
  'says a failed save in danger in the %s appearance',
  async (scheme) => {
    stubSystemDarkForTest(scheme === 'dark')
    vi.mocked(updateRecording).mockRejectedValueOnce(new Error('offline'))
    const { engine } = await mountPlaying(WIDE)
    await openTrim(engine)
    await setStartAt(5000)
    await trimDialog().getByRole('button', { name: SAVE_TRIM }).click()
    const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(55_000) })
    await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()

    const alert = trimDialog().getByRole('alert')
    await expect.element(alert).toHaveTextContent(TRIM_NOT_SAVED)
    await expect
      .poll(() => getComputedStyle(alert.element()).color)
      .toBe(computedColor(PALETTE[scheme].danger))
  },
)

it('trims on the phone, where a drag on its header leaves practice open', async () => {
  const { engine } = await mountPlaying(PHONE)
  await openTrim(engine)
  const dialog = trimDialog()
  await expect.element(dialog.getByRole('button', { name: CANCEL })).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: SAVE_TRIM })).toBeVisible()

  await drag(page.elementLocator(practice()!.querySelector('[data-editor-header]')!), 0, 600)
  await expect.element(startHandle()).toBeVisible()
  expect(practice()).not.toBeNull()
  await expect.poll(() => practice()!.getBoundingClientRect().top).toBe(0)
})

it('returns focus to More once, so a later overlay on practice leaves focus alone', async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await openTrim(engine)
  await setStartAt(5000)
  await trimDialog().getByRole('button', { name: SAVE_TRIM }).click()
  const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(55_000) })
  await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()
  await expect.poll(() => trimStart(db)).toBe(5000)
  await expectBackOnMore()

  const other = practice()!.querySelector<HTMLElement>('[data-practice-transport] button')!
  other.focus()
  await expect.poll(() => document.activeElement).toBe(other)
  // Mounting and unmounting run in act, so the page has seen the claim come and go by the time
  // each returns.
  const stacked = renderHookWithProviders(() => useOverlayClaim({ close: () => {} }))
  stacked.unmount()
  expect(document.activeElement).toBe(other)
})
