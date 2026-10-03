import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { removeLoop, updateLoop } from '../../commands/loops'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import { updateRecording } from '../../commands/recordings'
import type * as RecordingCommands from '../../commands/recordings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { modal, presentedModal } from '../../test/dialogs'
import { renderIonic } from '../../test/ionic'
import { FakeAudioElement, fakePlaybackEngine, realClock } from '../../test/providers'
import { captureRecording, liveLoops, seedLoop } from '../../test/recordings'
import { tuneRow } from '../../test/rows'
import { PAUSE, PLAY, REPEAT_LOOP } from '../player/transportCopy'
import type { PlaybackEngine } from '../player/playbackEngine'
import { formatPreciseDuration } from '../recording/format'
import { PITCH, PITCH_UP } from '../recording-screen/PitchPanel'
import { CLOSE_RECORDING } from '../recording-screen/RecordingScreen'
import { SKIP_BACK, SKIP_MS } from '../recording-screen/Transport'
import { FASTER, SPEED } from '../recording-screen/SpeedPanel'
import { ZOOM_IN } from '../recording-screen/panel'
import { useRecordingScreen } from '../recording-screen/useRecordingScreen'
import { PITCH_NOT_SAVED, SPEED_NOT_SAVED } from './usePracticeSettings'
import {
  DELETE_LOOP,
  FIT,
  INSIDE_LOOP,
  LANES_LABEL,
  LOCKED_LOOPS_NOTICE,
  LOOP_CREATED,
  LOOP_NAME,
  LOOP_SELECTED,
  LOOPS_LABEL,
  NEW_LOOP,
  NEXT_LOOP,
  NO_LOOP,
  PREVIOUS_LOOP,
  SEGMENT_LABEL,
} from './practiceCopy'
import { fitScale, minPxPerS, OPENING_SPAN_MS } from './practiceZoom'
import { ARROW_LARGE_STEP_MS, ARROW_STEP_MS } from './PracticeWaveform'
import { MODE_KEY } from './usePracticeMode'

vi.mock('../../commands/recordings', { spy: true })
vi.mock('../../commands/loops', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  localStorage.removeItem(MODE_KEY)
})

afterEach(async () => {
  document.documentElement.classList.remove('ios')
  vi.restoreAllMocks()
})

/** A recording captured on this device, so its blob is already held locally. */
async function localRecording(extra: Parameters<typeof captureRecording>[1] = {}) {
  const id = await captureRecording(db, { label: 'Jam recording', ...extra })
  vi.mocked(updateRecording).mockClear()
  return id
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A key pressed with focus on nothing in particular. */
function press(key: string, init: KeyboardEventInit = {}) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

/** The screen opened on `id`, once its audio has loaded and it holds the keyboard. */
async function openRecording(id: string, { engine = fakePlaybackEngine() } = {}) {
  const load = vi.spyOn(engine, 'load')
  function Opener() {
    const { open } = useRecordingScreen()
    return (
      <button type="button" onClick={() => open(id)}>
        Open recording
      </button>
    )
  }
  const rendered = renderIonic(<Opener />, {
    db,
    playbackEngine: engine,
    recordingScreen: true,
    dock: true,
  })
  await page.getByRole('button', { name: 'Open recording' }).click()
  await expect.poll(() => load.mock.calls.length).toBe(1)
  await expect.poll(() => waveform()?.dataset.pxPerS).toBeTruthy()
  await modal()
  return { engine, load, rendered }
}

const waveform = () => presentedModal()?.querySelector<HTMLElement>('[data-practice-waveform]')
const pxPerS = () => Number(waveform()?.dataset.pxPerS)
const widthPx = () => waveform()!.clientWidth
const slider = () => page.getByRole('slider', { name: LANES_LABEL })
const announced = () =>
  presentedModal()?.querySelector('[data-practice-announcer]')?.textContent ?? ''

/** A tap on the waveform at `ms` (trimmed timeline), with the playhead at `centerMs`. */
function tapAt(ms: number, centerMs: number) {
  const target = slider().element()
  const rect = waveform()!.getBoundingClientRect()
  const x = rect.width / 2 + ((ms - centerMs) / 1000) * pxPerS()
  for (const type of ['pointerdown', 'pointerup']) {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pointerType: 'mouse',
        clientX: rect.left + x,
        clientY: rect.top + 40,
      }),
    )
  }
}

/** A pointer event on the waveform `dx` px from its center. */
function onWaveform(type: string, dx: number, pointerType = 'mouse') {
  const rect = waveform()!.getBoundingClientRect()
  slider()
    .element()
    .dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pointerType,
        clientX: rect.left + rect.width / 2 + dx,
        clientY: rect.top + 40,
      }),
    )
}

