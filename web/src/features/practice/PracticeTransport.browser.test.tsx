import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { addLoop, updateLoop } from '../../commands/loops'
import { LOOP_LIMIT } from '../../commands/messages'
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
import { loopRow } from '../../test/rows'
import { SEEK_LABEL } from '../recording-screen/Waveform'
import { EDIT_RECORDING } from '../recording-screen/useRecordingScreen'
import { RecordingsPage } from '../recordings/RecordingsPage'
import { MIN_LOOP_MS } from './loopModel'
import {
  LOOP_CREATED,
  LOOP_START_MARKED,
  MARK_FACE,
  MARK_PENDING_FACE,
  REPEAT,
  REPEAT_NEEDS_LOOP,
} from './PracticeTransport'
import { MARK_LOOP, PRACTICE } from './practiceCopy'

vi.mock('../../commands/loops', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const LENGTH_MS = 180_000

/** A three-minute recording captured on this device, untrimmed, so source time is blob time. */
async function localRecording() {
  const id = newId()
  await beginCapture(db, id, { tuneId: null, recordedAt: '2026-09-14T20:00:00.000Z' })
  await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
  await finishCapture(db, id, {
    tuneId: null,
    mime: 'audio/mp4',
    durationMs: LENGTH_MS,
    recordedAt: '2026-09-14T20:00:00.000Z',
    peaks: null,
  })
  await updateRecording(db, id, { label: 'Jam recording' })
  return id
}

async function seedLoop(recordingId: string, startMs: number, endMs: number) {
  const id = newId()
  await db.recording_loops.put(
    loopRow({ id, recording_id: recordingId, start_ms: startMs, end_ms: endMs }),
  )
  return id
}

const presented = () => document.querySelector<HTMLElement>('ion-modal:not(.overlay-hidden)')

async function dialog() {
  await expect.poll(presented).not.toBeNull()
  return page.elementLocator(presented()!)
}

const lane = () => document.querySelector<HTMLElement>('[data-loop-lane]')
const band = () => lane()?.querySelector<HTMLElement>('[data-loop-draft]') ?? null
const announcer = () => document.querySelector<HTMLElement>('[data-practice-announcer]')
const markButton = () =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${MARK_LOOP}"]`)
const repeatButton = () =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${REPEAT}"]`)
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Practice opened on the recording and paused, with the element it plays exposed. */
async function openPractice({ strict = false }: { strict?: boolean } = {}) {
  const element = new FakeAudioElement()
  const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
  renderScreen(<RecordingsPage />, {
    db,
    path: '/recordings',
    route: '/recordings',
    playbackEngine: engine,
    recordingScreen: true,
    dock: true,
    strict,
  })
  await page.getByRole('button', { name: `${EDIT_RECORDING} Jam recording` }).click()
  await (await dialog()).getByRole('button', { name: PRACTICE }).click()
  await expect.poll(() => engine.getState().lengthMs).toBe(LENGTH_MS)
  await expect.poll(() => lane()?.dataset.pxPerS).toBeTruthy()
  engine.pause()
  /** Plays on to `ms` the way the element does, with no seek through the engine. */
  const playTo = async (ms: number) => {
    element.currentTime = ms / 1000
    await expect.poll(() => engine.getState().positionMs).toBe(ms)
  }
  return { engine, element, playTo }
}

/** Selects a loop by a tap on its bar in the lane. */
async function tapLoop(id: string) {
  const pill = () => document.querySelector<HTMLElement>(`[data-loop="${id}"]`)
  await expect.poll(pill).not.toBeNull()
  const rect = pill()!.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  for (const type of ['pointerdown', 'pointerup']) {
    lane()!.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
      }),
    )
  }
}

/** A key pressed with focus on nothing in particular. */
function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  )
}

async function liveLoops(recordingId: string) {
  return (await db.recording_loops.where('recording_id').equals(recordingId).toArray()).filter(
    (l) => !l.deleted_at,
  )
}

