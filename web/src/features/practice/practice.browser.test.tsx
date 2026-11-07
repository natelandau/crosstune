import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { removeLoop, updateLoop } from '../../commands/loops'
import { PAUSE, PITCH_BADGE, SPEED_BADGE } from '../player/transportCopy'
import { ARROW_LARGE_STEP_MS, ARROW_STEP_MS } from './PracticeWaveform'
import {
  ISOLATE_LABEL,
  ISOLATE_UNAVAILABLE,
  LOCKED_LOOPS_NOTICE,
  LOOP_CREATED,
  LOOP_NAME,
  LOOP_SELECTED,
  LOOPS_LABEL,
  MODES_LABEL,
  MUTE,
  SEGMENT_LABEL,
  SET_END,
  SET_START,
} from './practiceCopy'
import { CENTS, PITCH, PITCH_PAUSES_ON_LOCK } from './PitchPanel'
import { SPEED } from './SpeedPanel'
import { TRIM } from './trimCopy'
import { OFFLINE } from '../../sync/labels'
import { liveLoops, seedLoop } from '../../test/recordings'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { GO_TO_TUNE } from '../recordings/recordingNames'
import { PALETTE } from '../../theme/tokens'
import { fakePlaybackEngine, fakeStage } from '../../test/providers'
import { isAppleTouch } from '../../platform/appleTouch'
import {
  mountPlaying,
  openButton,
  openPractice,
  PHONE,
  practice,
  recordingPage,
  press,
  WIDE,
} from '../../test/practice'

vi.mock('../../platform/appleTouch', { spy: true })
vi.mock('../../commands/loops', { spy: true })

const announced = () => practice()?.querySelector('[data-practice-announcer]')?.textContent ?? ''

