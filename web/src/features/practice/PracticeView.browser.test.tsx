import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import {
  appendChunk,
  beginCapture,
  finishCapture,
  updateRecording,
} from '../../commands/recordings'
import type * as RecordingCommands from '../../commands/recordings'
import { newId } from '../../commands/write'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecording } from '../../db/types'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { renderIonic, renderScreen } from '../../test/ionic'
import { fakeEngine, FakeAudioElement, fakePlaybackEngine, realClock } from '../../test/providers'
import { recordingRow } from '../../test/rows'
import { PAUSE } from '../player/Dock'
import type { PlaybackEngine } from '../player/playbackEngine'
import { PITCH, PITCH_DOWN, PITCH_UP } from '../recording-screen/PitchPanel'
import { TRIM_WHILE_DOWNLOADING } from '../recording-screen/RecordingScreen'
import { FASTER, SLOWER, SPEED } from '../recording-screen/SpeedPanel'
import { SKIP_MS } from '../recording-screen/Transport'
import { EDIT_RECORDING, useRecordingScreen } from '../recording-screen/useRecordingScreen'
import { SEEK_LABEL } from '../recording-screen/Waveform'
import { RecordingsPage } from '../recordings/RecordingsPage'
import {
  PITCH_NOT_SAVED,
  PRACTICE_BADGE,
  PRACTICE_BADGE_LABEL,
  SPEED_NOT_SAVED,
} from './PracticeView'
import { BACK, PRACTICE } from './practiceCopy'