/**
 * A touch flung toward later in the take, which leaves a glide running. The release speed is
 * read off the clock, so the clock steps exactly one frame per move however busy the runner is.
 */
function fling() {
  vi.useFakeTimers({ toFake: ['performance'] })
  try {
    onWaveform('pointerdown', 0, 'touch')
    for (const dx of [-30, -60, -90]) {
      vi.advanceTimersByTime(16)
      onWaveform('pointermove', dx, 'touch')
    }
    onWaveform('pointerup', -90, 'touch')
  } finally {
    vi.useRealTimers()
  }
}

/** The playhead the waveform shows, on the trimmed timeline. */
const shownMs = () => Number(slider().element().getAttribute('aria-valuenow'))

/** A glide outlasts this, so a playhead still in place after it was not carried on. */
const GLIDE_DONE_MS = 1200

/** Selects the first loop after the playhead through Next loop. */
async function selectNext(engine: PlaybackEngine) {
  await (await modal()).getByRole('button', { name: NEXT_LOOP }).click()
  await expect.poll(() => engine.getState().loop).not.toBeNull()
}

describe('Practice', () => {
  it('opening shows 30 s around the playhead when no loop is selected', async () => {
    const id = await localRecording({ durationMs: 120_000 })
    await openRecording(id)
    await expect.poll(pxPerS).toBeCloseTo(widthPx() / (OPENING_SPAN_MS / 1000), 5)
  })

  it('opening fits the selected loop', async () => {
    const id = await localRecording({ durationMs: 120_000 })
    await seedLoop(db, id, 10_000, 20_000)
    const { engine } = await openRecording(id)
    await selectNext(engine)
    engine.pause()
    engine.seek(15_000)
    await (await modal()).getByRole('button', { name: CLOSE_RECORDING }).click()
    await expect.poll(presentedModal).toBeNull()
    await page.getByRole('button', { name: 'Open recording' }).click()
    await expect.poll(() => waveform()?.dataset.pxPerS).toBeTruthy()
    await expect.poll(() => engine.getState().loop).not.toBeNull()
    // Centered on the playhead, the farther end shows with its margin.
    await expect.poll(pxPerS).toBeCloseTo(widthPx() / 2 / 6, 5)
  })

  it('Fit frames the selected loop and moves an outside playhead to its start', async () => {
    const id = await localRecording({ durationMs: 120_000 })
    await seedLoop(db, id, 10_000, 20_000)
    const { engine } = await openRecording(id)
    await selectNext(engine)
    engine.pause()
    engine.seek(40_000)
    const screen = await modal()
    await screen.getByRole('button', { name: FIT, exact: true }).click()
    await expect
      .poll(pxPerS)
      .toBeCloseTo(fitScale({ startMs: 10_000, endMs: 20_000 }, 10_000, widthPx()), 5)
    await expect.poll(() => engine.getState().positionMs).toBe(10_000)

    // A playhead inside the loop stays put, and the scale makes room for the farther end.
    engine.seek(18_000)
    await screen.getByRole('button', { name: FIT, exact: true }).click()
    await expect.poll(pxPerS).toBeCloseTo(widthPx() / 2 / 9, 5)
    await expect.poll(() => engine.getState().positionMs).toBe(18_000)

    // With nothing selected, Fit shows the whole take and leaves the playhead alone.
    press('Escape')
    await expect.poll(() => engine.getState().loop).toBeNull()
    engine.seek(50_000)
    await screen.getByRole('button', { name: FIT, exact: true }).click()
    await expect.poll(pxPerS).toBeCloseTo(minPxPerS(widthPx(), 120_000), 5)
    await expect.poll(() => engine.getState().positionMs).toBe(50_000)
  })

  it('the play button names the repeat', async () => {
    const id = await localRecording()
    await seedLoop(db, id, 10_000, 20_000, { label: 'B part' })
    const { engine } = await openRecording(id)
    engine.pause()
    const screen = await modal()
    await expect.element(screen.getByRole('button', { name: PLAY, exact: true })).toBeVisible()
    await selectNext(engine)
    const repeat = screen.getByRole('button', { name: REPEAT_LOOP('B part'), exact: true })
    await repeat.click()
    await expect.poll(() => engine.getState().playing).toBe(true)
    await expect.poll(() => engine.getState().positionMs).toBe(10_000)
    await expect.element(screen.getByRole('button', { name: PAUSE, exact: true })).toBeVisible()
  })

  it('shows the playhead to the tenth of a second', async () => {
    const id = await localRecording()
    const { engine } = await openRecording(id)
    engine.seek(12_340)
    await expect
      .element((await modal()).getByText(formatPreciseDuration(12_340), { exact: true }))
      .toBeVisible()
  })

  it('opens on the Loops mode the first time and on the last mode after', async () => {
    const id = await localRecording()
    const { rendered } = await openRecording(id)
    const loops = (await modal()).getByRole('tab', { name: LOOPS_LABEL, exact: true })
    await expect.element(loops).toHaveAttribute('aria-selected', 'true')
    await (await modal()).getByRole('tab', { name: SPEED, exact: true }).click({ force: true })
    await expect.poll(() => localStorage.getItem(MODE_KEY)).toBe('speed')
    rendered.unmount()
    await openRecording(id)
    await expect
      .element((await modal()).getByRole('tab', { name: SPEED, exact: true }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('selects a tapped loop and says so, and a tap outside every loop deselects', async () => {
    const id = await localRecording()
    await seedLoop(db, id, 10_000, 20_000, { label: 'B part' })
    const { engine } = await openRecording(id)
    engine.pause()
    engine.seek(8000)
    await expect.poll(() => slider().element().getAttribute('aria-valuenow')).toBe('8000')
    tapAt(11_000, 8000)
    await expect.poll(() => engine.getState().loop?.id).toBeTruthy()
    await expect.poll(announced).toBe(LOOP_SELECTED('B part'))
    // Selecting moved the playhead to the loop's start.
    await expect.poll(() => engine.getState().positionMs).toBe(10_000)
    await expect.poll(() => slider().element().getAttribute('aria-valuenow')).toBe('10000')
    tapAt(5000, 10_000)
    await expect.poll(() => engine.getState().loop).toBeNull()
  })

  describe('acting where the playhead shows', () => {
    it('N acts at a drag’s playhead, not the engine’s', async () => {
      const id = await localRecording({ durationMs: 120_000 })
      const { engine } = await openRecording(id)
      engine.pause()
      engine.seek(30_000)
      await expect.poll(shownMs).toBe(30_000)
      onWaveform('pointerdown', 0)
      onWaveform('pointermove', -60)
      await expect.poll(shownMs).toBeGreaterThan(32_000)
      const at = shownMs()
      expect(engine.getState().positionMs).toBe(30_000)
      press('n')
      await expect.poll(async () => (await liveLoops(db, id)).length).toBe(1)
      const [made] = await liveLoops(db, id)
      expect(Math.abs(made!.start_ms - (at - 4000))).toBeLessThanOrEqual(1)
      onWaveform('pointerup', -60)
    })

    it('[ acts at a drag’s playhead, not the engine’s', async () => {
      const id = await localRecording({ durationMs: 120_000 })
      const loop = await seedLoop(db, id, 40_000, 50_000)
      const { engine } = await openRecording(id)
      await selectNext(engine)
      engine.pause()
      engine.seek(30_000)
      await expect.poll(shownMs).toBe(30_000)
      onWaveform('pointerdown', 0)
      onWaveform('pointermove', -60)
      await expect.poll(shownMs).toBeGreaterThan(32_000)
      const at = shownMs()
      press('[')
      await expect.poll(async () => (await db.recording_loops.get(loop))?.start_ms).not.toBe(40_000)
      const start = (await db.recording_loops.get(loop))!.start_ms
      expect(Math.abs(start - at)).toBeLessThanOrEqual(1)
      onWaveform('pointerup', -60)
    })

    it('N stops a glide and makes the loop where it showed', async () => {
      const id = await localRecording({ durationMs: 120_000 })
      const { engine } = await openRecording(id)
      engine.pause()
      engine.seek(30_000)
      await expect.poll(shownMs).toBe(30_000)
      fling()
      await expect.poll(shownMs).toBeGreaterThan(35_000)
      press('n')
      const at = engine.getState().positionMs
      expect(at).toBeGreaterThan(35_000)
      await expect.poll(async () => (await liveLoops(db, id)).length).toBe(1)
      const [made] = await liveLoops(db, id)
      expect(Math.abs(made!.start_ms - (at - 4000))).toBeLessThanOrEqual(1)
      await wait(GLIDE_DONE_MS)
      expect(engine.getState().positionMs).toBe(at)
    })

    it('a skip stops a glide and skips from where it showed', async () => {
      const id = await localRecording({ durationMs: 120_000 })
      const { engine } = await openRecording(id)
      engine.pause()
      engine.seek(30_000)
      await expect.poll(shownMs).toBe(30_000)
      fling()
      await expect.poll(shownMs).toBeGreaterThan(35_000)
      await (await modal()).getByRole('button', { name: SKIP_BACK }).click()
      const at = engine.getState().positionMs
      expect(at).toBeGreaterThan(35_000 - SKIP_MS)
      await wait(GLIDE_DONE_MS)
      expect(engine.getState().positionMs).toBe(at)
    })

    it('a tap on the overview stops a glide', async () => {
      const id = await localRecording({ durationMs: 120_000 })
      const { engine } = await openRecording(id)
      engine.pause()
      engine.seek(30_000)
      await expect.poll(shownMs).toBe(30_000)
      fling()
      await expect.poll(shownMs).toBeGreaterThan(35_000)
      const overview = presentedModal()!.querySelector<HTMLElement>('[data-overview]')!
      const rect = overview.getBoundingClientRect()
      const tap = { bubbles: true, pointerId: 2, button: 0, pointerType: 'mouse' }
      overview.dispatchEvent(
        new PointerEvent('pointerdown', { ...tap, clientX: rect.left + 1, clientY: rect.top + 4 }),
      )
      overview.dispatchEvent(
        new PointerEvent('pointerup', { ...tap, clientX: rect.left + 1, clientY: rect.top + 4 }),
      )
      await expect.poll(() => engine.getState().positionMs).toBeLessThan(5000)
      const at = engine.getState().positionMs
      await wait(GLIDE_DONE_MS)
      expect(engine.getState().positionMs).toBe(at)
    })

    it('turns New loop, N, [ and ] off while the audio is not loaded', async () => {
      const id = await localRecording({ durationMs: 120_000 })
      const loop = await seedLoop(db, id, 10_000, 20_000)
      const engine = fakePlaybackEngine()
      engine.load = () => {}
      await openRecording(id, { engine })
      const screen = await modal()
      await expect
        .element(screen.getByRole('button', { name: NEW_LOOP, exact: true }))
        .toBeDisabled()
      await expect.element(screen.getByRole('button', { name: NEXT_LOOP })).toBeDisabled()
      press('n')
      press('[')
      press(']')
      await wait(100)
      expect(await liveLoops(db, id)).toHaveLength(1)
      expect(await db.recording_loops.get(loop)).toMatchObject({ start_ms: 10_000, end_ms: 20_000 })
      expect(vi.mocked(updateLoop)).not.toHaveBeenCalled()
    })
  })

  it('Previous moves the playhead to the start of a loop it is inside', async () => {
    const id = await localRecording({ durationMs: 120_000 })
    await seedLoop(db, id, 10_000, 20_000, { label: 'B part' })
    const { engine } = await openRecording(id)
    engine.pause()
    engine.seek(15_000)
    await expect.poll(shownMs).toBe(15_000)
    await (await modal()).getByRole('button', { name: PREVIOUS_LOOP }).click()
    await expect.poll(() => engine.getState().loop?.label).toBe('B part')
    await expect.poll(() => engine.getState().positionMs).toBe(10_000)
  })

  it('the switcher under the play button names the loop and steps to the next one', async () => {
    const id = await localRecording({ durationMs: 120_000 })
    await seedLoop(db, id, 10_000, 20_000, { label: 'B part' })
    await seedLoop(db, id, 40_000, 50_000)
    const { engine } = await openRecording(id)
    engine.pause()
    engine.seek(5000)
    const switcher = () => presentedModal()!.querySelector<HTMLElement>('[data-loop-switcher]')!
    await expect.poll(() => switcher()?.textContent).toContain(NO_LOOP)
    await selectNext(engine)
    await expect.poll(() => switcher().textContent).toContain('B part')
    await expect.poll(() => engine.getState().positionMs).toBe(10_000)
    await (await modal()).getByRole('button', { name: NEXT_LOOP }).click()
    await expect.poll(() => switcher().textContent).toContain('Loop 0:40')
    await expect.poll(() => engine.getState().positionMs).toBe(40_000)
  })

  describe('keys', () => {
    it('Space plays and pauses', async () => {
      const id = await localRecording()
      const { engine } = await openRecording(id)
      await expect.poll(() => engine.getState().playing).toBe(true)
      press(' ')
      await expect.poll(() => engine.getState().playing).toBe(false)
      press(' ')
      await expect.poll(() => engine.getState().playing).toBe(true)
    })

    it('Space plays and pauses with the waveform focused', async () => {
      const id = await localRecording()
      const { engine } = await openRecording(id)
      await expect.poll(() => engine.getState().playing).toBe(true)
      const surface = slider().element() as HTMLElement
      surface.focus()
      const space = () =>
        surface.dispatchEvent(
          new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
        )
      space()
      await expect.poll(() => engine.getState().playing).toBe(false)
      space()
      await expect.poll(() => engine.getState().playing).toBe(true)
    })

    it('the arrows move the playhead a second, and five with Shift', async () => {
      const id = await localRecording()
      const { engine } = await openRecording(id)
      engine.seek(10_000)
      press('ArrowRight')
      await expect.poll(() => engine.getState().positionMs).toBe(10_000 + ARROW_STEP_MS)
      press('ArrowRight', { shiftKey: true })
      await expect
        .poll(() => engine.getState().positionMs)
        .toBe(10_000 + ARROW_STEP_MS + ARROW_LARGE_STEP_MS)
      press('ArrowLeft')
      await expect.poll(() => engine.getState().positionMs).toBe(10_000 + ARROW_LARGE_STEP_MS)
      press('ArrowLeft', { shiftKey: true })
      await expect.poll(() => engine.getState().positionMs).toBe(10_000)
    })

    it('[ and ] set the selected loop’s start and end at the playhead, clamped', async () => {
      const id = await localRecording()
      const loop = await seedLoop(db, id, 10_000, 20_000)
      await seedLoop(db, id, 22_000, 25_000)
      const { engine } = await openRecording(id)
      await selectNext(engine)
      engine.pause()
      engine.seek(15_000)
      press('[')
      await expect.poll(async () => (await db.recording_loops.get(loop))?.start_ms).toBe(15_000)
      engine.seek(18_000)
      press(']')
      await expect.poll(async () => (await db.recording_loops.get(loop))?.end_ms).toBe(18_000)
      // Past the next loop's start, the end stops flush against it.
      engine.seek(24_000)
      press(']')
      await expect.poll(async () => (await db.recording_loops.get(loop))?.end_ms).toBe(22_000)
    })

    it('N adds a loop at the playhead and says so', async () => {
      const id = await localRecording()
      const { engine } = await openRecording(id)
      engine.pause()
      engine.seek(10_000)
      press('n')
      await expect.poll(async () => (await liveLoops(db, id)).length).toBe(1)
      const [created] = await liveLoops(db, id)
      expect(created).toMatchObject({ start_ms: 6000, end_ms: 14_000 })
      await expect.poll(() => engine.getState().loop?.id).toBe(created!.id)
      await expect.poll(announced).toBe(LOOP_CREATED)
    })

    it.each(['Delete', 'Backspace'])('%s removes the selected loop', async (key) => {
      const id = await localRecording()
      await seedLoop(db, id, 10_000, 20_000)
      const { engine } = await openRecording(id)
      await selectNext(engine)
      press(key)
      await expect.poll(async () => (await liveLoops(db, id)).length).toBe(0)
      expect(vi.mocked(removeLoop)).toHaveBeenCalledOnce()
    })

    it('Enter renames the selected loop', async () => {
      const id = await localRecording()
      const loop = await seedLoop(db, id, 10_000, 20_000)
      const { engine } = await openRecording(id)
      await selectNext(engine)
      ;(document.activeElement as HTMLElement | null)?.blur()
      press('Enter')
      const field = page.getByRole('textbox', { name: LOOP_NAME })
      await expect.element(field).toHaveFocus()
      await userEvent.keyboard('B part{Enter}')
      await expect.poll(async () => (await db.recording_loops.get(loop))?.label).toBe('B part')
    })

    it('Ctrl or Command with plus and minus zooms', async () => {
      const id = await localRecording({ durationMs: 120_000 })
      await openRecording(id)
      const start = pxPerS()
      press('=', { ctrlKey: true })
      await expect.poll(pxPerS).toBeCloseTo(start * 2, 5)
      press('-', { metaKey: true })
      await expect.poll(pxPerS).toBeCloseTo(start, 5)
    })

    it('leaves the keys alone in a text field', async () => {
      const id = await localRecording()
      const { engine } = await openRecording(id)
      engine.pause()
      const input = document.createElement('input')
      presentedModal()!.append(input)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
      await wait(100)
      expect(await liveLoops(db, id)).toHaveLength(0)
      expect(engine.getState().playing).toBe(false)
      input.remove()
    })
  })

  it('a suggestion chip names the loop with one write', async () => {
    await db.tunes.put(tuneRow('t1', 'Tune', { part_structure: 'AABB' }))
    const id = await localRecording({ tuneId: 't1' })
    const loop = await seedLoop(db, id, 10_000, 20_000)
    const { engine } = await openRecording(id)
    await selectNext(engine)
    ;(document.activeElement as HTMLElement | null)?.blur()
    press('Enter')
    await expect.element(page.getByRole('textbox', { name: LOOP_NAME })).toHaveFocus()
    await userEvent.keyboard('typed')
    await (await modal()).getByRole('button', { name: 'B part', exact: true }).click()
    await expect.poll(async () => (await db.recording_loops.get(loop))?.label).toBe('B part')
    await wait(100)
    expect(vi.mocked(updateLoop)).toHaveBeenCalledOnce()
    await expect.element(page.getByRole('textbox', { name: LOOP_NAME })).not.toBeInTheDocument()
  })

  it('moves focus to the waveform after Delete', async () => {
    const id = await localRecording()
    await seedLoop(db, id, 10_000, 20_000)
    const { engine } = await openRecording(id)
    await selectNext(engine)
    await (await modal()).getByRole('button', { name: DELETE_LOOP, exact: true }).click()
    await expect.poll(async () => (await liveLoops(db, id)).length).toBe(0)
    await expect.element(slider()).toHaveFocus()
  })

  it('moves focus to the waveform after the Delete key', async () => {
    const id = await localRecording()
    await seedLoop(db, id, 10_000, 20_000)
    const { engine } = await openRecording(id)
    await selectNext(engine)
    ;(document.activeElement as HTMLElement | null)?.blur()
    press('Delete')
    await expect.poll(async () => (await liveLoops(db, id)).length).toBe(0)
    await expect.element(slider()).toHaveFocus()
  })

  it('says why N made no loop, outside the Loops mode too', async () => {
    const id = await localRecording()
    await seedLoop(db, id, 10_000, 20_000, { label: 'B part' })
    const { engine } = await openRecording(id)
    await selectNext(engine)
    engine.pause()
    await (await modal()).getByRole('tab', { name: SPEED, exact: true }).click({ force: true })
    press('n')
    await expect.poll(announced).toBe(INSIDE_LOOP('B part'))
    expect(await liveLoops(db, id)).toHaveLength(1)
  })

  it('the web notice about locked screens shows when a loop is selected', async () => {
    document.documentElement.classList.add('ios')
    const id = await localRecording()
    await seedLoop(db, id, 10_000, 20_000)
    const { engine } = await openRecording(id)
    await expect.element(page.getByText(LOCKED_LOOPS_NOTICE)).not.toBeVisible()
    await selectNext(engine)
    await expect.element(page.getByText(LOCKED_LOOPS_NOTICE)).toBeVisible()
  })

  describe('layout', () => {
    it('stacks the mode selector, the transport, then the mode controls, with the switcher under the play button', async () => {
      const id = await localRecording()
      await seedLoop(db, id, 10_000, 20_000)
      const { engine } = await openRecording(id)
      engine.pause()
      const screen = presentedModal()!
      const box = (selector: string) => screen.querySelector(selector)!.getBoundingClientRect()
      await expect
        .poll(() => box('[data-mode-selector]').top - waveform()!.getBoundingClientRect().bottom)
        .toBeGreaterThan(0)
      await expect
        .poll(() => box('[data-practice-transport]').top - box('[data-mode-selector]').bottom)
        .toBeGreaterThanOrEqual(0)
      await expect
        .poll(() => box('[data-mode-controls]').top - box('[data-practice-transport]').bottom)
        .toBeGreaterThanOrEqual(0)
      const play = (await modal()).getByRole('button', { name: PLAY, exact: true })
      await expect.element(play).toBeVisible()
      const button = () => play.element().getBoundingClientRect()
      await expect
        .poll(() => box('[data-loop-switcher]').top - button().bottom)
        .toBeGreaterThanOrEqual(0)
      await expect
        .poll(() => {
          const switcher = box('[data-loop-switcher]')
          return Math.abs(switcher.left + switcher.width / 2 - (button().left + button().width / 2))
        })
        .toBeLessThan(2)
    })

    it('gives the waveform a large share of a phone', async () => {
      const id = await localRecording()
      await openRecording(id)
      const canvas = () => waveform()!.querySelector('canvas')!.getBoundingClientRect().height
      await expect.poll(canvas).toBeGreaterThan(200)
    })

    it('keeps the waveform one height whatever is under it', async () => {
      await db.tunes.put(tuneRow('t1', 'Tune', { part_structure: 'AABB' }))
      const id = await localRecording({ tuneId: 't1' })
      const { engine } = await openRecording(id)
      const screen = await modal()
      const height = () => waveform()!.getBoundingClientRect().height
      const settled = async () => {
        await wait(100)
        return height()
      }
      await expect.poll(height).toBeGreaterThan(159)
      const start = await settled()
      expect(start).toBeGreaterThan(159)
      await screen.getByRole('tab', { name: SPEED, exact: true }).click({ force: true })
      await expect.element(screen.getByRole('button', { name: FASTER })).toBeVisible()
      expect(await settled()).toBe(start)
      await screen.getByRole('tab', { name: PITCH, exact: true }).click({ force: true })
      await expect.element(screen.getByRole('button', { name: PITCH_UP })).toBeVisible()
      expect(await settled()).toBe(start)
      await screen.getByRole('tab', { name: LOOPS_LABEL, exact: true }).click({ force: true })
      await expect.element(screen.getByRole('button', { name: NEW_LOOP })).toBeVisible()
      expect(await settled()).toBe(start)
      // A loop shows the switcher and hides the empty hint, and a rename shows the chips.
      await seedLoop(db, id, 10_000, 20_000)
      await selectNext(engine)
      expect(await settled()).toBe(start)
      for (const [tab, control] of [
        [SPEED, FASTER],
        [PITCH, PITCH_UP],
        [LOOPS_LABEL, NEW_LOOP],
      ] as const) {
        await screen.getByRole('tab', { name: tab, exact: true }).click({ force: true })
        await expect.element(screen.getByRole('button', { name: control })).toBeVisible()
        expect(await settled()).toBe(start)
      }
      ;(document.activeElement as HTMLElement | null)?.blur()
      press('Enter')
      await expect.element(page.getByRole('textbox', { name: LOOP_NAME })).toHaveFocus()
      await expect
        .element(screen.getByRole('button', { name: 'B part', exact: true }))
        .toBeVisible()
      expect(await settled()).toBe(start)
    })

    it('a press on the clock, Fit, or zoom over the waveform never seeks or scrubs', async () => {
      const id = await localRecording({ durationMs: 120_000 })
      // One loop under every overlay, which a press that reached the waveform would select.
      await seedLoop(db, id, 1000, 60_000)
      const { engine } = await openRecording(id)
      engine.pause()
      engine.seek(30_000)
      await expect.poll(shownMs).toBe(30_000)
      const screen = presentedModal()!
      const targets = [
        screen.querySelector<HTMLElement>('[data-practice-clock]')!,
        page.getByRole('button', { name: FIT, exact: true }).element() as HTMLElement,
        page.getByRole('button', { name: ZOOM_IN }).element() as HTMLElement,
      ]
      for (const target of targets) {
        // Each sits over the waveform, on top of it where it is pressed.
        const wave = () => waveform()!.getBoundingClientRect()
        await expect
          .poll(() => target.getBoundingClientRect().bottom - (wave().bottom + 1))
          .toBeLessThanOrEqual(0)
        await expect
          .poll(() => target.getBoundingClientRect().top - wave().top)
          .toBeGreaterThanOrEqual(0)
        const center = () => {
          const box = target.getBoundingClientRect()
          return [box.left + box.width / 2, box.top + box.height / 2] as const
        }
        await expect
          .poll(() => document.elementFromPoint(...center())?.closest('[data-practice-waveform]'))
          .toBeNull()
        const [x, y] = center()
        const at = (type: string, dx: number) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              isPrimary: true,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              pointerType: 'touch',
              clientX: x + dx,
              clientY: y,
            }),
          )
        at('pointerdown', 0)
        at('pointermove', -60)
        at('pointerup', -60)
        await wait(50)
        expect(shownMs()).toBe(30_000)
        expect(engine.getState().positionMs).toBe(30_000)
        // A tap there neither picks the loop under it nor deselects one.
        expect(engine.getState().loop).toBeNull()
      }
      await page.getByRole('button', { name: FIT, exact: true }).click()
      await expect.poll(pxPerS).toBeCloseTo(minPxPerS(widthPx(), 120_000), 5)
      expect(engine.getState().positionMs).toBe(30_000)
    })

    it('keeps 160 px of waveform on a landscape phone', async () => {
      await page.viewport(844, 390)
      try {
        const id = await localRecording()
        await openRecording(id)
        await expect.poll(() => waveform()!.getBoundingClientRect().height).toBeGreaterThan(159)
      } finally {
        await page.viewport(390, 844)
      }
    })

    it('holds the mode controls to the measure under the waveform when wide', async () => {
      await page.viewport(1024, 768)
      try {
        const id = await localRecording()
        await openRecording(id)
        const panel = () => presentedModal()!.querySelector('[data-mode-controls]')!
        await expect.poll(() => panel().getBoundingClientRect().width).toBeLessThan(641)
        await expect
          .poll(
            () => panel().getBoundingClientRect().top - waveform()!.getBoundingClientRect().bottom,
          )
          .toBeGreaterThan(0)
        await expect.poll(widthPx).toBeGreaterThan(700)
      } finally {
        await page.viewport(390, 844)
      }
    })
  })

  describe('speed and pitch', () => {
    async function speedMode() {
      const screen = await modal()
      await screen.getByRole('tab', { name: new RegExp(`^${SPEED}`) }).click({ force: true })
      return screen
    }

    it('plays a new speed at once and writes one outbox entry', async () => {
      const id = await localRecording()
      const element = new FakeAudioElement()
      const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
      await openRecording(id, { engine })
      const screen = await speedMode()
      await screen.getByRole('button', { name: FASTER }).click()
      await screen.getByRole('button', { name: FASTER }).click()
      await expect.poll(() => element.playbackRate).toBe(1.1)
      await expect
        .element(screen.getByRole('tab', { name: SEGMENT_LABEL(SPEED, '110%') }))
        .toBeVisible()
      expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
      await expect
        .poll(() => vi.mocked(updateRecording).mock.calls.length, { timeout: 3000 })
        .toBe(1)
      expect(vi.mocked(updateRecording).mock.calls[0]!.slice(1)).toEqual([
        id,
        { speed_percent: 110 },
      ])
      await expect
        .poll(() => db.outbox.where({ table: 'recordings', row_id: id }).toArray())
        .toHaveLength(1)
    })

    it('writes a pitch change still settling when the screen closes', async () => {
      const id = await localRecording()
      await openRecording(id)
      const screen = await modal()
      await screen.getByRole('tab', { name: PITCH, exact: true }).click({ force: true })
      await screen.getByRole('button', { name: PITCH_UP }).click()
      await screen.getByRole('button', { name: CLOSE_RECORDING }).click()
      await expect
        .poll(async () => (await db.recordings.get(id))?.pitch_cents, { timeout: 3000 })
        .toBe(100)
      expect(vi.mocked(updateRecording)).toHaveBeenCalledOnce()
    })

    it('keeps a newer speed when the write of an older one lands', async () => {
      const id = await localRecording()
      const actual = await vi.importActual<typeof RecordingCommands>('../../commands/recordings')
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      vi.mocked(updateRecording).mockImplementationOnce(async (...args) => {
        await gate
        return actual.updateRecording(...args)
      })
      const element = new FakeAudioElement()
      const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
      await openRecording(id, { engine })
      const screen = await speedMode()
      await screen.getByRole('button', { name: FASTER }).click()
      await expect
        .poll(() => vi.mocked(updateRecording).mock.calls.length, { timeout: 3000 })
        .toBe(1)
      await screen.getByRole('button', { name: FASTER }).click()
      const setSpeed = vi.spyOn(engine, 'setSpeed')
      release()
      await expect
        .poll(async () => (await db.recordings.get(id))?.speed_percent, { timeout: 3000 })
        .toBe(105)
      await wait(100)
      expect(setSpeed.mock.calls.map(([percent]) => percent)).not.toContain(105)
      expect(element.playbackRate).toBe(1.1)
      await expect
        .poll(async () => (await db.recordings.get(id))?.speed_percent, { timeout: 3000 })
        .toBe(110)
    })

    it('adopts a speed from elsewhere', async () => {
      const id = await localRecording()
      const actual = await vi.importActual<typeof RecordingCommands>('../../commands/recordings')
      await openRecording(id)
      const screen = await speedMode()
      await actual.updateRecording(db, id, { speed_percent: 90 })
      await expect
        .element(screen.getByRole('tab', { name: SEGMENT_LABEL(SPEED, '90%') }))
        .toBeVisible()
    })

    it('reports a speed that could not be saved', async () => {
      const id = await localRecording()
      vi.mocked(updateRecording).mockRejectedValueOnce(new Error('The disk is full'))
      await openRecording(id)
      const screen = await speedMode()
      await screen.getByRole('button', { name: FASTER }).click()
      await expect
        .element(screen.getByRole('alert'), { timeout: 3000 })
        .toHaveTextContent(SPEED_NOT_SAVED)
    })

    it('reports a pitch that could not be saved after the screen closed as a toast', async () => {
      const id = await localRecording()
      vi.mocked(updateRecording).mockRejectedValueOnce(new Error('The disk is full'))
      await openRecording(id)
      const screen = await modal()
      await screen.getByRole('tab', { name: PITCH, exact: true }).click({ force: true })
      await screen.getByRole('button', { name: PITCH_UP }).click()
      await screen.getByRole('button', { name: CLOSE_RECORDING }).click()
      await expect.element(page.getByText(PITCH_NOT_SAVED), { timeout: 3000 }).toBeVisible()
    })

    it('says nothing when the recording is gone before its write', async () => {
      const id = await localRecording()
      vi.mocked(updateRecording).mockRejectedValueOnce(new Error(RECORDING_NOT_FOUND))
      // No playback ticks, so nothing but the write can re-render the screen.
      const engine = fakePlaybackEngine(undefined, { ...realClock, every: () => () => {} })
      await openRecording(id, { engine })
      const screen = await speedMode()
      await screen.getByRole('button', { name: FASTER }).click()
      await expect
        .poll(() => vi.mocked(updateRecording).mock.calls.length, { timeout: 3000 })
        .toBe(1)
      await wait(100)
      expect(screen.getByRole('alert').elements()).toHaveLength(0)
    })
  })
})
