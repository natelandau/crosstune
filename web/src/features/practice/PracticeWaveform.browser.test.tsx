import { render } from '@testing-library/react'
import { useState, type RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { fakePlaybackEngine, FakeAudioElement } from '../../test/providers'
import type { EngineClock, PlaybackEngine } from '../player/playbackEngine'
import { PlaybackEngineContext, useEngineState } from '../player/PlaybackEngineProvider'
import { LOOP_END, LOOP_START } from './LoopHandle'
import { loopAt } from './loopModel'
import { LANES_LABEL, LOOP_NAME } from './practiceCopy'
import { GLIDE_TAU_MS } from './practiceZoom'
import { PracticeWaveform, type LaneLoop } from './PracticeWaveform'

const LENGTH_MS = 60_000
const WIDTH_PX = 400
const PX_PER_S = 100

/** A clock that never ticks, so the playhead only moves when a test moves it. */
const stillClock: EngineClock = { every: () => () => {}, after: () => () => {} }

afterEach(() => {
  vi.useRealTimers()
})

function Harness({
  engine,
  loops,
  initialSelected,
  spies,
  pinches,
}: {
  engine: PlaybackEngine
  loops: LaneLoop[]
  initialSelected: string | null
  spies: Spies
  pinches: RefObject<number>
}) {
  const positionMs = useEngineState(engine, (s) => s.positionMs)
  const [selectedId, setSelectedId] = useState(initialSelected)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const selectedLoop = loops.find((loop) => loop.id === selectedId) ?? null
  return (
    <div style={{ width: WIDTH_PX }}>
      <PracticeWaveform
        shown={null}
        loops={loops}
        selected={
          selectedLoop
            ? {
                id: selectedLoop.id,
                name: selectedLoop.name,
                color: selectedLoop.color,
                span: { startMs: selectedLoop.startMs, endMs: selectedLoop.endMs },
              }
            : null
        }
        pxPerS={PX_PER_S}
        widthPx={WIDTH_PX}
        bounds={{ startMs: 0, endMs: LENGTH_MS }}
        playheadMs={positionMs}
        renamingId={renamingId}
        onTap={(ms) => {
          spies.onTap(ms)
          setSelectedId(loopAt(ms, loops)?.id ?? null)
        }}
        onRenameStart={(id) => {
          spies.onRenameStart(id)
          setRenamingId(id)
        }}
        onRenameCommit={(id, label) => {
          spies.onRenameCommit(id, label)
          setRenamingId(null)
        }}
        onRenameCancel={() => {
          spies.onRenameCancel()
          setRenamingId(null)
        }}
        onDraft={spies.onDraft}
        onCommit={spies.onCommit}
        pinches={pinches}
      />
    </div>
  )
}

type Spies = ReturnType<typeof makeSpies>
const makeSpies = () => ({
  onTap: vi.fn(),
  onRenameStart: vi.fn(),
  onRenameCommit: vi.fn(),
  onRenameCancel: vi.fn(),
  onDraft: vi.fn(),
  onCommit: vi.fn(),
})

/** The waveform with the playhead at `positionMs` on a one-minute, untrimmed recording. */
function setup({
  positionMs = 20_000,
  playing = false,
  loops = [],
  selected = null,
}: {
  positionMs?: number
  playing?: boolean
  loops?: LaneLoop[]
  selected?: string | null
} = {}) {
  const engine = fakePlaybackEngine(
    new FakeAudioElement() as unknown as HTMLAudioElement,
    stillClock,
  )
  engine.load(
    'blob:test',
    { fromS: 0, toS: LENGTH_MS / 1000, lengthMs: LENGTH_MS },
    { speedPercent: 100, pitchCents: 0 },
    { title: 'Test recording' },
  )
  engine.seek(positionMs)
  if (playing) engine.play()
  const seek = vi.spyOn(engine, 'seek')
  const play = vi.spyOn(engine, 'play')
  const pause = vi.spyOn(engine, 'pause')
  const spies = makeSpies()
  const pinches = { current: 0 }
  render(
    <PlaybackEngineContext.Provider value={engine}>
      <Harness
        engine={engine}
        loops={loops}
        initialSelected={selected}
        spies={spies}
        pinches={pinches}
      />
    </PlaybackEngineContext.Provider>,
  )
  return { engine, seek, play, pause, spies, pinches }
}

const waveform = () => document.querySelector<HTMLElement>('[data-practice-waveform]')!
const surface = () => page.getByRole('slider', { name: LANES_LABEL }).element()
const viewStart = () => Number(waveform().dataset.startMs)

/** The x within the waveform of a time, with the playhead at `centerMs`. */
const xAt = (ms: number, centerMs: number) => WIDTH_PX / 2 + ((ms - centerMs) / 1000) * PX_PER_S

function pointer(
  target: Element,
  type: string,
  x: number,
  {
    pointerType = 'mouse',
    id = 1,
    altKey = false,
  }: { pointerType?: string; id?: number; altKey?: boolean } = {},
) {
  const rect = waveform().getBoundingClientRect()
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pointerType,
      altKey,
      clientX: rect.left + x,
      clientY: rect.top + 40,
    }),
  )
}

