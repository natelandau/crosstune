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
import type { LocalRecording } from '../../db/types'
import { contrastRatio } from '../../test/contrast'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { fakePlaybackEngine } from '../../test/providers'
import { loopRow } from '../../test/rows'
import type { PlaybackEngine } from '../player/playbackEngine'
import { EDIT_RECORDING } from '../recording-screen/useRecordingScreen'
import { RecordingsPage } from '../recordings/RecordingsPage'
import { LOOP_END, LOOP_START } from './LoopHandle'
import { LOOP_HINT } from './LoopLane'
import { ZOOM_IN, ZOOM_OUT } from '../recording-screen/panel'
import { FIT } from './PracticeLanes'
import { LANES_LABEL } from './PracticeView'
import { BACK, PRACTICE } from './practiceCopy'

vi.mock('../../commands/loops', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  document.documentElement.classList.remove('ion-palette-dark')
  await db.delete()
})

const LENGTH_MS = 180_000

/** A three-minute recording captured on this device, so its blob is already held locally. */
async function localRecording(extra: Partial<LocalRecording> = {}) {
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
  await updateRecording(db, id, { label: 'Jam recording', ...extra })
  return id
}

async function seedLoop(recordingId: string, startMs: number, endMs: number, extra = {}) {
  const id = newId()
  await db.recording_loops.put(
    loopRow({ id, recording_id: recordingId, start_ms: startMs, end_ms: endMs, ...extra }),
  )
  return id
}

const presented = () => document.querySelector<HTMLElement>('ion-modal:not(.overlay-hidden)')

async function dialog() {
  await expect.poll(presented).not.toBeNull()
  return page.elementLocator(presented()!)
}

/** Practice opened on the recording, with its lanes measured and laid out. */
async function openPractice(engine: PlaybackEngine = fakePlaybackEngine(), lengthMs = LENGTH_MS) {
  renderScreen(<RecordingsPage />, {
    db,
    path: '/recordings',
    route: '/recordings',
    playbackEngine: engine,
    recordingScreen: true,
    dock: true,
  })
  await page.getByRole('button', { name: `${EDIT_RECORDING} Jam recording` }).click()
  await (await dialog()).getByRole('button', { name: PRACTICE }).click()
  await expect.poll(() => engine.getState().lengthMs).toBe(lengthMs)
  await expect.poll(() => lane()?.dataset.pxPerS).toBeTruthy()
  engine.pause()
  return engine
}

const lane = () => document.querySelector<HTMLElement>('[data-loop-lane]')
const detail = () => document.querySelector<HTMLElement>('[data-detail-surface]')
const overview = () => document.querySelector<HTMLElement>('[data-overview]')
const pill = (id: string) => document.querySelector<HTMLElement>(`[data-loop="${id}"]`)

/** The zoomed view as the lane reports it: its left edge on the trimmed timeline and scale. */
function view() {
  const el = lane()!
  return { startMs: Number(el.dataset.startMs), pxPerS: Number(el.dataset.pxPerS) }
}

/** The x within the lane of a time on the trimmed timeline. */
function xOf(ms: number) {
  const { startMs, pxPerS } = view()
  return ((ms - startMs) / 1000) * pxPerS
}

/** The trimmed time at an x within the lane. */
function msAt(x: number) {
  const { startMs, pxPerS } = view()
  return startMs + (x / pxPerS) * 1000
}

function pointer(
  target: Element,
  type: string,
  x: number,
  { y, alt = false, id = 1 }: { y?: number; alt?: boolean; id?: number } = {},
) {
  const rect = target.getBoundingClientRect()
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      isPrimary: id === 1,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pointerType: 'mouse',
      altKey: alt,
      clientX: rect.left + x,
      clientY: rect.top + (y ?? 14),
    }),
  )
}

/** A press at `from`, moved through to `to`, and let go there, all in px within `target`. */
function drag(target: Element, from: number, to: number, options: { alt?: boolean } = {}) {
  pointer(target, 'pointerdown', from, options)
  const steps = 4
  for (let i = 1; i <= steps; i++) {
    pointer(target, 'pointermove', from + ((to - from) * i) / steps, options)
  }
  pointer(target, 'pointerup', to, options)
}

