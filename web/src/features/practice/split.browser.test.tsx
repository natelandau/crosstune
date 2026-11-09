import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { drag, tap } from '../../test/gestures'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import { recordingFile, recordingRow } from '../../test/rows'
import { destination } from '../../layout/destinations'
import { FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import {
  mountPlaying,
  openPractice,
  practice,
  recordingPage,
  press,
  RECORDING_LABEL,
  WIDE,
  type PracticeSeed,
} from '../../test/practice'
import { CANCEL } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { SKIP_BACK, SKIP_FORWARD } from '../player/playerCopy'
import { PLAY } from '../player/transportCopy'
import { DETAIL_LABEL } from './trimViewCopy'
import { MAX_RECORDING_MS } from '../../domain/recordingLimits'
import {
  CUT_HANDLE,
  NEXT_CUT,
  REMOVE_CUT,
  SAVE_SPLIT,
  SPLIT,
  SPLIT_AT,
  SPLIT_CONFIRM_ACTION,
  SPLIT_CONFIRM_TITLE,
} from './splitCopy'
import { pieceColor } from './splitModel'

const practiceDialog = () => recordingPage()
const splitDialog = () => page.getByRole('dialog', { name: SPLIT })
const more = () => practiceDialog().getByRole('button', { name: MORE_ACTIONS })
const mainButton = () => splitDialog().getByRole('button', { name: /^(Split at|Remove cut)/ })
const cuts = () => [...(practice()?.querySelectorAll<HTMLElement>('[data-split-cut]') ?? [])]
const zoomed = () => page.elementLocator(practice()!.querySelector('[data-split-strip]')!)

async function mountSplit(seed: PracticeSeed = {}) {
  const analytics = recordingAnalytics()
  const mounted = await mountPlaying(WIDE, {
    ...seed,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  await openPractice()
  return { ...mounted, analytics }
}

/** Split chosen from More, once the audio's length is set. */
async function openSplit(engine: { getState: () => { lengthMs: number } }) {
  await more().click()
  await page.getByRole('menuitem', { name: SPLIT }).click()
  await expect.element(mainButton()).toBeVisible()
  await expect.poll(() => engine.getState().lengthMs).toBeGreaterThan(0)
}

/** Back in practice with focus on More, which opened split. */
async function expectBackOnMore() {
  await expect.element(more()).toBeVisible()
  await expect.element(splitDialog()).not.toBeInTheDocument()
  await expect.poll(() => document.activeElement).toBe(more().element())
}

const pieceCount = (db: CrosstuneDb) =>
  db.recordings.filter((row) => row.split_from_id === 'r1').count()

it('Split opens from the More menu and Cancel returns to practice', async () => {
  const { engine } = await mountSplit()
  await openSplit(engine)
  await expect
    .poll(() => document.activeElement)
    .toBe(splitDialog().getByRole('button', { name: CANCEL }).element())
  await splitDialog().getByRole('button', { name: CANCEL }).click()
  await expectBackOnMore()
})

it('dragging the zoomed strip moves the time readout; Split at adds a cut', async () => {
  const { engine } = await mountSplit()
  await openSplit(engine)
  await expect.element(mainButton()).toHaveAccessibleName(SPLIT_AT(0))
  await expect.element(mainButton()).toBeDisabled()

  await drag(zoomed(), -300, 0, { pointerType: 'mouse' })
  await expect.element(mainButton()).not.toHaveAccessibleName(SPLIT_AT(0))
  await expect.element(mainButton()).toBeEnabled()
  await mainButton().click()

  await expect.poll(() => cuts().length).toBe(1)
  await expect.element(mainButton()).toHaveAccessibleName(REMOVE_CUT)
  await expect.element(splitDialog().getByRole('button', { name: SAVE_SPLIT })).toBeEnabled()
})

it('Save asks to split into 3 recordings and writes the rows', async () => {
  const { db, engine, analytics } = await mountSplit()
  await openSplit(engine)
  for (let i = 0; i < 10; i++) press('ArrowRight', { shiftKey: true })
  press('s')
  await expect.poll(() => cuts().length).toBe(1)
  await splitDialog().getByRole('button', { name: SKIP_FORWARD }).click()
  press('s')
  await expect.poll(() => cuts().length).toBe(2)

  await splitDialog().getByRole('button', { name: SAVE_SPLIT }).click()
  const question = page.getByRole('alertdialog', { name: SPLIT_CONFIRM_TITLE(3) })
  await question.getByRole('button', { name: SPLIT_CONFIRM_ACTION }).click()

  await expect.poll(() => pieceCount(db)).toBe(2)
  await expect.poll(async () => (await db.recordings.get('r1'))?.trim_end_ms).toBe(10_000)
  await expectBackOnMore()
  await expect
    .poll(() => analytics.sends().filter((send) => send.name === 'recording_split'))
    .toEqual([
      {
        name: 'recording_split',
        props: { recording_id: 'r1', piece_count: '1-9', over_limit: false },
      },
    ])
})

/** An engine whose element reports a pause a moment after it is asked for, as a browser does. */
function lateEngine() {
  class LateAudioElement extends FakeAudioElement {
    override pause(): void {
      this.paused = true
      setTimeout(() => this.dispatchEvent(new Event('pause')), 50)
    }
  }
  return fakePlaybackEngine(new LateAudioElement() as unknown as HTMLAudioElement)
}

const line = () => splitDialog().getByRole('slider', { name: DETAIL_LABEL })

/** Playback under way in the open split, the line following it. */
async function playInSplit(engine: ReturnType<typeof lateEngine>) {
  if (engine.getState().playing) {
    engine.pause()
    await expect.poll(() => engine.getState().playing).toBe(false)
  }
  await splitDialog().getByRole('button', { name: PLAY }).click()
  await expect.poll(() => engine.getState().playing).toBe(true)
}

it('keeps a cut chosen with Next cut while playing selected once playback stops', async () => {
  const playbackEngine = lateEngine()
  await mountSplit({ playbackEngine })
  await openSplit(playbackEngine)
  for (let i = 0; i < 10; i++) press('ArrowRight', { shiftKey: true })
  press('s')
  await expect.poll(() => cuts().length).toBe(1)
  await splitDialog().getByRole('button', { name: SKIP_BACK }).click()
  await expect.poll(() => cuts()[0]?.getAttribute('aria-pressed')).toBe('false')
  await playInSplit(playbackEngine)

  await splitDialog().getByRole('button', { name: NEXT_CUT }).click()
  await expect.poll(() => playbackEngine.getState().playing).toBe(false)
  await expect.poll(() => cuts()[0]?.getAttribute('aria-pressed')).toBe('true')
  await expect.element(line()).toHaveAttribute('aria-valuenow', '10000')
})

it('moves the line from the playhead with an arrow key while playing', async () => {
  const playbackEngine = lateEngine()
  await mountSplit({ playbackEngine })
  await openSplit(playbackEngine)
  await playInSplit(playbackEngine)
  playbackEngine.seek(20_000)
  await expect.element(line()).toHaveAttribute('aria-valuenow', '20000')

  press('ArrowRight')
  await expect.poll(() => playbackEngine.getState().playing).toBe(false)
  await expect.element(line()).toHaveAttribute('aria-valuenow', '20100')
  await expect.poll(() => playbackEngine.getState().positionMs).toBe(20_100)
})

it('opens Split from the page of a recording that must be split to upload', async () => {
  const db = openTestDb()
  const long = MAX_RECORDING_MS + 60_000
  await db.recordings.put(recordingRow('r1', { label: RECORDING_LABEL, tune_id: null }))
  await db.recording_files.put(
    recordingFile('r1', {
      blob: new Blob(['x'], { type: 'audio/mp4' }),
      local_duration_ms: long,
    }),
  )
  await renderApp({
    path: destination('recordings').root,
    db,
    frame: WIDE,
    playbackEngine: fakePlaybackEngine(),
  })
  await page
    .getByRole('row', { name: new RegExp(RECORDING_LABEL) })
    .first()
    .getByText(RECORDING_LABEL, { exact: true })
    .click()
  await page.getByRole('main').getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SPLIT }).click()
  await expect.element(mainButton()).toBeVisible()
})

const bands = () => [...(practice()?.querySelectorAll<HTMLElement>('[data-split-piece]') ?? [])]
const overviewBands = () => [
  ...(practice()?.querySelectorAll<HTMLElement>('[data-overview] .loop-color') ?? []),
]
const cutHandle = (n: number) => splitDialog().getByRole('slider', { name: CUT_HANDLE(n) })
const stripBox = () => practice()!.querySelector<HTMLElement>('[data-split-strip]')!

/** A mouse press, move, or lift on `target` at `x` px from the viewport's left. */
function pointerAt(target: Element, type: string, x: number) {
  const rect = target.getBoundingClientRect()
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: rect.top + rect.height / 2,
    }),
  )
}

