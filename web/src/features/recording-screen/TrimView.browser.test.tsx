import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import {
  appendChunk,
  beginCapture,
  finishCapture,
  updateRecording,
} from '../../commands/recordings'
import { newId } from '../../commands/write'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import { CANCEL } from '../../ui/Confirm'
import { PAUSE } from '../player/Dock'
import { PlaybackEngine, type EngineClock } from '../player/playbackEngine'
import { usePlayer } from '../player/usePlayer'
import { RecordingsPage } from '../recordings/RecordingsPage'
import { TRIM_CHANGED_ELSEWHERE } from './RecordingScreen'
import { PRACTICE } from '../practice/practiceCopy'
import { END_HANDLE, START_HANDLE } from './TrimStrip'
import {
  GO_TO_START,
  PLAY_SELECTION,
  PREVIEW_END,
  SAVE_TRIM,
  SET_START,
  TRIM,
  TRIM_CONFIRM_ACTION,
  TRIM_CONFIRM_MESSAGE,
  TRIM_CONFIRM_TITLE,
  ZOOM_IN,
} from './TrimView'
import { EDIT_RECORDING } from './useRecordingScreen'
import { SEEK_LABEL } from './Waveform'

vi.mock('../../commands/recordings', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

/** A 30 second recording captured on this device, so its blob is already held locally. */
async function localRecording(
  label: string,
  settings: { speed_percent?: number; pitch_cents?: number } = {},
): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { tuneId: null, recordedAt: '2026-09-14T20:00:00.000Z' })
  await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
  await finishCapture(db, id, {
    tuneId: null,
    mime: 'audio/mp4',
    durationMs: 30_000,
    recordedAt: '2026-09-14T20:00:00.000Z',
    peaks: null,
  })
  await updateRecording(db, id, { label, ...settings })
  vi.mocked(updateRecording).mockClear()
  return id
}

const presented = () => document.querySelector<HTMLElement>('ion-modal:not(.overlay-hidden)')

async function dialog() {
  await expect.poll(presented).not.toBeNull()
  return page.elementLocator(presented()!)
}

async function alertButton(name: string) {
  const alert = await vi.waitFor(() => {
    const open = document.querySelector<HTMLElement>('ion-alert:not(.overlay-hidden)')
    if (!open) throw new Error('The confirmation is not open')
    return open
  })
  return page.elementLocator(alert).getByRole('button', { name, exact: true })
}

/** A clock the test ticks by hand, so the engine reports a position only when told. */
function manualClock() {
  let tick = () => {}
  const clock: EngineClock = {
    every: (_ms, fn) => {
      tick = fn
      return () => {}
    },
    after: () => () => {},
  }
  return { clock, tick: () => tick() }
}

/** The recording screen opened on `label`, with its audio loaded. */
async function openScreen(label: string, engine: PlaybackEngine = fakePlaybackEngine()) {
  const load = vi.spyOn(engine, 'load')
  renderScreen(<RecordingsPage />, {
    db,
    path: '/recordings',
    route: '/recordings',
    playbackEngine: engine,
    recordingScreen: true,
    dock: true,
  })
  await page.getByRole('button', { name: `${EDIT_RECORDING} ${label}` }).click()
  await expect.poll(() => load.mock.calls.length).toBe(1)
  return { engine, load }
}

async function enterTrim() {
  await (await dialog()).getByRole('button', { name: new RegExp(`^${TRIM}`) }).click()
  await expect.element((await dialog()).getByRole('slider', { name: START_HANDLE })).toBeVisible()
}

/** The recording screen switched to the trim view once its audio loaded. */
async function openTrim(label: string, engine?: PlaybackEngine) {
  const opened = await openScreen(label, engine)
  await enterTrim()
  return opened.engine
}

/** Back on the recording view: its scrubber shows and the trim view's handles are gone. */
async function expectRecordingView() {
  await expect.element((await dialog()).getByRole('slider', { name: SEEK_LABEL })).toBeVisible()
  expect(page.getByRole('slider', { name: START_HANDLE }).elements()).toHaveLength(0)
}