const near = (actual: number, expected: number, within = 2) =>
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(within)

async function liveLoops(recordingId: string) {
  return (await db.recording_loops.where('recording_id').equals(recordingId).toArray()).filter(
    (l) => !l.deleted_at,
  )
}

describe('LoopLane', () => {
  it('names the lanes region', async () => {
    await localRecording()
    await openPractice()
    await expect.element((await dialog()).getByRole('region', { name: LANES_LABEL })).toBeVisible()
  })

  it('shows the hint while the recording has no loops', async () => {
    await localRecording()
    await openPractice()
    await expect.element((await dialog()).getByText(LOOP_HINT)).toBeVisible()
  })

  it('draws a new loop with one drag across the empty lane, and selects it', async () => {
    const id = await localRecording()
    const engine = await openPractice()
    const from = 100
    const expectedStart = msAt(from)
    const expectedEnd = msAt(from + 60)
    drag(lane()!, from, from + 60)

    await expect.poll(() => vi.mocked(addLoop).mock.calls.length).toBe(1)
    const [, recordingId, span] = vi.mocked(addLoop).mock.calls[0]!
    expect(recordingId).toBe(id)
    near(span.start_ms, expectedStart)
    near(span.end_ms, expectedEnd)
    const [created] = await liveLoops(id)
    await expect.poll(() => engine.getState().loop?.id).toBe(created!.id)
    await expect.poll(() => pill(created!.id)?.dataset.selected).toBe('true')
  })

  it('takes a short drag for a tap, which creates and seeks nothing', async () => {
    await localRecording()
    const engine = await openPractice()
    const seek = vi.spyOn(engine, 'seek')
    drag(lane()!, 100, 105)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(addLoop).not.toHaveBeenCalled()
    expect(seek).not.toHaveBeenCalled()
  })

  it('moves a loop by its body with one write', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    await openPractice()
    await expect.poll(() => pill(loop)).not.toBeNull()
    const from = xOf(7_500)
    const shift = msAt(from + 60) - msAt(from)
    drag(lane()!, from, from + 60)

    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    const [, loopId, patch] = vi.mocked(updateLoop).mock.calls[0]!
    expect(loopId).toBe(loop)
    near(patch.start_ms!, 5_000 + shift)
    expect(patch.end_ms! - patch.start_ms!).toBe(5_000)
  })

  it('resizes a loop by its end and stops at half a second', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    await openPractice()
    await expect.poll(() => pill(loop)).not.toBeNull()
    drag(lane()!, xOf(10_000) - 2, xOf(1_000))

    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(updateLoop).mock.calls[0]![2]).toEqual({ start_ms: 5_000, end_ms: 5_500 })
  })

  it('snaps an edge to the playhead within 8 px, unless Alt is held', async () => {
    await localRecording()
    const engine = await openPractice()
    engine.seek(12_000)
    await expect.element((await dialog()).getByText('0:12', { exact: true })).toBeVisible()
    drag(lane()!, xOf(5_000), xOf(12_000) + 5)
    await expect.poll(() => vi.mocked(addLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(addLoop).mock.calls[0]![2].end_ms).toBe(12_000)

    drag(lane()!, xOf(5_000), xOf(12_000) + 5, { alt: true })
    await expect.poll(() => vi.mocked(addLoop).mock.calls.length).toBe(2)
    expect(vi.mocked(addLoop).mock.calls[1]![2].end_ms).toBeGreaterThan(12_000)
  })

  it('stacks overlapping loops in rows', async () => {
    const id = await localRecording()
    const first = await seedLoop(id, 5_000, 10_000)
    const second = await seedLoop(id, 7_000, 12_000)
    await openPractice()
    await expect.poll(() => pill(second)?.dataset.row).toBe('1')
    expect(pill(first)?.dataset.row).toBe('0')
  })

  it('scrolls inside the lane when more than three rows stack', async () => {
    const id = await localRecording()
    for (let i = 0; i < 4; i++) await seedLoop(id, 5_000 + i * 500, 15_000)
    await openPractice()
    await expect.poll(() => document.querySelectorAll('[data-loop]').length).toBe(4)
    const el = lane()!
    expect(el.scrollHeight).toBeGreaterThan(el.clientHeight)
  })

  it('moves the playhead into a repeating loop dragged away from it, on release', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    const engine = await openPractice()
    engine.seek(7_000)
    await expect.poll(() => pill(loop)).not.toBeNull()
    drag(lane()!, xOf(7_500), xOf(7_500))
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)
    engine.setRepeat(true)

    const from = xOf(7_500)
    pointer(lane()!, 'pointerdown', from)
    pointer(lane()!, 'pointermove', from + 60)
    pointer(lane()!, 'pointermove', from + 120)
    expect(engine.getState().positionMs).toBe(7_000)
    pointer(lane()!, 'pointerup', from + 120)
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    const moved = vi.mocked(updateLoop).mock.calls[0]![2].start_ms!
    expect(moved).toBeGreaterThan(10_000)
    expect(engine.getState().positionMs).toBe(moved)
    expect(engine.getState().repeat).toBe(true)
  })

  it('creates nothing by drag once the recording has 100 loops', async () => {
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
    await expect.element((await dialog()).getByText(LOOP_LIMIT)).toBeVisible()
    drag(lane()!, 100, 160)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(addLoop).not.toHaveBeenCalled()
    expect(await liveLoops(id)).toHaveLength(100)
  })

  it('seeks on a tap on the zoomed waveform and pans on a drag', async () => {
    await localRecording()
    const engine = await openPractice()
    const target = msAt(180)
    pointer(detail()!, 'pointerdown', 180, { y: 40 })
    pointer(detail()!, 'pointerup', 180, { y: 40 })
    near(engine.getState().positionMs, target, 50)

    const before = view().startMs
    const shift = msAt(200) - msAt(100)
    drag(detail()!, 200, 100)
    await expect.poll(() => view().startMs).toBeGreaterThan(before)
    near(view().startMs, before + shift, 50)
    near(engine.getState().positionMs, target, 50)
  })

  it('moves the zoomed view from the overview, by a tap or by dragging its box', async () => {
    await localRecording()
    await openPractice()
    const strip = overview()!
    const width = strip.getBoundingClientRect().width
    const shown = 30_000
    pointer(strip, 'pointerdown', width / 2, { y: 10 })
    pointer(strip, 'pointerup', width / 2, { y: 10 })
    await expect.poll(() => view().startMs).toBeCloseTo(90_000 - shown / 2, -2)

    const boxCenter = width / 2
    drag(strip, boxCenter, boxCenter + width / 18)
    await expect.poll(() => view().startMs).toBeCloseTo(100_000 - shown / 2, -2)
  })

  it('fits the selected loop with a margin', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 20_000, 28_000)
    const engine = await openPractice()
    await expect.poll(() => pill(loop)).not.toBeNull()
    drag(lane()!, xOf(24_000), xOf(24_000))
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)
    await (await dialog()).getByRole('button', { name: FIT }).click()
    await expect.poll(() => view().startMs).toBeCloseTo(19_200, -1)
    const width = lane()!.clientWidth
    expect(view().pxPerS).toBeCloseTo(width / 9.6, 3)
  })

  it('zooms with Command or Ctrl and = or -, and with its buttons', async () => {
    await localRecording()
    await openPractice()
    const start = view().pxPerS
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true }),
    )
    await expect.poll(() => view().pxPerS).toBeCloseTo(start * 2, 3)
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', metaKey: true, bubbles: true }),
    )
    await expect.poll(() => view().pxPerS).toBeCloseTo(start, 3)
    await (await dialog()).getByRole('button', { name: ZOOM_IN }).click()
    await expect.poll(() => view().pxPerS).toBeCloseTo(start * 2, 3)
    await (await dialog()).getByRole('button', { name: ZOOM_OUT }).click()
    await expect.poll(() => view().pxPerS).toBeCloseTo(start, 3)
  })

  it('gives each handle of the selected loop a slider the arrows nudge', async () => {
    const id = await localRecording({ trim_start_ms: 2_000 })
    const loop = await seedLoop(id, 60_000, 80_000, { label: 'B part' })
    const engine = await openPractice(fakePlaybackEngine(), LENGTH_MS - 2_000)
    const strip = overview()!
    const width = strip.getBoundingClientRect().width
    // The overview spans the trimmed 178 s; tapping at 68 s centers the view on the loop.
    pointer(strip, 'pointerdown', (68 / 178) * width, { y: 10 })
    pointer(strip, 'pointerup', (68 / 178) * width, { y: 10 })
    await expect.poll(() => pill(loop)).not.toBeNull()
    drag(lane()!, xOf(68_000), xOf(68_000))
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)

    const start = (await dialog()).getByRole('slider', { name: LOOP_START })
    await expect.element(start).toHaveAttribute('aria-valuetext', 'B part start, 0:58')
    await expect
      .element((await dialog()).getByRole('slider', { name: LOOP_END }))
      .toHaveAttribute('aria-valuetext', 'B part end, 1:18')
    ;(start.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(updateLoop).mock.calls[0]!.slice(1)).toEqual([
      loop,
      { start_ms: 60_100, end_ms: 80_000 },
    ])
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(2)
    expect(vi.mocked(updateLoop).mock.calls[1]![2]).toEqual({ start_ms: 61_100, end_ms: 80_000 })
  })

  it('saves a nudge whose key is let go after focus has left the handle', async () => {
    const { loop } = await repeatingLoop()
    const end = (await dialog()).getByRole('slider', { name: LOOP_END })
    ;(end.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowRight>}')
    ;(end.element() as HTMLElement).blur()
    await userEvent.keyboard('{/ArrowRight}')
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(updateLoop).mock.calls[0]!.slice(1)).toEqual([
      loop,
      { start_ms: 20_000, end_ms: 28_100 },
    ])
  })

  it('draws the bars of a recording shorter than the view under its own stretch of ruler', async () => {
    await localRecording({ trim_end_ms: 1_000 })
    await openPractice(fakePlaybackEngine(), 1_000)
    // The view cannot zoom in far enough to fill with one second, so it starts before 0.
    expect(view().startMs).toBeLessThan(0)
    const bars = presented()!.querySelector<HTMLElement>('canvas.practice-detail')!
    const surface = detail()!.getBoundingClientRect()
    const box = bars.getBoundingClientRect()
    near(box.left - surface.left, xOf(0), 1)
    near(box.width, xOf(1_000) - xOf(0), 1)
  })

  it('drops a lane drag whose pointer capture is lost', async () => {
    await localRecording()
    await openPractice()
    pointer(lane()!, 'pointerdown', 100)
    pointer(lane()!, 'pointermove', 130)
    pointer(lane()!, 'pointermove', 160)
    await expect.poll(() => document.querySelector('[data-loop-draft]')).not.toBeNull()
    pointer(lane()!, 'lostpointercapture', 160)
    await expect.poll(() => document.querySelector('[data-loop-draft]')).toBeNull()
    expect(addLoop).not.toHaveBeenCalled()
  })

  it('drops a handle drag whose pointer capture is lost', async () => {
    const { engine, handle } = await repeatingLoop()
    pointer(handle, 'pointerdown', handleAt(handle, 28_000))
    pointer(handle, 'pointermove', handleAt(handle, 26_000))
    await expect.poll(() => engine.loopRange?.toS).toBe(26)
    pointer(handle, 'lostpointercapture', handleAt(handle, 26_000))
    await expect.poll(() => engine.loopRange?.toS).toBe(28)
    expect(updateLoop).not.toHaveBeenCalled()
  })

  it('lets go of a move whose write leaves the row as it was', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    await openPractice()
    await expect.poll(() => pill(loop)).not.toBeNull()
    vi.mocked(updateLoop).mockImplementationOnce(async () => {})
    const from = xOf(7_500)
    drag(lane()!, from, from + 60)
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    await expect.poll(() => parseFloat(pill(loop)!.style.left)).toBeCloseTo(xOf(5_000), 0)
  })

  it('pans the view while a drag holds near the edge of the lane', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    await openPractice()
    await expect.poll(() => pill(loop)).not.toBeNull()
    const width = lane()!.clientWidth
    pointer(lane()!, 'pointerdown', xOf(7_500))
    pointer(lane()!, 'pointermove', xOf(7_500) + 20)
    pointer(lane()!, 'pointermove', width - 4)
    await expect.poll(() => view().startMs).toBeGreaterThan(5_000)
    pointer(lane()!, 'pointerup', width - 4)
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    // The loop went along with the view it was dragged into.
    expect(vi.mocked(updateLoop).mock.calls[0]![2].start_ms).toBeGreaterThan(30_000)
  })

  it('opens on 30 seconds around the playhead, or fitted to the selected loop', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 20_000, 28_000)
    const engine = await openPractice()
    await expect.poll(() => view().startMs).toBe(0)
    drag(lane()!, xOf(24_000), xOf(24_000))
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)

    await (await dialog()).getByRole('button', { name: BACK }).click()
    await expect.poll(() => lane()).toBeNull()
    await (await dialog()).getByRole('button', { name: PRACTICE }).click()
    await expect.poll(() => lane()?.dataset.startMs).toBeTruthy()
    // The selection outlived the view, and the view opened framed on it.
    expect(engine.getState().loop?.id).toBe(loop)
    await expect.poll(() => pill(loop)?.dataset.selected).toBe('true')
    expect(view().startMs).toBeCloseTo(19_200, -1)

    await (await dialog()).getByRole('button', { name: BACK }).click()
    await expect.poll(() => lane()).toBeNull()
    engine.setLoop(null)
    engine.seek(60_000)
    await (await dialog()).getByRole('button', { name: PRACTICE }).click()
    await expect.poll(() => lane()?.dataset.startMs).toBeTruthy()
    expect(view().startMs).toBe(45_000)
  })

  it('keeps three rows in the lane and shortens the zoomed waveform on a landscape phone', async () => {
    await localRecording()
    await openPractice()
    const bars = () =>
      presented()!.querySelector<HTMLElement>('[data-practice-lanes] canvas.practice-detail')!
    expect(bars().getBoundingClientRect().height).toBe(120)
    expect(lane()!.clientHeight).toBe(76)
    await page.viewport(844, 390)
    try {
      await expect.poll(() => bars().getBoundingClientRect().height).toBe(80)
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('zooms on a pinch and drops the drag its first finger began', async () => {
    await localRecording()
    await openPractice()
    const start = view().pxPerS
    pointer(lane()!, 'pointerdown', 100, { id: 1 })
    pointer(lane()!, 'pointermove', 140, { id: 1 })
    pointer(lane()!, 'pointerdown', 200, { id: 2 })
    pointer(lane()!, 'pointermove', 260, { id: 2 })
    pointer(lane()!, 'pointerup', 260, { id: 2 })
    pointer(lane()!, 'pointerup', 140, { id: 1 })
    await expect.poll(() => view().pxPerS).toBeGreaterThan(start)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(addLoop).not.toHaveBeenCalled()
    expect(document.querySelector('[data-loop-lane] .border-dashed')).toBeNull()
  })

  /** Practice on a selected, repeating loop at 20-28 s with the playhead inside it. */
  async function repeatingLoop() {
    const id = await localRecording()
    const loop = await seedLoop(id, 20_000, 28_000)
    const engine = await openPractice()
    engine.seek(24_000)
    await expect.poll(() => pill(loop)).not.toBeNull()
    drag(lane()!, xOf(24_000), xOf(24_000))
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)
    engine.setRepeat(true)
    await expect.element((await dialog()).getByText('0:24', { exact: true })).toBeVisible()
    const handle = document.querySelector<HTMLElement>('[data-handle="end"]')!
    return { loop, engine, handle }
  }

  /** The detail's x of a source time, measured from the handle's own surface. */
  function handleAt(handle: HTMLElement, ms: number) {
    const surface = handle.parentElement!.getBoundingClientRect()
    return surface.left + xOf(ms) - handle.getBoundingClientRect().left
  }

  it('lets go of a cancelled handle drag, so a later change to the row plays', async () => {
    const { loop, engine, handle } = await repeatingLoop()
    pointer(handle, 'pointerdown', handleAt(handle, 28_000))
    pointer(handle, 'pointermove', handleAt(handle, 26_000))
    await expect.poll(() => engine.loopRange?.toS).toBe(26)
    pointer(handle, 'pointercancel', handleAt(handle, 26_000))
    await expect.poll(() => engine.loopRange?.toS).toBe(28)
    expect(updateLoop).not.toHaveBeenCalled()

    await db.recording_loops.update(loop, { end_ms: 29_000 })
    await expect.poll(() => engine.loopRange?.toS).toBe(29)
  })

  it('lets go of a handle drag a pinch takes over, so a later change to the row plays', async () => {
    const { loop, engine, handle } = await repeatingLoop()
    pointer(handle, 'pointerdown', handleAt(handle, 28_000), { id: 1 })
    pointer(handle, 'pointermove', handleAt(handle, 26_000), { id: 1 })
    await expect.poll(() => engine.loopRange?.toS).toBe(26)
    pointer(detail()!, 'pointerdown', 300, { id: 2, y: 40 })
    pointer(detail()!, 'pointermove', 340, { id: 2, y: 40 })
    pointer(detail()!, 'pointerup', 340, { id: 2, y: 40 })
    pointer(handle, 'pointerup', handleAt(handle, 26_000), { id: 1 })
    await expect.poll(() => engine.loopRange?.toS).toBe(28)
    expect(updateLoop).not.toHaveBeenCalled()

    await db.recording_loops.update(loop, { end_ms: 29_000 })
    await expect.poll(() => engine.loopRange?.toS).toBe(29)
  })

  it('lets go of a lane drag released on the loop’s own span', async () => {
    const { loop, engine } = await repeatingLoop()
    const from = xOf(24_000)
    pointer(lane()!, 'pointerdown', from)
    pointer(lane()!, 'pointermove', from - 20)
    await expect.poll(() => engine.loopRange?.fromS).toBeLessThan(20)
    pointer(lane()!, 'pointermove', from)
    pointer(lane()!, 'pointerup', from)
    await expect.poll(() => engine.loopRange?.fromS).toBe(20)
    expect(updateLoop).not.toHaveBeenCalled()

    await db.recording_loops.update(loop, { start_ms: 21_000 })
    await expect.poll(() => engine.loopRange?.fromS).toBe(21)
  })

  it('shows a newer value from elsewhere over a move whose write has not landed', async () => {
    const id = await localRecording()
    const loop = await seedLoop(id, 5_000, 10_000)
    await openPractice()
    await expect.poll(() => pill(loop)).not.toBeNull()
    vi.mocked(updateLoop).mockImplementationOnce(() => new Promise(() => {}))
    const from = xOf(7_500)
    drag(lane()!, from, from + 60)
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    await expect.poll(() => parseFloat(pill(loop)!.style.left)).toBeGreaterThan(xOf(5_000) + 50)

    await db.recording_loops.update(loop, { start_ms: 2_000, end_ms: 4_000 })
    await expect.poll(() => parseFloat(pill(loop)!.style.left)).toBeCloseTo(xOf(2_000), 0)
  })

  it.each(['light', 'dark'])('paints every loop color legibly in %s', async (theme) => {
    document.documentElement.classList.toggle('ion-palette-dark', theme === 'dark')
    const id = await localRecording()
    await openPractice()
    await expect.poll(() => lane()).not.toBeNull()
    const surface = getComputedStyle(document.body).backgroundColor
    for (let slot = 0; slot < 6; slot++) {
      const swatch = document.createElement('div')
      swatch.className = 'loop-color'
      swatch.dataset.color = String(slot)
      swatch.style.background = 'var(--loop)'
      lane()!.append(swatch)
      const fill = getComputedStyle(swatch).backgroundColor
      expect(contrastRatio(fill, surface), `${theme} ${slot} on page`).toBeGreaterThanOrEqual(3)
      expect(
        contrastRatio('rgb(255, 255, 255)', fill),
        `${theme} ${slot} label`,
      ).toBeGreaterThanOrEqual(4.5)
      swatch.remove()
    }
    expect(id).toBeTruthy()
  })
})