/** A key pressed and let go on `target`, as on a focused handle. */
function keyOn(target: Element, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  )
  target.dispatchEvent(
    new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...init }),
  )
}

/** Cuts at each time in `ms`, made with the arrows and S from the start of the recording. */
async function cutAt(...ms: number[]) {
  let lineMs = 0
  for (const [index, at] of ms.entries()) {
    // A new cut is selected and the arrows would move it, so a skip lets it go first.
    if (index > 0) {
      await splitDialog().getByRole('button', { name: SKIP_FORWARD }).click()
      lineMs += 15_000
    }
    const steps = (at - lineMs) / 1000
    const key = steps < 0 ? 'ArrowLeft' : 'ArrowRight'
    for (let i = 0; i < Math.abs(steps); i++) press(key, { shiftKey: true })
    lineMs = at
    press('s')
    await expect.poll(() => cuts().length).toBe(index + 1)
  }
}

const colors = (elements: HTMLElement[]) => elements.map((element) => element.dataset.color)

it('tints no piece before the first cut, then every piece in its own color', async () => {
  const { engine } = await mountSplit()
  await openSplit(engine)
  await expect.poll(() => bands().length).toBe(0)
  await expect.poll(() => overviewBands().length).toBe(0)

  await cutAt(10_000)
  const both = [String(pieceColor(0)), String(pieceColor(1))]
  await expect.poll(() => colors(bands())).toEqual(both)
  await expect.poll(() => colors(overviewBands())).toEqual(both)
})

