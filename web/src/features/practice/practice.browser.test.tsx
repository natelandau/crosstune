import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { ADD_NEW_TUNE, NEW_TUNE_TITLE } from '../tune/tuneFormCopy'
import { updateLoop } from '../../commands/loops'
import { PAUSE } from '../player/transportCopy'
import { ARROW_LARGE_STEP_MS, ARROW_STEP_MS } from './PracticeWaveform'
import {
  LOCKED_LOOPS_NOTICE,
  LOOP_CREATED,
  LOOP_NAME,
  LOOP_SELECTED,
  LOOPS_LABEL,
} from './practiceCopy'
import { CENTS, PITCH, PITCH_PAUSES_ON_LOCK } from './PitchPanel'
import { SPEED } from './SpeedPanel'
import { TRIM } from './trimCopy'
import { OFFLINE } from '../../sync/labels'
import { liveLoops, seedLoop } from '../../test/recordings'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { GO_TO_TUNE } from '../recordings/recordingNames'
import { PALETTE } from '../../theme/tokens'
import { isAppleTouch } from '../../platform/appleTouch'
import { addOfferLabel, SEARCH_TUNES } from '../catalog/catalogCopy'
import { EDIT, RECORDING_NAME_LABEL, ADD_TO_TUNE } from '../recordings/recordingCopy'
import {
  ADD_TO_TUNE_TITLE,
  addToTuneName,
  EDIT_RECORDING_TITLE,
} from '../recordings/recordingsCopy'
import { REMOVE_FROM_TUNE } from '../recordings/useRecordingActionsWith'
import {
  mountPlaying,
  openButton,
  openPractice,
  PHONE,
  player,
  practice,
  press,
  TAKE,
  WIDE,
} from '../../test/practice'

vi.mock('../../platform/appleTouch', { spy: true })
vi.mock('../../commands/loops', { spy: true })

const announced = () => practice()?.querySelector('[data-practice-announcer]')?.textContent ?? ''