function drag(target: Element, from: number, to: number) {
  pointer(target, 'pointerdown', from)
  for (let i = 1; i <= 4; i++) pointer(target, 'pointermove', from + ((to - from) * i) / 4)
  pointer(target, 'pointerup', to)
}

const A: LaneLoop = {
  id: 'a',
  startMs: 19_000,
  endMs: 20_500,
  color: 0,
  name: 'A part',
  label: 'A part',
}
const B: LaneLoop = {
  id: 'b',
  startMs: 20_500,
  endMs: 23_000,
  color: 1,
  name: 'B part',
  label: 'B part',
}

describe('PracticeWaveform', () => {
  it('the playhead stays centered while the audio scrolls under it', async () => {
    const { seek } = setup()
    expect(viewStart()).toBe(18_000)
    pointer(surface(), 'pointerdown', 200)
    pointer(surface(), 'pointermove', 250)
    pointer(surface(), 'pointermove', 300)
    await expect.poll(viewStart).toBe(17_000)
    expect(seek).not.toHaveBeenCalled()
    pointer(surface(), 'pointerup', 300)
    await expect.poll(() => seek.mock.calls).toEqual([[19_000]])
  })

  it('reads the position and moves it a second per arrow, five with Shift', async () => {
    const { seek } = setup()
    const slider = page.getByRole('slider', { name: LANES_LABEL })
    await expect.element(slider).toHaveAttribute('aria-valuetext', '0:20 of 1:00')
    ;(slider.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(seek).toHaveBeenLastCalledWith(21_000)
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect(seek).toHaveBeenLastCalledWith(16_000)
  })

  it('a scrub held at 0:00 stops there and draws the empty half blank', async () => {
    const { seek } = setup({ positionMs: 2_000 })
    pointer(surface(), 'pointerdown', 100)
    pointer(surface(), 'pointermove', 250)
    pointer(surface(), 'pointermove', 390)
    await expect.poll(viewStart).toBe(-2_000)
    const bars = waveform().querySelector<HTMLElement>('[data-bars]')!
    expect(bars.style.marginLeft).toBe(`${WIDTH_PX / 2}px`)
    const ticks = [...waveform().querySelectorAll<HTMLElement>('[data-tick]')]
    expect(ticks.length).toBeGreaterThan(0)
    for (const tick of ticks) expect(parseFloat(tick.style.left)).toBeGreaterThanOrEqual(200)
    pointer(surface(), 'pointerup', 390)
    await expect.poll(() => seek.mock.calls).toEqual([[0]])
  })

  it('a fling past the end glides to the end and stops there', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const { seek } = setup({ positionMs: 58_000 })
    const touch = { pointerType: 'touch' }
    pointer(surface(), 'pointerdown', 300, touch)
    vi.advanceTimersByTime(16)
    pointer(surface(), 'pointermove', 250, touch)
    vi.advanceTimersByTime(16)
    pointer(surface(), 'pointermove', 200, touch)
    pointer(surface(), 'pointerup', 200, touch)
    vi.advanceTimersByTime(GLIDE_TAU_MS)
    expect(seek).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3 * GLIDE_TAU_MS)
    expect(seek.mock.calls).toEqual([[LENGTH_MS]])
  })

  it('a fling that ends at the end of the take does not play on', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const { seek, play } = setup({ positionMs: 58_000, playing: true })
    play.mockClear()
    const touch = { pointerType: 'touch' }
    pointer(surface(), 'pointerdown', 300, touch)
    vi.advanceTimersByTime(16)
    pointer(surface(), 'pointermove', 250, touch)
    vi.advanceTimersByTime(16)
    pointer(surface(), 'pointermove', 200, touch)
    pointer(surface(), 'pointerup', 200, touch)
    vi.advanceTimersByTime(4 * GLIDE_TAU_MS)
    expect(seek.mock.calls).toEqual([[LENGTH_MS]])
    expect(play).not.toHaveBeenCalled()
  })

  it('a tap while playing leaves playback alone', async () => {
    const { engine, play, pause, spies } = setup({ playing: true })
    await expect.poll(() => engine.getState().playing).toBe(true)
    play.mockClear()
    pointer(surface(), 'pointerdown', 200)
    pointer(surface(), 'pointermove', 203)
    pointer(surface(), 'pointerup', 203)
    expect(spies.onTap).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
    expect(engine.getState().playing).toBe(true)
  })

  it('a drag that gives way to a pinch seeks nothing', async () => {
    const { seek, spies, pinches } = setup()
    pointer(surface(), 'pointerdown', 200)
    pointer(surface(), 'pointermove', 300)
    await expect.poll(viewStart).toBe(17_000)
    pinches.current += 1
    pointer(surface(), 'pointermove', 350)
    await expect.poll(viewStart).toBe(18_000)
    pointer(surface(), 'pointerup', 350)
    expect(seek).not.toHaveBeenCalled()
    expect(spies.onTap).not.toHaveBeenCalled()
  })

  it('a drag pauses playback and resumes it from the new spot', async () => {
    const { engine, seek, play, pause } = setup({ playing: true })
    await expect.poll(() => engine.getState().playing).toBe(true)
    play.mockClear()
    pointer(surface(), 'pointerdown', 200)
    expect(pause).not.toHaveBeenCalled()
    pointer(surface(), 'pointermove', 180)
    expect(pause).toHaveBeenCalledTimes(1)
    await expect.poll(() => engine.getState().playing).toBe(false)
    pointer(surface(), 'pointermove', 150)
    pointer(surface(), 'pointerup', 150)
    await expect.poll(() => engine.getState().playing).toBe(true)
    expect(seek.mock.calls).toEqual([[20_500]])
    expect(play).toHaveBeenCalledTimes(1)
    expect(seek.mock.invocationCallOrder[0]!).toBeLessThan(play.mock.invocationCallOrder[0]!)
  })

  it('a tap on a loop selects it; a tap outside deselects', async () => {
    const { seek, spies } = setup({ loops: [A, B] })
    pointer(surface(), 'pointerdown', xAt(19_500, 20_000))
    pointer(surface(), 'pointerup', xAt(19_500, 20_000))
    expect(spies.onTap).toHaveBeenLastCalledWith(19_500)
    await expect.element(page.getByRole('slider', { name: LOOP_END })).toBeInTheDocument()

    pointer(surface(), 'pointerdown', xAt(18_500, 20_000))
    pointer(surface(), 'pointerup', xAt(18_500, 20_000))
    expect(spies.onTap).toHaveBeenLastCalledWith(18_500)
    await expect.poll(() => page.getByRole('slider', { name: LOOP_END }).elements()).toHaveLength(0)
    expect(seek).not.toHaveBeenCalled()
  })

  it("the selected loop's handles show grab tabs centered just outside its edges", async () => {
    setup({ loops: [A, B], selected: 'a' })
    await expect.element(page.getByRole('slider', { name: LOOP_END })).toBeInTheDocument()
    const box = waveform().getBoundingClientRect()
    const grip = (edge: 'start' | 'end') =>
      document.querySelector(`[data-handle="${edge}"] [data-grip]`)!.getBoundingClientRect()

    for (const edge of ['start', 'end'] as const) {
      const tab = grip(edge)
      expect(tab.width).toBeGreaterThanOrEqual(14)
      expect(tab.height).toBeGreaterThanOrEqual(40)
      expect(Math.abs(tab.top + tab.height / 2 - (box.top + box.height / 2))).toBeLessThanOrEqual(
        24,
      )
    }
    expect(grip('start').right - box.left).toBeLessThanOrEqual(xAt(A.startMs, 20_000) + 1)
    expect(grip('end').left - box.left).toBeGreaterThanOrEqual(xAt(A.endMs, 20_000) - 1)
  })

  it('draws a visible playhead line at the center', async () => {
    setup()
    const line = await vi.waitUntil(() => waveform().querySelector<HTMLElement>('[data-playhead]'))
    const { backgroundColor } = getComputedStyle(line)
    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(backgroundColor).not.toBe('transparent')
  })

  it('a tap on the seam selects the loop starting there', async () => {
    const { spies } = setup({ loops: [A, B] })
    pointer(surface(), 'pointerdown', xAt(20_500, 20_000))
    pointer(surface(), 'pointerup', xAt(20_500, 20_000))
    expect(spies.onTap).toHaveBeenLastCalledWith(20_500)
    await expect
      .element(page.getByRole('slider', { name: LOOP_END }))
      .toHaveAttribute('aria-valuetext', 'B part end, 0:23')
  })

  it("a tap on a handle's target just outside the selected loop deselects it", async () => {
    const { spies } = setup({ loops: [A, B], selected: 'a' })
    const handle = page.getByRole('slider', { name: LOOP_START }).element()
    pointer(handle, 'pointerdown', xAt(18_900, 20_000))
    pointer(handle, 'pointerup', xAt(18_900, 20_000))
    expect(spies.onTap).toHaveBeenLastCalledWith(18_900)
    await expect.poll(() => page.getByRole('slider', { name: LOOP_END }).elements()).toHaveLength(0)
    expect(spies.onCommit).not.toHaveBeenCalled()
  })

  it('a tap on the seam over the earlier loop’s end handle selects the later loop', async () => {
    const { spies } = setup({ loops: [A, B], selected: 'a' })
    const handle = page.getByRole('slider', { name: LOOP_END }).element()
    pointer(handle, 'pointerdown', xAt(20_500, 20_000))
    pointer(handle, 'pointerup', xAt(20_500, 20_000))
    expect(spies.onTap).toHaveBeenLastCalledWith(20_500)
    await expect
      .element(page.getByRole('slider', { name: LOOP_END }))
      .toHaveAttribute('aria-valuetext', 'B part end, 0:23')
  })

  it("a drag on a loop's body scrolls and does not move it", async () => {
    const { seek, spies } = setup({ loops: [A, B], selected: 'a' })
    drag(surface(), xAt(19_500, 20_000), xAt(19_500, 20_000) - 50)
    await expect.poll(() => seek.mock.calls).toEqual([[20_500]])
    expect(spies.onDraft).not.toHaveBeenCalled()
    expect(spies.onCommit).not.toHaveBeenCalled()
    expect(spies.onTap).not.toHaveBeenCalled()
  })

  it("the selected loop's end handle stops flush at the next loop", async () => {
    const first = { ...A, endMs: 19_800 }
    const second = { ...B, startMs: 20_000 }
    const { seek, spies } = setup({ positionMs: 19_500, loops: [first, second], selected: 'a' })
    const handle = page.getByRole('slider', { name: LOOP_END }).element()
    const from = xAt(19_800, 19_500)
    pointer(handle, 'pointerdown', from)
    pointer(handle, 'pointermove', from + 50)
    pointer(handle, 'pointermove', from + 100)
    pointer(handle, 'pointerup', from + 100)
    await expect
      .poll(() => spies.onCommit.mock.calls)
      .toEqual([[{ id: 'a', startMs: 19_000, endMs: 20_000 }]])
    expect(seek).not.toHaveBeenCalled()
  })

  it('Alt drops the snap to the playhead but keeps the snap to the room', async () => {
    const first = { ...A, endMs: 19_800 }
    const second = { ...B, startMs: 20_000 }
    const { spies } = setup({ positionMs: 19_500, loops: [first, second], selected: 'a' })
    const handle = () => page.getByRole('slider', { name: LOOP_END }).element()
    const end = (ms: number, altKey: boolean) => {
      const from = xAt(19_800, 19_500)
      pointer(handle(), 'pointerdown', from, { altKey })
      pointer(handle(), 'pointermove', xAt(ms, 19_500) + 20, { altKey })
      pointer(handle(), 'pointermove', xAt(ms, 19_500), { altKey })
      pointer(handle(), 'pointerup', xAt(ms, 19_500), { altKey })
    }
    end(19_530, false)
    await expect.poll(() => spies.onCommit.mock.calls.at(-1)?.[0].endMs).toBe(19_500)
    end(19_530, true)
    await expect.poll(() => spies.onCommit.mock.calls.at(-1)?.[0].endMs).toBe(19_530)
    end(19_970, true)
    await expect.poll(() => spies.onCommit.mock.calls.at(-1)?.[0].endMs).toBe(20_000)
  })

  it('a handle held at the edge pans by moving the playhead', async () => {
    const { seek, spies } = setup({ positionMs: 19_500, loops: [A], selected: 'a' })
    const handle = page.getByRole('slider', { name: LOOP_END }).element()
    const from = xAt(20_500, 19_500)
    pointer(handle, 'pointerdown', from)
    pointer(handle, 'pointermove', from + 50)
    pointer(handle, 'pointermove', WIDTH_PX - 2)
    await expect.poll(() => seek.mock.calls.length).toBeGreaterThan(1)
    expect(seek.mock.calls[0]![0]).toBeGreaterThan(19_500)
    expect(seek.mock.calls.at(-1)![0]).toBeGreaterThan(seek.mock.calls[0]![0])
    pointer(handle, 'pointerup', WIDTH_PX - 2)
    expect(spies.onCommit).toHaveBeenCalledTimes(1)
  })

  it('a press that catches a glide takes over from where it got to', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const { seek } = setup({ positionMs: 20_000 })
    // A real wait renders without running the faked frames; a poll would advance them.
    const rendered = () => new Promise((resolve) => setTimeout(resolve, 50))
    const touch = { pointerType: 'touch' }
    pointer(surface(), 'pointerdown', 300, touch)
    vi.advanceTimersByTime(16)
    pointer(surface(), 'pointermove', 250, touch)
    vi.advanceTimersByTime(16)
    pointer(surface(), 'pointermove', 200, touch)
    pointer(surface(), 'pointerup', 200, touch)
    vi.advanceTimersByTime(GLIDE_TAU_MS)
    await rendered()
    const caughtStart = viewStart()
    expect(caughtStart).toBeGreaterThan(19_000)
    pointer(surface(), 'pointerdown', 200)
    pointer(surface(), 'pointermove', 150)
    await rendered()
    expect(viewStart()).toBeCloseTo(caughtStart + 500, 0)
    pointer(surface(), 'pointerup', 150)
    vi.advanceTimersByTime(4 * GLIDE_TAU_MS)
    expect(seek).toHaveBeenCalledTimes(1)
    expect(seek.mock.calls[0]![0]).toBeCloseTo(caughtStart + 2000 + 500, 0)
  })

  it("tapping the selected loop's name tab opens a text field named Loop name; Enter commits; Escape cancels", async () => {
    const { spies } = setup({ loops: [A, B], selected: 'a' })
    await page.getByRole('button', { name: 'A part' }).click()
    const field = page.getByRole('textbox', { name: LOOP_NAME })
    await expect.element(field).toHaveValue('A part')
    await field.fill('Intro')
    await userEvent.keyboard('{Enter}')
    expect(spies.onRenameCommit.mock.calls).toEqual([['a', 'Intro']])
    await expect.poll(() => page.getByRole('textbox').elements()).toHaveLength(0)

    await page.getByRole('button', { name: 'A part' }).click()
    await field.fill('Outro')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => page.getByRole('textbox').elements()).toHaveLength(0)
    expect(spies.onRenameCancel).toHaveBeenCalledTimes(1)
    expect(spies.onRenameCommit).toHaveBeenCalledTimes(1)
  })

  it('keeps the name field inside the waveform near its right edge', async () => {
    const late: LaneLoop = { ...B, startMs: 21_500, endMs: 23_000 }
    setup({ loops: [A, late], selected: 'b' })
    await page.getByRole('button', { name: 'B part' }).click()
    const field = page.getByRole('textbox', { name: LOOP_NAME })
    await expect.element(field).toBeVisible()
    const box = field.element().getBoundingClientRect()
    expect(box.right).toBeLessThanOrEqual(waveform().getBoundingClientRect().right + 0.5)
  })

  it('opens the name field empty for an unnamed loop and commits it empty', async () => {
    const unnamed: LaneLoop = { ...A, name: 'Loop 0:19', label: null }
    const { spies } = setup({ loops: [unnamed, B], selected: 'a' })
    await page.getByRole('button', { name: 'Loop 0:19' }).click()
    const field = page.getByRole('textbox', { name: LOOP_NAME })
    await expect.element(field).toHaveValue('')
    ;(field.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    expect(spies.onRenameCommit.mock.calls).toEqual([['a', '']])
  })
})