it('dragging a cut handle moves that cut, held 1 second past the cut before it', async () => {
  const { engine } = await mountSplit()
  await openSplit(engine)
  await cutAt(10_000, 22_000)
  await expect.element(cutHandle(2)).toHaveAttribute('aria-valuenow', '22000')

  const handle = cutHandle(2).element()
  const from = handle.getBoundingClientRect().left + handle.getBoundingClientRect().width / 2
  const to = stripBox().getBoundingClientRect().left + 40
  pointerAt(handle, 'pointerdown', from)
  pointerAt(handle, 'pointermove', from - 20)
  pointerAt(handle, 'pointermove', to)
  pointerAt(handle, 'pointerup', to)

  await expect.poll(() => cuts().map((cut) => cut.textContent)).toEqual(['0:10.0', '0:11.0'])
  // The line stays where it was, and the moved cut is no longer the selected one.
  await expect.element(line()).toHaveAttribute('aria-valuenow', '22000')
  await expect.element(mainButton()).toHaveAccessibleName(SPLIT_AT(22_000))
})

it('the arrows on a cut handle nudge that cut alone, held 1 second inside the range', async () => {
  const { engine } = await mountSplit()
  await openSplit(engine)
  await cutAt(58_000)
  const handle = cutHandle(1).element()

  keyOn(handle, 'ArrowRight')
  await expect.poll(() => cuts()[0]?.textContent).toBe('0:58.1')
  await expect.element(line()).toHaveAttribute('aria-valuenow', '58000')

  keyOn(handle, 'ArrowRight', { shiftKey: true })
  keyOn(handle, 'ArrowRight', { shiftKey: true })
  await expect.poll(() => cuts()[0]?.textContent).toBe('0:59.0')
  await expect.element(cutHandle(1)).toHaveAttribute('aria-valuenow', '59000')
  await expect.element(line()).toHaveAttribute('aria-valuenow', '58000')
})