it('opens from the phone bar on the jet ground, in the light appearance too', async () => {
  await mountPlaying(PHONE)
  await openPractice()
  const jet = PALETTE.light.jet
  const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(jet.slice(i, i + 2), 16)).join(', ')})`
  await expect.poll(() => getComputedStyle(practice()!).backgroundColor).toBe(rgb)
})

it("opens from the dock's Expand on wide", async () => {
  await mountPlaying(WIDE)
  await openPractice()
  await expect.element(page.getByRole('dialog', { name: TAKE })).toBeVisible()
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

it('picks a loop by its number in lane order, and a number past the last does nothing', async () => {
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

it('steps out with Escape: the loop, then practice, back to Expand, still playing', async () => {
  const { engine } = await mountPlaying(WIDE)
  await openPractice()
  const expand = openButton().element()
  press('n')
  await expect.poll(() => engine.getState().loop).not.toBeNull()

  press('Escape')
  await expect.poll(() => engine.getState().loop).toBeNull()
  expect(practice()).not.toBeNull()

  press('Escape')
  await expect.poll(practice).toBeNull()
  await expect.poll(() => document.activeElement).toBe(expand)
  await expect.element(player().getByRole('button', { name: PAUSE })).toBeVisible()
  expect(engine.getState().playing).toBe(true)
})

it('shows Trim disabled in More while offline', async () => {
  const { db } = await mountPlaying(WIDE, { ready: true })
  // Offline, and this device no longer holds the take's audio, so Trim has nothing to edit.
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  window.dispatchEvent(new Event('offline'))
  await db.recording_files.update('r1', { blob: undefined })
  await openButton().click()
  const dialog = page.getByRole('dialog', { name: TAKE })
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
    page.getByRole('dialog').getByRole('radio', { name: new RegExp(`^${name}`) })

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
})

it("goes to the take's tune from More, closing practice", async () => {
  const { router } = await mountPlaying(WIDE)
  await router.navigate('/recordings')
  await openPractice()
  await page.getByRole('dialog', { name: TAKE }).getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: GO_TO_TUNE }).click()
  await expect.poll(practice).toBeNull()
  await expect.poll(() => router.state.location.pathname).toBe('/catalog/t1')
})

it('edits the take from More', async () => {
  await mountPlaying(WIDE)
  await openPractice()
  await page.getByRole('dialog', { name: TAKE }).getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: EDIT }).click()
  const sheet = page.getByRole('dialog', { name: EDIT_RECORDING_TITLE })
  await expect.element(sheet.getByRole('textbox', { name: RECORDING_NAME_LABEL })).toHaveValue(TAKE)
})

it('searches for a tune to file the take under from More', async () => {
  await mountPlaying(WIDE, { filed: false })
  await openPractice()
  await page.getByRole('dialog', { name: TAKE }).getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: ADD_TO_TUNE }).click()
  const sheet = page.getByRole('dialog', { name: ADD_TO_TUNE_TITLE })
  await sheet.getByRole('searchbox', { name: SEARCH_TUNES }).fill('Sally Goodin')
  await expect
    .element(
      sheet.getByRole('button', {
        name: addOfferLabel({ kind: 'create', title: 'Sally Goodin', another: false }),
      }),
    )
    .toBeVisible()
})

it('files the take under a tune picked in Add to tune, back over practice', async () => {
  const { db } = await mountPlaying(WIDE, { filed: false })
  await openPractice()
  const dialog = page.getByRole('dialog', { name: TAKE })
  await dialog.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: ADD_TO_TUNE }).click()
  const sheet = page.getByRole('dialog', { name: ADD_TO_TUNE_TITLE })
  await sheet.getByRole('searchbox', { name: SEARCH_TUNES }).fill('joe')
  await sheet.getByRole('row', { name: addToTuneName('Old Joe Clark'), exact: true }).click()

  await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBe('t1')
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.element(dialog).toBeVisible()
  // Filed now, so More offers to take it out of the tune instead.
  await dialog.getByRole('button', { name: MORE_ACTIONS }).click()
  await expect.element(page.getByRole('menuitem', { name: REMOVE_FROM_TUNE })).toBeVisible()
  await expect.element(page.getByRole('menuitem', { name: ADD_TO_TUNE })).not.toBeInTheDocument()
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
  const dialog = page.getByRole('dialog', { name: TAKE })
  await dialog.getByRole('radio', { name: new RegExp(`^${PITCH}`) }).click()
  await expect.element(dialog.getByText(PITCH_PAUSES_ON_LOCK)).toBeVisible()
})

it('leaves the pitch lock notice out elsewhere', async () => {
  vi.mocked(isAppleTouch).mockReturnValue(false)
  await mountPlaying(PHONE)
  await openPractice()
  const dialog = page.getByRole('dialog', { name: TAKE })
  await dialog.getByRole('radio', { name: new RegExp(`^${PITCH}`) }).click()
  await expect.element(dialog.getByRole('slider', { name: CENTS })).toBeVisible()
  expect(dialog.getByText(PITCH_PAUSES_ON_LOCK).query()).toBeNull()
})

it('reports a tune made from the practice overlay as from the recording screen', async () => {
  const analytics = recordingAnalytics()
  await mountPlaying(WIDE, {
    filed: false,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  await openPractice()
  await page.getByRole('dialog', { name: TAKE }).getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: ADD_TO_TUNE }).click()
  const sheet = page.getByRole('dialog', { name: ADD_TO_TUNE_TITLE })
  await sheet.getByRole('searchbox', { name: SEARCH_TUNES }).fill('Sally Goodin')
  await sheet
    .getByRole('button', {
      name: addOfferLabel({ kind: 'create', title: 'Sally Goodin', another: false }),
    })
    .click()
  await page
    .getByRole('dialog', { name: NEW_TUNE_TITLE })
    .getByRole('button', { name: ADD_NEW_TUNE, exact: true })
    .click()
  // Playing and practice report too, as their plays end.
  const filing = () =>
    analytics.sends().filter((send) => !/^(playback|practice)_ended$/.test(send.name))
  await expect
    .poll(() => filing().map((send) => send.name))
    .toEqual(['tune_created', 'recording_filed'])
  expect(filing()[0]!.props).toMatchObject({ source: 'recording_screen' })
})