async function handle(name: string) {
  return (await dialog()).getByRole('slider', { name })
}

async function focusHandle(name: string) {
  ;((await handle(name)).element() as HTMLElement).focus()
}

/** The zoomed-in waveform, which is pointer-only and so outside the accessibility tree. */
function detailWaveform(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-trim-detail] [role="slider"]')!
}

function pointer(target: Element, type: string, pointerId: number, clientX: number) {
  const rect = target.getBoundingClientRect()
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerId,
      isPrimary: pointerId === 1,
      clientX,
      clientY: rect.top + rect.height / 2,
    }),
  )
}

/** A key pressed with focus on nothing in particular. */
function press(key: string) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

describe('TrimView', () => {
  it('Save is disabled until a handle moves', async () => {
    await localRecording('Jam recording')
    await openTrim('Jam recording')
    const save = (await dialog()).getByRole('button', { name: SAVE_TRIM })
    await expect.element(save).toBeDisabled()
    await focusHandle(END_HANDLE)
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(save).toBeEnabled()
  })

  it('Set start at the playhead then Save writes one trim after confirming', async () => {
    const id = await localRecording('Jam recording', { speed_percent: 75 })
    const element = new FakeAudioElement()
    const engine = await openTrim(
      'Jam recording',
      fakePlaybackEngine(element as unknown as HTMLAudioElement),
    )
    engine.pause()
    engine.seek(5000)
    await (await dialog()).getByRole('button', { name: SET_START }).click()
    await expect.element(await handle(START_HANDLE)).toHaveAttribute('aria-valuenow', '5000')
    await (await dialog()).getByRole('button', { name: SAVE_TRIM }).click()
    await expect.element(page.getByText(TRIM_CONFIRM_TITLE(25_000))).toBeVisible()
    expect(TRIM_CONFIRM_TITLE(25_000)).toBe('Trim to 0:25?')
    await expect.element(page.getByText(TRIM_CONFIRM_MESSAGE)).toBeVisible()
    await (await alertButton(TRIM_CONFIRM_ACTION)).click()

    await expect.poll(() => vi.mocked(updateRecording).mock.calls.length).toBe(1)
    expect(vi.mocked(updateRecording).mock.calls[0]!.slice(1)).toEqual([
      id,
      { trim_start_ms: 5000, trim_end_ms: null },
    ])
    const entries = await db.outbox.where({ table: 'recordings', row_id: id }).toArray()
    expect(entries).toHaveLength(1)
    await expectRecordingView()
    // The recording's own speed plays again once the trim is saved.
    await expect.poll(() => element.playbackRate).toBe(0.75)
    expect(page.getByText(TRIM_CHANGED_ELSEWHERE).elements()).toHaveLength(0)
  })

  it('Cancel on the confirmation writes nothing', async () => {
    await localRecording('Jam recording')
    await openTrim('Jam recording')
    await focusHandle(START_HANDLE)
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await (await dialog()).getByRole('button', { name: SAVE_TRIM }).click()
    await (await alertButton(CANCEL)).click()
    await expect.poll(() => document.querySelector('ion-alert:not(.overlay-hidden)')).toBeNull()
    await expect.element(await handle(START_HANDLE)).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
  })

  it('Cancel in the header returns with no write', async () => {
    await localRecording('Jam recording')
    await openTrim('Jam recording')
    await focusHandle(START_HANDLE)
    await userEvent.keyboard('{ArrowRight}')
    await (await dialog()).getByRole('button', { name: CANCEL }).click()
    await expectRecordingView()
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
  })

  it('gives way to a trim made elsewhere while open, and writes nothing', async () => {
    const id = await localRecording('Jam recording')
    await openTrim('Jam recording')
    await focusHandle(START_HANDLE)
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await db.recordings.update(id, { trim_start_ms: 3000 })
    await expectRecordingView()
    await expect.element((await dialog()).getByText(TRIM_CHANGED_ELSEWHERE)).toBeVisible()
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
  })

  it('the trim view plays at 100% and restores speed on close', async () => {
    await localRecording('Jam recording', { speed_percent: 75, pitch_cents: 200 })
    const element = new FakeAudioElement()
    const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
    await openScreen('Jam recording', engine)
    expect(element.playbackRate).toBe(0.75)

    await enterTrim()
    await expect.poll(() => element.playbackRate).toBe(1)
    expect(engine.pitchCents).toBe(0)

    await (await dialog()).getByRole('button', { name: CANCEL }).click()
    await expect.poll(() => element.playbackRate).toBe(0.75)
    expect(engine.pitchCents).toBe(200)
    await expect
      .element((await dialog()).getByRole('button', { name: `${PRACTICE}, 75% · +2`, exact: true }))
      .toBeVisible()
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
  })

  it('restores speed and pitch when the whole screen closes from the trim view', async () => {
    await localRecording('Jam recording', { speed_percent: 75, pitch_cents: 200 })
    const element = new FakeAudioElement()
    const engine = await openTrim(
      'Jam recording',
      fakePlaybackEngine(element as unknown as HTMLAudioElement),
    )
    await expect.poll(() => element.playbackRate).toBe(1)
    await userEvent.keyboard('{Escape}')
    await expect.poll(presented).toBeNull()
    expect(element.playbackRate).toBe(0.75)
    expect(engine.pitchCents).toBe(200)
  })

  it("lets the dock follow the row's speed again once the screen closes", async () => {
    const id = await localRecording('Jam recording', { speed_percent: 75 })
    const element = new FakeAudioElement()
    await openTrim('Jam recording', fakePlaybackEngine(element as unknown as HTMLAudioElement))
    await expect.poll(() => element.playbackRate).toBe(1)
    await userEvent.keyboard('{Escape}')
    await expect.poll(presented).toBeNull()

    await updateRecording(db, id, { speed_percent: 120 })
    await expect.poll(() => element.playbackRate).toBe(1.2)
  })

  it("lets the dock load a recording at its row's settings after the player moves on", async () => {
    await localRecording('Jam recording', { speed_percent: 75, pitch_cents: 200 })
    const other = await localRecording('Other recording')
    let player: ReturnType<typeof usePlayer> | null = null
    function Grab() {
      player = usePlayer()
      return null
    }
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    renderScreen(
      <>
        <RecordingsPage />
        <Grab />
      </>,
      {
        db,
        path: '/recordings',
        route: '/recordings',
        playbackEngine: engine,
        recordingScreen: true,
        dock: true,
      },
    )
    await page.getByRole('button', { name: `${EDIT_RECORDING} Jam recording` }).click()
    await expect.poll(() => load.mock.calls.length).toBe(1)
    const jam = player!.item!
    await enterTrim()

    player!.play({ kind: 'recording', id: other })
    await expect.poll(presented).toBeNull()
    await expect.poll(() => load.mock.calls.length).toBe(2)
    player!.play(jam)
    await expect.poll(() => load.mock.calls.length).toBe(3)
    expect(load.mock.calls[2]![2]).toEqual({ speedPercent: 75, pitchCents: 200 })
  })

  it('the dock reloads at the trim view’s 100% when the audio changes under it', async () => {
    const id = await localRecording('Jam recording', { speed_percent: 75 })
    const { load } = await openScreen('Jam recording')
    await enterTrim()
    await db.recording_files.update(id, { blob: new Blob(['xyz']), blob_rev: 'bbbb2222' })
    await expect.poll(() => load.mock.calls.length).toBe(2)
    expect(load.mock.calls[1]![2]).toEqual({ speedPercent: 100, pitchCents: 0 })
  })

  it('keyboard nudges move the focused handle', async () => {
    await localRecording('Jam recording')
    await openTrim('Jam recording')
    const start = await handle(START_HANDLE)
    await focusHandle(START_HANDLE)
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(start).toHaveAttribute('aria-valuenow', '100')
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await expect.element(start).toHaveAttribute('aria-valuenow', '1100')
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(start).toHaveAttribute('aria-valuenow', '1000')
    await expect.element(start).toHaveAttribute('aria-valuetext', '0:01.0')
    await userEvent.keyboard('{PageUp}')
    await expect.element(start).toHaveAttribute('aria-valuenow', '2000')

    const end = await handle(END_HANDLE)
    await focusHandle(END_HANDLE)
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(end).toHaveAttribute('aria-valuenow', '29900')
  })

  it('sets the end at the playhead with ] and the start with [', async () => {
    await localRecording('Jam recording')
    const engine = await openTrim('Jam recording')
    engine.pause()
    engine.seek(20_000)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))
    await expect.element(await handle(END_HANDLE)).toHaveAttribute('aria-valuenow', '20000')
    engine.seek(4000)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
    await expect.element(await handle(START_HANDLE)).toHaveAttribute('aria-valuenow', '4000')
  })

  it('plays the selection and stops within half a tick of the end handle', async () => {
    await localRecording('Jam recording')
    const element = new FakeAudioElement()
    const { clock, tick } = manualClock()
    const engine = await openTrim(
      'Jam recording',
      new PlaybackEngine(element as unknown as HTMLAudioElement, clock),
    )
    engine.pause()
    await focusHandle(END_HANDLE)
    for (let i = 0; i < 10; i++) await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    await expect.element(await handle(END_HANDLE)).toHaveAttribute('aria-valuenow', '20000')

    await (await dialog()).getByRole('button', { name: PLAY_SELECTION }).click()
    expect(engine.getState().playing).toBe(true)
    expect(engine.getState().positionMs).toBe(0)
    // The fake element never advances on its own, so the test moves it along.
    element.currentTime = 19.97
    tick()
    expect(engine.getState().playing).toBe(true)
    element.currentTime = 19.98
    tick()
    expect(engine.getState().playing).toBe(false)
    expect(engine.getState().positionMs).toBe(20_000)
  })

  it('Space plays the selection and stops on the end handle; arrows never skip', async () => {
    await localRecording('Jam recording')
    const element = new FakeAudioElement()
    const { clock, tick } = manualClock()
    const engine = await openTrim(
      'Jam recording',
      new PlaybackEngine(element as unknown as HTMLAudioElement, clock),
    )
    engine.pause()
    await focusHandle(END_HANDLE)
    for (let i = 0; i < 10; i++) await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    await expect.element(await handle(END_HANDLE)).toHaveAttribute('aria-valuenow', '20000')
    ;(document.activeElement as HTMLElement | null)?.blur()
    engine.seek(5000)

    press('ArrowRight')
    expect(engine.getState().positionMs).toBe(5000)
    press('ArrowLeft')
    expect(engine.getState().positionMs).toBe(5000)
    await expect.element(await handle(END_HANDLE)).toHaveAttribute('aria-valuenow', '20000')

    press(' ')
    expect(engine.getState().playing).toBe(true)
    expect(engine.getState().positionMs).toBe(0)
    element.currentTime = 19.98
    tick()
    expect(engine.getState().playing).toBe(false)
    expect(engine.getState().positionMs).toBe(20_000)

    press(' ')
    expect(engine.getState().playing).toBe(true)
    press(' ')
    expect(engine.getState().playing).toBe(false)
  })

  it('previews the last three seconds and stays on an end handle at the range end', async () => {
    await localRecording('Jam recording')
    const element = new FakeAudioElement()
    const { clock, tick } = manualClock()
    const engine = await openTrim(
      'Jam recording',
      new PlaybackEngine(element as unknown as HTMLAudioElement, clock),
    )
    engine.pause()
    await (await dialog()).getByRole('button', { name: PREVIEW_END }).click()
    expect(engine.getState().playing).toBe(true)
    expect(engine.getState().positionMs).toBe(27_000)

    // One tick runs from short of the handle straight past the range end.
    element.currentTime = 30
    tick()
    expect(engine.getState().playing).toBe(false)
    expect(engine.getState().positionMs).toBe(29_999)
    tick()
    expect(engine.getState().positionMs).toBe(29_999)
  })

  it('a pause during a preview leaves Go to start on the start', async () => {
    await localRecording('Jam recording')
    const element = new FakeAudioElement()
    const { clock } = manualClock()
    const engine = await openTrim(
      'Jam recording',
      new PlaybackEngine(element as unknown as HTMLAudioElement, clock),
    )
    engine.pause()
    await (await dialog()).getByRole('button', { name: PREVIEW_END }).click()
    await (await dialog()).getByRole('button', { name: PAUSE }).click()
    expect(engine.getState().playing).toBe(false)
    await (await dialog()).getByRole('button', { name: GO_TO_START }).click()
    expect(engine.getState().positionMs).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(engine.getState().positionMs).toBe(0)
  })

  it('closes a Save confirmation when a trim made elsewhere closes the view', async () => {
    const id = await localRecording('Jam recording')
    await openTrim('Jam recording')
    await focusHandle(START_HANDLE)
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await (await dialog()).getByRole('button', { name: SAVE_TRIM }).click()
    await expect.element(await alertButton(TRIM_CONFIRM_ACTION)).toBeVisible()
    await db.recordings.update(id, { trim_start_ms: 3000 })
    await expectRecordingView()
    await expect.poll(() => document.querySelector('ion-alert:not(.overlay-hidden)')).toBeNull()
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
  })

  it('lets go of the detail after a handle is dragged past its edge', async () => {
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {})
    await localRecording('Jam recording')
    await openTrim('Jam recording')
    // The detail opens on ten seconds around the start handle, the first third of the range.
    await expect.poll(() => detailWaveform().getAttribute('aria-valuemax')).toBe('10000')
    const grip = document.querySelector<HTMLElement>('[data-trim-detail] [data-handle="start"]')!
    const edge = detailWaveform().getBoundingClientRect().right
    pointer(grip, 'pointerdown', 1, grip.getBoundingClientRect().left)
    pointer(grip, 'pointermove', 1, edge + 200)
    // The drag stops at the edge of what the detail shows.
    await expect.element(await handle(START_HANDLE)).toHaveAttribute('aria-valuenow', '10000')
    pointer(document.body, 'pointerup', 1, edge + 200)

    await (await dialog()).getByRole('button', { name: ZOOM_IN }).click()
    await expect.poll(() => detailWaveform().getAttribute('aria-valuemax')).toBe('5000')
  })

  it('a pointer that lost its capture without a pointerup never starts a pinch', async () => {
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {})
    await localRecording('Jam recording')
    const engine = await openTrim('Jam recording')
    engine.pause()
    engine.seek(2000)
    const bars = detailWaveform()
    const { left, width } = bars.getBoundingClientRect()
    pointer(bars, 'pointerdown', 1, left + width * 0.2)
    pointer(bars, 'lostpointercapture', 1, left + width * 0.2)

    // A new single touch still seeks rather than being taken for a second finger.
    pointer(bars, 'pointerdown', 2, left + width * 0.5)
    expect(engine.getState().positionMs).toBeGreaterThan(4000)
    pointer(bars, 'pointerup', 2, left + width * 0.5)
  })

  it('a second finger turns the first one’s seek and drag into a pinch', async () => {
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {})
    await localRecording('Jam recording')
    const engine = await openTrim('Jam recording')
    engine.pause()
    engine.seek(2000)
    await expect.poll(() => detailWaveform().getAttribute('aria-valuemax')).toBe('10000')
    const bars = detailWaveform()
    const { left, width } = bars.getBoundingClientRect()

    pointer(bars, 'pointerdown', 1, left + width * 0.9)
    expect(engine.getState().positionMs).not.toBe(2000)
    pointer(bars, 'pointerdown', 2, left + width * 0.5)
    expect(engine.getState().positionMs).toBe(2000)
    pointer(bars, 'pointermove', 2, left + width * 0.1)
    pointer(bars, 'pointermove', 1, left + width * 0.9)
    expect(engine.getState().positionMs).toBe(2000)
    await expect.poll(() => detailWaveform().getAttribute('aria-valuemax')).toBe('5000')
    await expect.element(await handle(START_HANDLE)).toHaveAttribute('aria-valuenow', '0')
    pointer(bars, 'pointerup', 2, left + width * 0.1)
    pointer(bars, 'pointerup', 1, left + width * 0.9)
  })
})