vi.mock('../../commands/recordings', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

/** A recording captured on this device, so its blob is already held locally. */
async function localRecording(label: string, extra: Partial<LocalRecording> = {}) {
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
  await updateRecording(db, id, { label, ...extra })
  vi.mocked(updateRecording).mockClear()
  return id
}

const presented = () => document.querySelector<HTMLElement>('ion-modal:not(.overlay-hidden)')

/** The shown modal. Its contents are slotted into, not under, the role its shadow root holds. */
async function dialog() {
  await expect.poll(presented).not.toBeNull()
  return page.elementLocator(presented()!)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const never = new Promise<never>(() => {})

/** A key pressed with focus on nothing in particular. */
function press(key: string, init: KeyboardEventInit = {}) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

/** The Recordings tab with the dock and the screen, opened through a row's Edit, then Practice. */
async function openPractice(
  label: string,
  {
    syncEngine,
    engine = fakePlaybackEngine(),
  }: { syncEngine?: SyncEngine; engine?: PlaybackEngine } = {},
) {
  const load = vi.spyOn(engine, 'load')
  renderScreen(<RecordingsPage />, {
    db,
    engine: syncEngine,
    path: '/recordings',
    route: '/recordings',
    playbackEngine: engine,
    recordingScreen: true,
    dock: true,
  })
  await page.getByRole('button', { name: `${EDIT_RECORDING} ${label}` }).click()
  await (await dialog()).getByRole('button', { name: PRACTICE }).click()
  return { engine, load }
}

/** The screen opened on `id` straight into Practice, as a caller of `open` asks for it. */
async function openStraightIntoPractice(
  id: string,
  {
    syncEngine,
    engine = fakePlaybackEngine(),
  }: { syncEngine?: SyncEngine; engine?: PlaybackEngine } = {},
) {
  const load = vi.spyOn(engine, 'load')
  function Opener() {
    const { open } = useRecordingScreen()
    return (
      <button type="button" onClick={() => open(id, 'practice')}>
        Open in Practice
      </button>
    )
  }
  renderIonic(<Opener />, {
    db,
    engine: syncEngine,
    playbackEngine: engine,
    recordingScreen: true,
    dock: true,
  })
  await page.getByRole('button', { name: 'Open in Practice' }).click()
  return { engine, load }
}

async function practiceHeading() {
  return (await dialog()).getByRole('heading', { name: PRACTICE })
}

async function expectRecordingView() {
  await expect.element((await dialog()).getByRole('slider', { name: SEEK_LABEL })).toBeVisible()
}

interface BackRegistration {
  priority: number
  handler: (next?: () => void) => void
}

/** Fires Ionic's back-button event and runs the handler that asked with the highest priority. */
function pressHardwareBack() {
  const registered: BackRegistration[] = []
  document.dispatchEvent(
    new CustomEvent('ionBackButton', {
      bubbles: true,
      detail: {
        register: (priority: number, handler: (next?: () => void) => void) =>
          registered.push({ priority, handler }),
      },
    }),
  )
  registered.sort((a, b) => b.priority - a.priority)[0]?.handler()
}

describe('PracticeView', () => {
  it('opens straight into Practice when asked to', async () => {
    const id = await localRecording('Jam recording')
    const { load } = await openStraightIntoPractice(id)
    await expect.element(await practiceHeading()).toBeVisible()
    await expect.element((await dialog()).getByRole('button', { name: BACK })).toBeVisible()
    await expect.element((await dialog()).getByText('Jam recording')).toBeVisible()
    await expect.poll(() => load.mock.calls.length).toBe(1)
  })

  it('goes back to the recording view and puts focus on Practice', async () => {
    await localRecording('Jam recording')
    await openPractice('Jam recording')
    await expect
      .poll(() => document.activeElement?.shadowRoot?.activeElement?.getAttribute('aria-label'))
      .toBe(BACK)
    await (await dialog()).getByRole('button', { name: BACK }).click()
    await expectRecordingView()
    await expect
      .poll(() => (document.activeElement as HTMLElement | null)?.dataset.tool)
      .toBe('practice')
  })

  it('leaves Practice on Escape and keeps the screen open', async () => {
    await localRecording('Jam recording')
    await openPractice('Jam recording')
    await expect.element(await practiceHeading()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expectRecordingView()
    await wait(300)
    expect(presented()).not.toBeNull()
  })

  it("leaves Practice on the phone's back button and keeps the screen open", async () => {
    await localRecording('Jam recording')
    await openPractice('Jam recording')
    await expect.element(await practiceHeading()).toBeVisible()
    pressHardwareBack()
    await expectRecordingView()
    await wait(300)
    expect(presented()).not.toBeNull()
  })

  it('holds the transport, and plays, pauses, and skips with the keys', async () => {
    await localRecording('Jam recording')
    const { engine, load } = await openPractice('Jam recording')
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await expect.poll(() => engine.getState().playing).toBe(true)
    await expect.element((await dialog()).getByRole('button', { name: PAUSE })).toBeVisible()
    ;(document.activeElement as HTMLElement | null)?.blur()
    press(' ')
    await expect.poll(() => engine.getState().playing).toBe(false)
    engine.seek(10_000)
    press('ArrowRight')
    expect(engine.getState().positionMs).toBe(10_000 + SKIP_MS)
  })

  it('steps speed by 5% and pitch by a semitone, and expands the full panel', async () => {
    await localRecording('Jam recording')
    const element = new FakeAudioElement()
    const { engine } = await openPractice('Jam recording', {
      engine: fakePlaybackEngine(element as unknown as HTMLAudioElement),
    })
    const screen = await dialog()
    await screen.getByRole('button', { name: SLOWER }).click()
    expect(element.playbackRate).toBe(0.95)
    await screen.getByRole('button', { name: PITCH_DOWN }).click()
    expect(engine.pitchCents).toBe(-100)
    const speed = screen.getByRole('button', { name: `${SPEED} 95%` })
    await expect.element(speed).toHaveAttribute('aria-expanded', 'false')
    await speed.click()
    await expect.element(speed).toHaveAttribute('aria-expanded', 'true')
    await screen.getByRole('button', { name: '75%' }).click()
    expect(element.playbackRate).toBe(0.75)
    const changed = screen.getByRole('button', { name: `${SPEED} 75%` })
    await changed.click()
    await expect.element(changed).toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByRole('button', { name: '75%' })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: `${PITCH} -1` })).toBeVisible()
  })

  it('lays the steppers beside the lanes on the wide frame', async () => {
    await page.viewport(1024, 768)
    try {
      await localRecording('Jam recording')
      await openPractice('Jam recording')
      await expect.element(await practiceHeading()).toBeVisible()
      const lanes = await vi.waitFor(() => {
        const found = presented()?.querySelector('[data-practice-lanes]')
        if (!found) throw new Error('No lanes')
        return found.getBoundingClientRect()
      })
      const loops = presented()!.querySelector('[data-practice-loops]')!.getBoundingClientRect()
      expect(loops.left).toBeGreaterThan(lanes.right - 1)
      // The sheet grows past Ionic's 600 px dialog to give the lanes room.
      const sheet = presented()!.shadowRoot!.querySelector('.modal-wrapper')!
      await expect.poll(() => sheet.getBoundingClientRect().width).toBeCloseTo(1024 * 0.92, 0)
      await expect.poll(() => sheet.getBoundingClientRect().height).toBeCloseTo(768 * 0.9, 0)
      // The lanes' zoomed waveform is taller on the wide frame.
      const detail = () =>
        presented()?.querySelector('[data-practice-lanes] canvas.practice-detail') ?? null
      await expect.poll(() => detail()?.getBoundingClientRect().height).toBe(150)
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('stacks lanes, transport, steppers, then loops on a phone', async () => {
    await localRecording('Jam recording')
    await openPractice('Jam recording')
    const screen = await dialog()
    await expect.element(await practiceHeading()).toBeVisible()
    const top = (selector: string) =>
      presented()!.querySelector(selector)!.getBoundingClientRect().top
    const transport = (
      screen.getByRole('button', { name: PAUSE }).element() as HTMLElement
    ).getBoundingClientRect().top
    const steppers = (
      screen.getByRole('button', { name: `${SPEED} 100%` }).element() as HTMLElement
    ).getBoundingClientRect().top
    expect(top('[data-practice-lanes]')).toBeLessThan(transport)
    expect(transport).toBeLessThan(steppers)
    expect(steppers).toBeLessThan(top('[data-practice-loops]'))
  })

  it('opens on the recording view while the audio is still downloading', async () => {
    await db.recordings.put(
      recordingRow('r1', {
        label: 'Remote take',
        state: 'ready',
        duration_ms: 9000,
        source_duration_ms: 9000,
        playback_start_ms: 0,
        playback_end_ms: 9000,
      }),
    )
    await openStraightIntoPractice('r1', { syncEngine: fakeEngine({ download: () => never }) })
    const practice = (await dialog()).getByRole('button', { name: new RegExp(`^${PRACTICE}`) })
    await expect.element(practice).toHaveAttribute('aria-disabled', 'true')
    await expect.element(practice).toHaveTextContent(TRIM_WHILE_DOWNLOADING)
    expect((await dialog()).getByRole('heading', { name: PRACTICE }).elements()).toHaveLength(0)
  })

  it('changing speed plays faster at once and writes one outbox entry', async () => {
    const id = await localRecording('Jam recording')
    const element = new FakeAudioElement()
    const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
    const { load } = await openPractice('Jam recording', { engine })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    engine.seek(10_000)
    const src = element.src

    await (await dialog()).getByRole('button', { name: `${SPEED} 100%` }).click()
    await (await dialog()).getByRole('button', { name: '75%' }).click()
    expect(element.playbackRate).toBe(0.75)
    await (await dialog()).getByRole('button', { name: FASTER }).click()
    await (await dialog()).getByRole('button', { name: FASTER }).click()
    expect(element.playbackRate).toBe(0.85)
    await expect
      .element((await dialog()).getByRole('button', { name: `${SPEED} 85%` }))
      .toBeVisible()
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()

    await expect.poll(() => vi.mocked(updateRecording).mock.calls.length, { timeout: 3000 }).toBe(1)
    expect(vi.mocked(updateRecording).mock.calls[0]!.slice(1)).toEqual([id, { speed_percent: 85 }])
    const entries = await db.outbox.where({ table: 'recordings', row_id: id }).toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.data).toMatchObject({ speed_percent: 85 })

    // The dock sees the row change and applies the same speed, which neither reloads nor moves.
    await expect
      .poll(async () => (await db.recordings.get(id))?.speed_percent, { timeout: 3000 })
      .toBe(85)
    await wait(100)
    expect(load).toHaveBeenCalledOnce()
    expect(element.src).toBe(src)
    expect(element.playbackRate).toBe(0.85)
    expect(engine.getState().positionMs).toBe(10_000)
  })

  it('writes a pitch change still settling when Practice closes', async () => {
    const id = await localRecording('Jam recording')
    await openPractice('Jam recording')
    await (await dialog()).getByRole('button', { name: `${PITCH} 0` }).click()
    await (await dialog()).getByRole('button', { name: PITCH_UP }).click()
    await (await dialog()).getByRole('button', { name: BACK }).click()
    await expect
      .poll(async () => (await db.recordings.get(id))?.pitch_cents, { timeout: 3000 })
      .toBe(100)
    expect(vi.mocked(updateRecording)).toHaveBeenCalledOnce()
  })

  it("keeps a live pitch when the speed's write lands", async () => {
    const id = await localRecording('Jam recording')
    const { engine, load } = await openPractice('Jam recording')
    await expect.poll(() => load.mock.calls.length).toBe(1)
    const screen = await dialog()
    await screen.getByRole('button', { name: `${SPEED} 100%` }).click()
    await screen.getByRole('button', { name: '75%' }).click()
    await wait(400)
    await screen.getByRole('button', { name: `${PITCH} 0` }).click()
    await screen.getByRole('button', { name: PITCH_UP }).click()
    expect(engine.pitchCents).toBe(100)
    await expect
      .poll(async () => (await db.recordings.get(id))?.speed_percent, { timeout: 3000 })
      .toBe(75)
    await wait(150)
    expect((await db.recordings.get(id))?.pitch_cents).toBe(0)
    expect(engine.pitchCents).toBe(100)
    await expect
      .poll(async () => (await db.recordings.get(id))?.pitch_cents, { timeout: 3000 })
      .toBe(100)
  })

  it('keeps a newer speed when the write of an older one lands', async () => {
    const id = await localRecording('Jam recording')
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
    const { engine, load } = await openPractice('Jam recording', {
      engine: fakePlaybackEngine(element as unknown as HTMLAudioElement),
    })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    const screen = await dialog()
    await screen.getByRole('button', { name: `${SPEED} 100%` }).click()
    await screen.getByRole('button', { name: '75%' }).click()
    await expect.poll(() => vi.mocked(updateRecording).mock.calls.length, { timeout: 3000 }).toBe(1)
    await screen.getByRole('button', { name: FASTER }).click()
    expect(element.playbackRate).toBe(0.8)
    const setSpeed = vi.spyOn(engine, 'setSpeed')
    release()
    await expect
      .poll(async () => (await db.recordings.get(id))?.speed_percent, { timeout: 3000 })
      .toBe(75)
    await wait(100)
    // The older value landing never reaches the engine, so what plays matches what shows.
    expect(setSpeed.mock.calls.map(([percent]) => percent)).not.toContain(75)
    expect(element.playbackRate).toBe(0.8)
    await expect.element(screen.getByRole('button', { name: `${SPEED} 80%` })).toBeVisible()
    await expect
      .poll(async () => (await db.recordings.get(id))?.speed_percent, { timeout: 3000 })
      .toBe(80)
    expect(element.playbackRate).toBe(0.8)
  })

  /** Holds each of the next `count` `updateRecording` calls until its own gate opens. */
  async function gatedWrites(count: number) {
    const actual = await vi.importActual<typeof RecordingCommands>('../../commands/recordings')
    const gates: (() => void)[] = []
    for (let i = 0; i < count; i++) {
      vi.mocked(updateRecording).mockImplementationOnce(async (...args) => {
        await new Promise<void>((resolve) => gates.push(resolve))
        return actual.updateRecording(...args)
      })
    }
    return gates
  }

  it('shows the speed it left behind on the recording view while its write lands', async () => {
    const id = await localRecording('Jam recording')
    const gates = await gatedWrites(1)
    const { load } = await openPractice('Jam recording')
    await expect.poll(() => load.mock.calls.length).toBe(1)
    const screen = await dialog()
    await screen.getByRole('button', { name: `${SPEED} 100%` }).click()
    await screen.getByRole('button', { name: '75%' }).click()
    await screen.getByRole('button', { name: BACK }).click()
    const badge = screen.getByRole('button', {
      name: PRACTICE_BADGE_LABEL(PRACTICE_BADGE(75, 0)!),
    })
    await expect.element(badge).toBeVisible()
    await expect.poll(() => gates.length).toBe(1)
    gates[0]!()
    await expect.poll(async () => (await db.recordings.get(id))?.speed_percent).toBe(75)
    await expect.element(badge).toBeVisible()
  })

  it('never plays an older speed landing after Practice has closed', async () => {
    const id = await localRecording('Jam recording')
    const gates = await gatedWrites(2)
    const element = new FakeAudioElement()
    const { engine, load } = await openPractice('Jam recording', {
      engine: fakePlaybackEngine(element as unknown as HTMLAudioElement),
    })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    const screen = await dialog()
    await screen.getByRole('button', { name: `${SPEED} 100%` }).click()
    await screen.getByRole('button', { name: '75%' }).click()
    await expect.poll(() => gates.length, { timeout: 3000 }).toBe(1)
    await screen.getByRole('button', { name: FASTER }).click()
    await screen.getByRole('button', { name: BACK }).click()
    await expect.poll(() => gates.length).toBe(2)
    const setSpeed = vi.spyOn(engine, 'setSpeed')
    gates[0]!()
    await expect.poll(async () => (await db.recordings.get(id))?.speed_percent).toBe(75)
    await wait(100)
    expect(setSpeed.mock.calls.map(([percent]) => percent)).not.toContain(75)
    expect(element.playbackRate).toBe(0.8)
    gates[1]!()
    await expect.poll(async () => (await db.recordings.get(id))?.speed_percent).toBe(80)
    expect(element.playbackRate).toBe(0.8)
  })

  it('adopts a speed from elsewhere that matches one it wrote before', async () => {
    const id = await localRecording('Jam recording')
    const actual = await vi.importActual<typeof RecordingCommands>('../../commands/recordings')
    await openPractice('Jam recording')
    const screen = await dialog()
    await screen.getByRole('button', { name: `${SPEED} 100%` }).click()
    await screen.getByRole('button', { name: '75%' }).click()
    await expect
      .poll(async () => (await db.recordings.get(id))?.speed_percent, { timeout: 3000 })
      .toBe(75)
    await actual.updateRecording(db, id, { speed_percent: 90 })
    await expect.element(screen.getByRole('button', { name: `${SPEED} 90%` })).toBeVisible()
    await actual.updateRecording(db, id, { speed_percent: 75 })
    await expect.element(screen.getByRole('button', { name: `${SPEED} 75%` })).toBeVisible()
  })

  it('adopts a pitch from elsewhere that matches one it wrote before', async () => {
    const id = await localRecording('Jam recording')
    const actual = await vi.importActual<typeof RecordingCommands>('../../commands/recordings')
    await openPractice('Jam recording')
    const screen = await dialog()
    await screen.getByRole('button', { name: `${PITCH} 0` }).click()
    await screen.getByRole('button', { name: PITCH_UP }).click()
    await expect
      .poll(async () => (await db.recordings.get(id))?.pitch_cents, { timeout: 3000 })
      .toBe(100)
    await actual.updateRecording(db, id, { pitch_cents: 300 })
    await expect.element(screen.getByRole('button', { name: `${PITCH} +3` })).toBeVisible()
    await actual.updateRecording(db, id, { pitch_cents: 100 })
    await expect.element(screen.getByRole('button', { name: `${PITCH} +1` })).toBeVisible()
  })

  it('reports a speed that could not be saved in Practice', async () => {
    await localRecording('Jam recording')
    vi.mocked(updateRecording).mockRejectedValueOnce(new Error('The disk is full'))
    await openPractice('Jam recording')
    const screen = await dialog()
    await screen.getByRole('button', { name: `${SPEED} 100%` }).click()
    await screen.getByRole('button', { name: '75%' }).click()
    await expect
      .element(screen.getByRole('alert'), { timeout: 3000 })
      .toHaveTextContent(SPEED_NOT_SAVED)
  })

  it('reports a pitch that could not be saved after Practice closed as a toast', async () => {
    await localRecording('Jam recording')
    vi.mocked(updateRecording).mockRejectedValueOnce(new Error('The disk is full'))
    await openPractice('Jam recording')
    const screen = await dialog()
    await screen.getByRole('button', { name: `${PITCH} 0` }).click()
    await screen.getByRole('button', { name: PITCH_UP }).click()
    await screen.getByRole('button', { name: BACK }).click()
    await expect.element(page.getByText(PITCH_NOT_SAVED), { timeout: 3000 }).toBeVisible()
  })

  it('drops the unsaved speed from the recording view when its write is refused after Back', async () => {
    await localRecording('Jam recording')
    let refuse: (error: Error) => void = () => {}
    vi.mocked(updateRecording).mockImplementationOnce(
      () =>
        new Promise<never>((_, reject) => {
          refuse = reject
        }),
    )
    // No playback ticks, so nothing but the hold changing can re-render the screen.
    const engine = fakePlaybackEngine(undefined, { ...realClock, every: () => () => {} })
    await openPractice('Jam recording', { engine })
    const screen = await dialog()
    await screen.getByRole('button', { name: `${SPEED} 100%` }).click()
    await screen.getByRole('button', { name: '75%' }).click()
    await screen.getByRole('button', { name: BACK }).click()
    const unsaved = screen.getByRole('button', {
      name: PRACTICE_BADGE_LABEL(PRACTICE_BADGE(75, 0)!),
    })
    await expect.element(unsaved).toBeVisible()
    await expect.poll(() => vi.mocked(updateRecording).mock.calls.length).toBe(1)
    refuse(new Error('The disk is full'))
    await expect.element(page.getByText(SPEED_NOT_SAVED), { timeout: 3000 }).toBeVisible()
    await expect.element(unsaved).not.toBeInTheDocument()
  })

  it('says nothing when the recording is gone before its write', async () => {
    await localRecording('Jam recording')
    vi.mocked(updateRecording).mockRejectedValueOnce(new Error(RECORDING_NOT_FOUND))
    await openPractice('Jam recording')
    const screen = await dialog()
    await screen.getByRole('button', { name: `${SPEED} 100%` }).click()
    await screen.getByRole('button', { name: '75%' }).click()
    await expect.poll(() => vi.mocked(updateRecording).mock.calls.length, { timeout: 3000 }).toBe(1)
    await wait(100)
    expect(screen.getByRole('alert').elements()).toHaveLength(0)
  })
})