it("opens from the phone bar on practice's background, in the light appearance too", async () => {
  await mountPlaying(PHONE)
  await openPractice()
  const background = PALETTE.light.practiceBackground
  const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16)).join(', ')})`
  await expect.poll(() => getComputedStyle(practice()!).backgroundColor).toBe(rgb)
})

it("opens from the dock's Expand on wide", async () => {
  await mountPlaying(WIDE)
  await openPractice()
  await expect.element(recordingPage()).toBeVisible()
})

it('plays and pauses with Space', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openPractice()
  await expect.poll(() => engine.getState().playing).toBe(true)
  press(' ')
  await expect.poll(() => engine.getState().playing).toBe(false)
  press(' ')
  await expect.poll(() => engine.getState().playing).toBe(true)
})

it('nudges the playhead with the arrows, further with Shift', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openPractice()
  press(' ')
  await expect.poll(() => engine.getState().playing).toBe(false)
  engine.seek(10_000)
  press('ArrowRight')
  await expect.poll(() => engine.getState().positionMs).toBe(10_000 + ARROW_STEP_MS)
  press('ArrowRight', { shiftKey: true })
  await expect
    .poll(() => engine.getState().positionMs)
    .toBe(10_000 + ARROW_STEP_MS + ARROW_LARGE_STEP_MS)
})

it('creates a loop with N and says so', async () => {
  const { db } = await mountPlaying(WIDE)
  await openPractice()
  press('n')
  await expect.poll(announced).toBe(LOOP_CREATED)
  await expect.poll(async () => (await liveLoops(db, 'r1')).length).toBe(1)
})

it('adds a loop with L too', async () => {
  const { db } = await mountPlaying(WIDE)
  await openPractice()
  press('L')
  await expect.poll(announced).toBe(LOOP_CREATED)
  await expect.poll(async () => (await liveLoops(db, 'r1')).length).toBe(1)
})

it('picks a loop by its number in waveform order, and a number past the last does nothing', async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await seedLoop(db, 'r1', 5000, 8000, { label: 'A part' })
  const second = await seedLoop(db, 'r1', 20_000, 24_000, { label: 'B part' })
  await openPractice()
  press(' ')
  await expect.poll(() => engine.getState().playing).toBe(false)
  press('2')
  await expect.poll(() => engine.getState().loop?.id).toBe(second)
  await expect.poll(announced).toBe(LOOP_SELECTED('B part'))
  await expect.poll(() => engine.getState().positionMs).toBe(20_000)
  expect(press('9', { cancelable: true }).defaultPrevented).toBe(false)
  expect(engine.getState().loop?.id).toBe(second)
  expect(engine.getState().positionMs).toBe(20_000)
  press('1')
  await expect.poll(announced).toBe(LOOP_SELECTED('A part'))
  expect(engine.getState().positionMs).toBe(5000)
})

it("moves the selected loop's edges to the playhead with Set start and Set end", async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await seedLoop(db, 'r1', 5000, 8000, { label: 'A part' })
  await openPractice()
  await page.getByRole('radio', { name: LOOPS_LABEL, exact: true }).click()
  press(' ')
  await expect.poll(() => engine.getState().playing).toBe(false)
  const setStart = page.getByRole('button', { name: SET_START })
  const setEnd = page.getByRole('button', { name: SET_END })
  await expect.element(setStart).toHaveAttribute('aria-disabled', 'true')
  await expect.element(setEnd).toHaveAttribute('aria-disabled', 'true')
  press('1')
  await expect.element(setStart).not.toHaveAttribute('aria-disabled')
  engine.seek(6000)
  await setStart.click()
  await expect.poll(async () => (await liveLoops(db, 'r1'))[0]?.start_ms).toBe(6000)
  // The moved loop reaches the engine before the playhead leaves it, or Repeat would bring it back.
  await expect.poll(() => engine.loopRange?.fromS).toBe(6)
  engine.seek(12_000)
  await expect.poll(() => engine.getState().positionMs).toBe(12_000)
  await setEnd.click()
  await expect.poll(async () => (await liveLoops(db, 'r1'))[0]?.end_ms).toBe(12_000)
  expect((await liveLoops(db, 'r1'))[0]?.start_ms).toBe(6000)
  // With its loop gone the button turns off but keeps focus, and a press does nothing.
  await expect.element(setEnd).toHaveFocus()
  await removeLoop(db, (await liveLoops(db, 'r1'))[0]!.id)
  await expect.element(setEnd).toHaveAttribute('aria-disabled', 'true')
  await expect.element(setEnd).toHaveFocus()
  const writes = vi.mocked(updateLoop).mock.calls.length
  await userEvent.keyboard('{Enter}')
  await expect.element(setEnd).toHaveFocus()
  expect(vi.mocked(updateLoop).mock.calls.length).toBe(writes)
})

it('loop_set reports each loop newly selected, a created one too', async () => {
  const analytics = recordingAnalytics()
  const { engine } = await mountPlaying(WIDE, {
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  await openPractice()
  const loopSets = () => analytics.sends().filter((send) => send.name === 'loop_set')
  press('n')
  await expect.poll(() => engine.getState().loop).not.toBeNull()
  press('Escape')
  await expect.poll(() => engine.getState().loop).toBeNull()
  // Two presses before the selection renders are one choice.
  press('1')
  press('1')
  await expect.poll(() => engine.getState().loop).not.toBeNull()
  // Choosing the loop already selected sets nothing new.
  press('1')
  press('Escape')
  await expect.poll(() => engine.getState().loop).toBeNull()

  expect(loopSets()).toEqual([
    { name: 'loop_set', props: { recording_id: 'r1' } },
    { name: 'loop_set', props: { recording_id: 'r1' } },
  ])
})

it('names a loop from a suggestion chip with one write, over a half-typed name', async () => {
  const { db, engine } = await mountPlaying(WIDE)
  await db.tunes.update('t1', { part_structure: 'AABB' })
  const loop = await seedLoop(db, 'r1', 5000, 8000)
  await openPractice()
  await page.getByRole('radio', { name: LOOPS_LABEL, exact: true }).click()
  press(' ')
  await expect.poll(() => engine.getState().playing).toBe(false)
  press('1')
  await expect.poll(() => engine.getState().loop?.id).toBe(loop)
  press('Enter')
  const name = page.getByRole('textbox', { name: LOOP_NAME })
  await expect.element(name).toHaveFocus()
  await userEvent.keyboard('typed')
  await page.getByRole('button', { name: 'B part', exact: true }).click()
  await expect.poll(async () => (await db.recording_loops.get(loop))?.label).toBe('B part')
  await expect.element(name).not.toBeInTheDocument()
  expect(updateLoop).toHaveBeenCalledOnce()
})

it('steps out of the loop with Escape and stays on the page, still playing', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openPractice()
  press('n')
  await expect.poll(() => engine.getState().loop).not.toBeNull()

  press('Escape')
  await expect.poll(() => engine.getState().loop).toBeNull()
  press('Escape')
  await expect.element(recordingPage()).toBeVisible()
  expect(practice()).not.toBeNull()
  await expect
    .element(recordingPage().getByRole('button', { name: PAUSE, exact: true }))
    .toBeVisible()
  await expect.poll(() => engine.getState().playing).toBe(true)
})

it('shows Trim disabled in More while offline', async () => {
  const { db } = await mountPlaying(WIDE, { ready: true })
  // Offline, and this device no longer holds the recording's audio, so Trim has nothing to edit.
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  window.dispatchEvent(new Event('offline'))
  await db.recording_files.update('r1', { blob: undefined })
  await openButton().click()
  const dialog = recordingPage()
  await dialog.getByRole('button', { name: MORE_ACTIONS }).click()
  const trim = page.getByRole('menuitem', { name: TRIM })
  await expect.element(trim).toHaveAttribute('aria-disabled', 'true')
  await expect.element(trim).toHaveTextContent(OFFLINE)
})

it('holds the mode panel at one height across Loops, Speed, and Pitch', async () => {
  await mountPlaying(PHONE)
  await openPractice()
  const height = () =>
    practice()!.querySelector<HTMLElement>('[data-mode-panel-root]')!.getBoundingClientRect().height
  const mode = (name: string) =>
    recordingPage().getByRole('radio', { name: new RegExp(`^${name}`) })

  await mode(LOOPS_LABEL).click()
  await expect.element(mode(LOOPS_LABEL)).toBeChecked()
  // Settled once two reads a poll apart agree.
  let last = -1
  await expect
    .poll(() => {
      const now = height()
      const steady = now === last
      last = now
      return steady
    })
    .toBe(true)
  const loops = last
  await mode(SPEED).click()
  await expect.element(mode(SPEED)).toBeChecked()
  await expect.poll(height).toBe(loops)
  await mode(PITCH).click()
  await expect.element(mode(PITCH)).toBeChecked()
  await expect.poll(height).toBe(loops)
  await mode(ISOLATE_LABEL).click()
  await expect.element(mode(ISOLATE_LABEL)).toBeChecked()
  await expect.poll(height).toBe(loops)
})

it('offers four modes for a recording, the Isolate segment naming Mute while it mutes', async () => {
  await mountPlaying(PHONE, { recording: { isolate_effect: 'mute' } })
  await openPractice()
  const modes = recordingPage().getByRole('radiogroup', { name: MODES_LABEL })
  await expect.poll(() => modes.getByRole('radio').all().length).toBe(4)
  await expect
    .element(modes.getByRole('radio', { name: SEGMENT_LABEL(ISOLATE_LABEL, MUTE), exact: true }))
    .toBeVisible()
})

it('engages the isolate stage while the Isolate mode shows, and not after', async () => {
  const stage = fakeStage()
  await mountPlaying(PHONE, {
    playbackEngine: fakePlaybackEngine(undefined, undefined, async () => stage.stage),
  })
  const engaged = stage.setEngaged
  await openPractice()
  const mode = (name: string) =>
    recordingPage().getByRole('radio', { name: new RegExp(`^${name}`) })
  await mode(ISOLATE_LABEL).click()
  await expect.poll(() => engaged.mock.lastCall).toEqual([true])
  await mode(LOOPS_LABEL).click()
  await expect.poll(() => engaged.mock.lastCall).toEqual([false])
})

it('lets the isolate stage go when the page closes on the Isolate mode', async () => {
  const stage = fakeStage()
  const { router } = await mountPlaying(PHONE, {
    playbackEngine: fakePlaybackEngine(undefined, undefined, async () => stage.stage),
  })
  const engaged = stage.setEngaged
  await openPractice()
  await recordingPage()
    .getByRole('radio', { name: new RegExp(`^${ISOLATE_LABEL}`) })
    .click()
  await expect.poll(() => engaged.mock.lastCall).toEqual([true])
  await router.navigate(-1)
  await expect.poll(practice).toBeNull()
  await expect.poll(() => engaged.mock.lastCall).toEqual([false])
})

/** A mode panel's own height, under the grid cell that stretches it to the tallest. */
const contentHeight = (mode: string) =>
  practice()!
    .querySelector<HTMLElement>(`[data-mode-panel="${mode}"]`)!
    .firstElementChild!.getBoundingClientRect().height

it('the isolate panel fits the panel height', async () => {
  await mountPlaying(PHONE)
  await openPractice()
  await expect.poll(() => contentHeight('isolate')).toBeGreaterThan(0)
  await expect
    .poll(
      () =>
        Math.max(contentHeight('loops'), contentHeight('speed'), contentHeight('pitch')) -
        contentHeight('isolate'),
    )
    .toBeGreaterThanOrEqual(0)
})

/** Every value off its default, so each segment's value label is its longest. */
const VALUED = { speed_percent: 75, pitch_cents: -250, isolate_effect: 'mute' } as const

const segments = () => [
  ...practice()!.querySelectorAll<HTMLElement>('[data-mode-selector] [role="radio"]'),
]
/** The label each segment shows, past its pill and its measuring copy. */
const shownLabel = (segment: HTMLElement) => segment.querySelector<HTMLElement>('span.relative')!

it('shows plain mode names where a value label would not fit, and the values where they do', async () => {
  document.documentElement.dataset.textSize = 'large'
  onTestFinished(() => {
    delete document.documentElement.dataset.textSize
  })
  await mountPlaying({ width: 320, height: 568 }, { recording: VALUED })
  await openPractice()
  await expect.poll(() => segments().length).toBe(4)
  const names = [SPEED, PITCH, ISOLATE_LABEL, LOOPS_LABEL]
  await expect.poll(() => segments().map((s) => shownLabel(s).textContent)).toEqual(names)
  // How far any label runs past its segment, or onto a second line.
  const overflow = () =>
    Math.max(
      ...segments().map((segment) => {
        const label = shownLabel(segment)
        const box = segment.getBoundingClientRect()
        const text = label.getBoundingClientRect()
        return Math.max(
          box.left - text.left,
          text.right - box.right,
          (label.getClientRects().length - 1) * 1000,
        )
      }),
    )
  await expect.poll(overflow).toBeLessThanOrEqual(0)
  // Each still carries its value in its name.
  await expect
    .poll(() => segments().map((s) => s.getAttribute('aria-label')))
    .toEqual([
      SEGMENT_LABEL(SPEED, SPEED_BADGE(75)),
      SEGMENT_LABEL(PITCH, PITCH_BADGE(-250)),
      SEGMENT_LABEL(ISOLATE_LABEL, MUTE),
      LOOPS_LABEL,
    ])

  // Wide enough that practice, beside the list and the attributes, has room for the values.
  await page.viewport(1920, 1080)
  await expect
    .poll(() => segments().map((s) => shownLabel(s).textContent))
    .toEqual([
      SEGMENT_LABEL(SPEED, SPEED_BADGE(75)),
      SEGMENT_LABEL(PITCH, PITCH_BADGE(-250)),
      SEGMENT_LABEL(ISOLATE_LABEL, MUTE),
      LOOPS_LABEL,
    ])
})

it('holds the panel height with one line in place of the isolate controls', async () => {
  const engine = fakePlaybackEngine(undefined, undefined, () => Promise.reject(new Error('no')))
  await mountPlaying(PHONE, { playbackEngine: engine })
  await openPractice()
  await recordingPage()
    .getByRole('radio', { name: new RegExp(`^${ISOLATE_LABEL}`) })
    .click()
  await expect
    .element(recordingPage().getByRole('status').filter({ hasText: ISOLATE_UNAVAILABLE }))
    .toBeVisible()
  await expect
    .poll(
      () =>
        Math.max(contentHeight('loops'), contentHeight('speed'), contentHeight('pitch')) -
        contentHeight('isolate'),
    )
    .toBeGreaterThanOrEqual(0)
})

it("goes to the recording's tune from More, leaving the page", async () => {
  const { router } = await mountPlaying(WIDE)
  await router.navigate('/recordings')
  await openPractice()
  await recordingPage().getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: GO_TO_TUNE }).click()
  await expect.poll(practice).toBeNull()
  await expect.poll(() => router.state.location.pathname).toBe('/catalog/t1')
})

it('says loops repeat only while the screen is on, on an iPhone or iPad with a loop selected', async () => {
  vi.mocked(isAppleTouch).mockReturnValue(true)
  const { engine } = await mountPlaying(PHONE)
  await openPractice()
  const notice = () => practice()!.querySelector<HTMLElement>('[data-locked-loops]')
  await expect.poll(() => notice()?.getAttribute('aria-hidden')).toBe('true')
  press('n')
  await expect.poll(() => engine.getState().loop).not.toBeNull()
  await expect.poll(() => notice()?.hasAttribute('aria-hidden')).toBe(false)
  await expect.element(page.getByText(LOCKED_LOOPS_NOTICE)).toBeVisible()
})

it('leaves the locked-screen notice out elsewhere', async () => {
  vi.mocked(isAppleTouch).mockReturnValue(false)
  const { engine } = await mountPlaying(PHONE)
  await openPractice()
  press('n')
  await expect.poll(() => engine.getState().loop).not.toBeNull()
  await expect.poll(() => practice()!.querySelector('[data-locked-loops]')).toBeNull()
})

it('says pitch-shifted playback pauses when the screen locks, on an iPhone or iPad only', async () => {
  vi.mocked(isAppleTouch).mockReturnValue(true)
  await mountPlaying(PHONE)
  await openPractice()
  const dialog = recordingPage()
  await dialog.getByRole('radio', { name: new RegExp(`^${PITCH}`) }).click()
  await expect.element(dialog.getByText(PITCH_PAUSES_ON_LOCK)).toBeVisible()
})

it('leaves the pitch lock notice out elsewhere', async () => {
  vi.mocked(isAppleTouch).mockReturnValue(false)
  await mountPlaying(PHONE)
  await openPractice()
  const dialog = recordingPage()
  await dialog.getByRole('radio', { name: new RegExp(`^${PITCH}`) }).click()
  await expect.element(dialog.getByRole('slider', { name: CENTS })).toBeVisible()
  expect(dialog.getByText(PITCH_PAUSES_ON_LOCK).query()).toBeNull()
})