it('a tap on a piece selects it, and a second tap lets it go', async () => {
  const { engine } = await mountSplit()
  await openSplit(engine)
  await cutAt(10_000)
  const selected = () => bands().map((band) => band.dataset.selected ?? null)
  const overviewDimmed = () =>
    overviewBands().map((band) => band.dataset.selectedLoop === undefined)
  // The line sits in the second piece, so the overview marks that one.
  await expect.poll(overviewDimmed).toEqual([true, false])

  await tap(page.elementLocator(bands()[0]!))
  await expect.poll(selected).toEqual(['true', null])
  await expect.poll(overviewDimmed).toEqual([false, true])

  await tap(page.elementLocator(bands()[0]!))
  await expect.poll(selected).toEqual([null, null])
  await expect.poll(overviewDimmed).toEqual([true, false])
})

it('Play stops on the next cut with the line on it, and the next Play goes on to the cut after', async () => {
  const { engine } = await mountSplit()
  await openSplit(engine)
  await cutAt(10_000, 20_000)
  await splitDialog().getByRole('button', { name: SKIP_BACK }).click()
  await expect.element(line()).toHaveAttribute('aria-valuenow', '5000')

  await splitDialog().getByRole('button', { name: PLAY }).click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  engine.seek(10_500)
  await expect.poll(() => engine.getState().playing).toBe(false)
  await expect.element(line()).toHaveAttribute('aria-valuenow', '10000')
  await expect.poll(() => engine.getState().positionMs).toBe(10_000)
  await expect.element(mainButton()).toHaveAccessibleName(REMOVE_CUT)

  await splitDialog().getByRole('button', { name: PLAY }).click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  engine.seek(15_000)
  await expect.element(line()).toHaveAttribute('aria-valuenow', '15000')
  expect(engine.getState().playing).toBe(true)
  engine.seek(20_500)
  await expect.poll(() => engine.getState().playing).toBe(false)
  await expect.element(line()).toHaveAttribute('aria-valuenow', '20000')
})

it('a skip while playing stops at the first cut after where it lands', async () => {
  const { engine } = await mountSplit()
  await openSplit(engine)
  await cutAt(10_000, 20_000)
  await splitDialog().getByRole('button', { name: SKIP_BACK }).click()
  await expect.element(line()).toHaveAttribute('aria-valuenow', '5000')

  await splitDialog().getByRole('button', { name: PLAY }).click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await splitDialog().getByRole('button', { name: SKIP_FORWARD }).click()
  await expect.element(line()).toHaveAttribute('aria-valuenow', '20000')
  expect(engine.getState().playing).toBe(true)
  engine.seek(30_000)
  await expect.element(line()).toHaveAttribute('aria-valuenow', '30000')
  expect(engine.getState().playing).toBe(true)
})

it('a tap on the zoomed strip with no cuts selects nothing, so Play starts at the line', async () => {
  const { engine } = await mountSplit()
  await openSplit(engine)
  engine.pause()
  await expect.poll(() => engine.getState().playing).toBe(false)
  await splitDialog().getByRole('button', { name: SKIP_FORWARD }).click()
  await expect.element(line()).toHaveAttribute('aria-valuenow', '15000')
  await tap(zoomed())

  await splitDialog().getByRole('button', { name: PLAY }).click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await expect.poll(() => engine.getState().positionMs).toBe(15_000)
})