describe('PracticeTransport', () => {
  it('flanks the transport with A B and Repeat', async () => {
    await localRecording()
    await openPractice()
    const mark = markButton()!
    expect(mark.textContent).toBe(MARK_FACE)
    expect(mark.getAttribute('aria-pressed')).toBe('false')
    const repeat = repeatButton()!
    expect(repeat.disabled).toBe(true)
    expect(repeat.title).toBe(REPEAT_NEEDS_LOOP)
    expect(repeat.getAttribute('aria-pressed')).toBe('false')
  })

  it('marks a loop with A B, selects it, repeats it, and says so', async () => {
    const id = await localRecording()
    const { engine, playTo } = await openPractice()
    await playTo(2_000)
    markButton()!.click()
    await expect.poll(() => announcer()?.textContent).toBe(LOOP_START_MARKED)
    expect(markButton()!.textContent).toBe(MARK_PENDING_FACE)
    expect(markButton()!.getAttribute('aria-pressed')).toBe('true')
    await expect.poll(band).not.toBeNull()

    await wait(600)
    await playTo(5_000)
    markButton()!.click()

    await expect.poll(() => vi.mocked(addLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(addLoop).mock.calls[0]![2]).toEqual({ start_ms: 2_000, end_ms: 5_000 })
    const [created] = await liveLoops(id)
    await expect.poll(() => engine.getState().loop?.id).toBe(created!.id)
    expect(engine.getState().repeat).toBe(true)
    // Repeat on with the playhead at the loop's end starts it again from the top.
    await expect.poll(() => engine.getState().positionMs).toBe(2_000)
    await expect.poll(() => announcer()?.textContent).toBe(LOOP_CREATED)
    await expect.poll(() => repeatButton()?.getAttribute('aria-pressed')).toBe('true')
    expect(markButton()!.textContent).toBe(MARK_FACE)
    expect(markButton()!.getAttribute('aria-pressed')).toBe('false')
  })

  it('stretches a mark ended too soon after its start to half a second', async () => {
    await localRecording()
    const { playTo } = await openPractice()
    await playTo(4_000)
    markButton()!.click()
    await wait(600)
    markButton()!.click()
    await expect.poll(() => vi.mocked(addLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(addLoop).mock.calls[0]![2]).toEqual({
      start_ms: 4_000,
      end_ms: 4_000 + MIN_LOOP_MS,
    })
  })

  it('cancels the mark on a second tap within half a second', async () => {
    await localRecording()
    const { playTo } = await openPractice()
    await playTo(2_000)
    markButton()!.click()
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('true')
    markButton()!.click()
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('false')
    expect(band()).toBeNull()
    await wait(100)
    expect(addLoop).not.toHaveBeenCalled()
  })

  it('cancels the mark on a seek', async () => {
    await localRecording()
    const { engine, playTo } = await openPractice()
    await playTo(2_000)
    markButton()!.click()
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('true')
    engine.seek(20_000)
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('false')
    expect(band()).toBeNull()
  })

  it('cancels the mark on Escape, and the next Escape leaves Practice', async () => {
    await localRecording()
    const { playTo } = await openPractice()
    await playTo(2_000)
    markButton()!.click()
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('true')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('false')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(markButton()).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await expect.element((await dialog()).getByRole('slider', { name: SEEK_LABEL })).toBeVisible()
  })

  it('cancels the mark on Escape without leaving Practice under StrictMode', async () => {
    await localRecording()
    const { playTo } = await openPractice({ strict: true })
    await playTo(2_000)
    markButton()!.click()
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('true')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => markButton()?.getAttribute('aria-pressed')).toBe('false')
    await wait(100)
    expect(markButton()).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await expect.element((await dialog()).getByRole('slider', { name: SEEK_LABEL })).toBeVisible()
  })

  it('keeps focus off A B after a click, so Space plays rather than ending the mark', async () => {
    await localRecording()
    const { engine, playTo } = await openPractice()
    ;(document.activeElement as HTMLElement | null)?.blur()
    await playTo(2_000)
    await userEvent.click(markButton()!)
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).not.toBe(markButton())
    await wait(600)
    await userEvent.keyboard(' ')
    await expect.poll(() => engine.getState().playing).toBe(true)
    expect(markButton()!.getAttribute('aria-pressed')).toBe('true')
    expect(addLoop).not.toHaveBeenCalled()
  })

  it('says "Loop start marked" again for a mark after one cancelled', async () => {
    await localRecording()
    const { playTo } = await openPractice()
    const said: string[] = []
    const observer = new MutationObserver(() => said.push(announcer()!.textContent ?? ''))
    observer.observe(announcer()!, { childList: true, characterData: true, subtree: true })
    await playTo(2_000)
    markButton()!.click()
    await expect.poll(() => said.filter((t) => t === LOOP_START_MARKED)).toHaveLength(1)
    markButton()!.click()
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('false')
    markButton()!.click()
    await expect.poll(() => said.filter((t) => t === LOOP_START_MARKED)).toHaveLength(2)
    observer.disconnect()
  })

  it('disables A B with the reason once the recording has 100 loops', async () => {
    const id = await localRecording()
    await db.recording_loops.bulkPut(
      Array.from({ length: 100 }, (_, i) =>
        loopRow({
          id: newId(),
          recording_id: id,
          start_ms: 60_000 + i * 1_000,
          end_ms: 60_500 + i * 1_000,
        }),
      ),
    )
    await openPractice()
    await expect.poll(() => markButton()?.disabled).toBe(true)
    expect(markButton()!.title).toBe(LOOP_LIMIT)
  })

  it('toggles Repeat on the selected loop with aria-pressed', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    const { engine } = await openPractice()
    await tapLoop(loop)
    await expect.poll(() => repeatButton()?.disabled).toBe(false)
    expect(repeatButton()!.hasAttribute('title')).toBe(false)
    repeatButton()!.click()
    await expect.poll(() => repeatButton()!.getAttribute('aria-pressed')).toBe('true')
    expect(engine.getState().repeat).toBe(true)
    repeatButton()!.click()
    await expect.poll(() => repeatButton()!.getAttribute('aria-pressed')).toBe('false')
    expect(engine.getState().repeat).toBe(false)
  })

  it('turns Repeat off when a sync tombstones the repeating loop', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    await openPractice()
    await tapLoop(loop)
    await expect.poll(() => repeatButton()?.disabled).toBe(false)
    repeatButton()!.click()
    await expect.poll(() => repeatButton()!.getAttribute('aria-pressed')).toBe('true')

    await db.recording_loops.update(loop, { deleted_at: '2026-10-01T00:00:00.000Z' })
    await expect.poll(() => repeatButton()!.getAttribute('aria-pressed')).toBe('false')
    expect(repeatButton()!.disabled).toBe(true)
  })

  it('toggles Repeat with R', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    const { engine } = await openPractice()
    press('r')
    expect(engine.getState().repeat).toBe(false)
    await tapLoop(loop)
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)
    press('r')
    expect(engine.getState().repeat).toBe(true)
    press('R')
    expect(engine.getState().repeat).toBe(false)
  })

  it('sets the selected loop’s start and end at the playhead with [ and ]', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    const { engine, playTo } = await openPractice()
    await tapLoop(loop)
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)
    await playTo(3_000)
    press('[')
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(updateLoop).mock.calls[0]![2]).toEqual({ start_ms: 3_000 })
    await expect.poll(async () => (await db.recording_loops.get(loop))?.start_ms).toBe(3_000)

    // An end too near the start stops half a second past it.
    await playTo(3_200)
    press(']')
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(2)
    expect(vi.mocked(updateLoop).mock.calls[1]![2]).toEqual({ end_ms: 3_000 + MIN_LOOP_MS })
  })

  it('marks a loop with [ then ] when nothing is selected', async () => {
    const id = await localRecording()
    const { engine, playTo } = await openPractice()
    await playTo(2_000)
    press('[')
    await expect.poll(() => announcer()?.textContent).toBe(LOOP_START_MARKED)
    await playTo(6_000)
    press(']')
    await expect.poll(() => vi.mocked(addLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(addLoop).mock.calls[0]![2]).toEqual({ start_ms: 2_000, end_ms: 6_000 })
    const [created] = await liveLoops(id)
    await expect.poll(() => engine.getState().loop?.id).toBe(created!.id)
    expect(engine.getState().repeat).toBe(true)
  })

  it('takes [ and ] typed with AltGr, which reports Ctrl and Alt', async () => {
    await localRecording()
    const { playTo } = await openPractice()
    await playTo(2_000)
    press('[', document.body, { ctrlKey: true, altKey: true })
    await expect.poll(() => markButton()!.getAttribute('aria-pressed')).toBe('true')
    await playTo(6_000)
    press(']', document.body, { ctrlKey: true, altKey: true })
    await expect.poll(() => vi.mocked(addLoop).mock.calls.length).toBe(1)
    press('[', document.body, { metaKey: true })
    await wait(100)
    expect(markButton()!.getAttribute('aria-pressed')).toBe('false')
    expect(updateLoop).not.toHaveBeenCalled()
  })

  it('ignores R, [, and ] while a text field has focus', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    const { engine, playTo } = await openPractice()
    await tapLoop(loop)
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)
    await playTo(3_000)
    const field = document.createElement('input')
    presented()!.appendChild(field)
    press('[', field)
    press(']', field)
    press('r', field)
    await wait(100)
    expect(updateLoop).not.toHaveBeenCalled()
    expect(engine.getState().repeat).toBe(false)
    field.remove()
  })
})
