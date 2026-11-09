import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { drag } from '../../test/gestures'
import { renderWithProviders } from '../../test/render'
import { IsolateRange } from './IsolateRange'
import { hzReadout, stereoEdgeReadout, stereoReadout, frequencyReadout } from './isolateReadout'
import {
  FREQUENCY,
  FREQUENCY_HIGH,
  FREQUENCY_LOW,
  STEREO,
  STEREO_END,
  STEREO_START,
} from './practiceCopy'

const WIDTH_PX = 400

function Stereo({
  initial,
  onChange,
}: {
  initial: [number, number]
  onChange: (start: number, end: number) => void
}) {
  const [[start, end], setRange] = useState(initial)
  return (
    <div style={{ width: WIDTH_PX }}>
      <IsolateRange
        label={STEREO}
        startLabel={STEREO_START}
        endLabel={STEREO_END}
        min={-100}
        max={100}
        scale="linear"
        start={start}
        end={end}
        minSpan={10}
        step={5}
        largeStep={20}
        readout={stereoReadout}
        valueText={stereoEdgeReadout}
        outline={null}
        onChange={(nextStart, nextEnd) => {
          setRange([nextStart, nextEnd])
          onChange(nextStart, nextEnd)
        }}
      />
    </div>
  )
}

function Frequency({
  initial,
  onChange = () => {},
}: {
  initial: [number, number]
  onChange?: (start: number, end: number) => void
}) {
  const [[start, end], setRange] = useState(initial)
  return (
    <div style={{ width: WIDTH_PX }}>
      <IsolateRange
        label={FREQUENCY}
        startLabel={FREQUENCY_LOW}
        endLabel={FREQUENCY_HIGH}
        min={40}
        max={16000}
        scale="log"
        start={start}
        end={end}
        minSpan={1 / 3}
        step={1 / 12}
        largeStep={1}
        readout={frequencyReadout}
        valueText={hzReadout}
        outline={null}
        onChange={(nextStart, nextEnd) => {
          setRange([nextStart, nextEnd])
          onChange(nextStart, nextEnd)
        }}
      />
    </div>
  )
}

const slider = (name: string) => page.getByRole('slider', { name })
const track = () => document.querySelector<HTMLElement>('[data-range-track]')!
const centerX = (element: Element) => {
  const rect = element.getBoundingClientRect()
  return rect.left + rect.width / 2
}

it('moves one edge by a step with the arrows, and by a large step with Shift', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Stereo initial={[-100, 100]} onChange={onChange} />)
  await expect.element(slider(STEREO_START)).toHaveAttribute('aria-valuetext', 'Left, 100 left')
  await slider(STEREO_START).click()
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => onChange.mock.lastCall).toEqual([-95, 100])
  await expect.element(slider(STEREO_START)).toHaveAttribute('aria-valuetext', 'Left, 95 left')
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
  await expect.poll(() => onChange.mock.lastCall).toEqual([-75, 100])
  await expect.element(slider(STEREO_START)).toHaveAttribute('aria-valuenow', '-75')
  await expect.element(slider(STEREO_START)).toHaveAttribute('aria-valuetext', 'Left, 75 left')
  await slider(STEREO_END).click()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.poll(() => onChange.mock.lastCall).toEqual([-75, 95])
})

it('never moves an edge closer than the shortest span to the other', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Stereo initial={[-30, 0]} onChange={onChange} />)
  await slider(STEREO_START).click()
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
  await expect.poll(() => onChange.mock.lastCall).toEqual([-10, 0])
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(slider(STEREO_START)).toHaveAttribute('aria-valuenow', '-10')
  await slider(STEREO_END).click()
  await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
  await expect.element(slider(STEREO_END)).toHaveAttribute('aria-valuenow', '0')
  expect(onChange.mock.lastCall).toEqual([-10, 0])
})

it('moves both edges by the same amount when dragged inside, and stops at the ends', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Stereo initial={[-50, 0]} onChange={onChange} />)
  const span = page.elementLocator(document.querySelector('[data-range-span]')!)
  const width = track().getBoundingClientRect().width
  await drag(span, width / 4, 0, { pointerType: 'mouse' })
  await expect.poll(() => onChange.mock.lastCall).toEqual([0, 50])
  await drag(span, width, 0, { pointerType: 'mouse' })
  await expect.poll(() => onChange.mock.lastCall).toEqual([50, 100])
  await drag(span, -2 * width, 0, { pointerType: 'mouse' })
  await expect.poll(() => onChange.mock.lastCall).toEqual([-100, -50])
})

it('drags one edge on its own', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Stereo initial={[-50, 50]} onChange={onChange} />)
  const width = track().getBoundingClientRect().width
  await drag(slider(STEREO_END), -width / 4, 0, { pointerType: 'mouse' })
  await expect.poll(() => onChange.mock.lastCall).toEqual([-50, 0])
})

it('places 40 Hz and 16 kHz at the ends of the log scale, and their geometric mean between', async () => {
  renderWithProviders(<Frequency initial={[40, 16000]} />)
  await expect.element(slider(FREQUENCY_LOW)).toBeInTheDocument()
  const rect = track().getBoundingClientRect()
  await expect.poll(() => centerX(slider(FREQUENCY_LOW).element())).toBeCloseTo(rect.left, 0)
  expect(centerX(slider(FREQUENCY_HIGH).element())).toBeCloseTo(rect.right, 0)
  await expect.element(slider(FREQUENCY_HIGH)).toHaveAttribute('aria-valuetext', '16 kHz')
})

it('steps the log scale by octaves, in whole Hz', async () => {
  renderWithProviders(<Frequency initial={[800, 16000]} />)
  const rect = track().getBoundingClientRect()
  await expect
    .poll(() => centerX(slider(FREQUENCY_LOW).element()))
    .toBeCloseTo(rect.left + rect.width / 2, 0)
  await slider(FREQUENCY_LOW).click()
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
  await expect.element(slider(FREQUENCY_LOW)).toHaveAttribute('aria-valuenow', '1600')
  await userEvent.keyboard('{ArrowLeft}')
  // 1600 Hz down a semitone is 1510.2 Hz.
  await expect.element(slider(FREQUENCY_LOW)).toHaveAttribute('aria-valuenow', '1510')
})

it('keeps the high edge a third of an octave over the low one', async () => {
  renderWithProviders(<Frequency initial={[1000, 1600]} />)
  await slider(FREQUENCY_HIGH).click()
  await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
  // A third of an octave over 1000 Hz is 1259.9 Hz.
  await expect.element(slider(FREQUENCY_HIGH)).toHaveAttribute('aria-valuenow', '1260')
})

/** The middle of the range, which an edge's target can cover when the range is short. */
const span = () => document.querySelector<HTMLElement>('[data-range-span]')!

/** A press on `target` at `x`, moved to each of `moves` in turn, then `end`. */
function press(
  target: HTMLElement,
  x: number,
  moves: number[],
  end: 'pointerup' | 'pointercancel',
) {
  const fire = (type: string, clientX: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 3,
        pointerType: 'mouse',
        button: 0,
        buttons: type === end ? 0 : 1,
        clientX,
      }),
    )
  fire('pointerdown', x)
  for (const to of moves) fire('pointermove', to)
  fire(end, moves.at(-1) ?? x)
}

it('moves a log range whole by the same number of octaves, never under the shortest span', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Frequency initial={[1000, 1260]} onChange={onChange} />)
  await expect.element(slider(FREQUENCY_LOW)).toBeInTheDocument()
  const width = track().getBoundingClientRect().width
  const octaves = Math.log2(16000 / 40)
  // Far enough down that each edge, rounded on its own, lands short of a third of an octave.
  const dx = -59 * (width / 368)
  press(span(), 100, [100 + dx], 'pointerup')
  await expect.poll(() => onChange.mock.calls.length).toBe(1)
  const [low, high] = onChange.mock.lastCall!
  expect(Math.log2(high / low)).toBeGreaterThanOrEqual(1 / 3)
  expect(Math.log2(low / 1000)).toBeCloseTo((dx / width) * octaves, 2)
  expect(Math.abs(Math.log2(high / low) - Math.log2(1260 / 1000))).toBeLessThan(0.01)
})

it('puts the range back when a drag is cancelled', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Stereo initial={[-50, 0]} onChange={onChange} />)
  await expect.element(slider(STEREO_START)).toBeInTheDocument()
  const width = track().getBoundingClientRect().width
  press(span(), 100, [100 + width / 8, 100 + width / 4], 'pointercancel')
  await expect.poll(() => onChange.mock.lastCall).toEqual([-50, 0])
  expect(onChange.mock.calls[0]).not.toEqual([-50, 0])
  await expect.element(slider(STEREO_START)).toHaveAttribute('aria-valuenow', '-50')
})

it('announces a stereo edge at center by its band alone', async () => {
  renderWithProviders(<Stereo initial={[-10, 5]} onChange={vi.fn()} />)
  await expect.element(slider(STEREO_END)).toHaveAttribute('aria-valuetext', 'Center, 5 right')
  await slider(STEREO_END).click()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.element(slider(STEREO_END)).toHaveAttribute('aria-valuetext', 'Center')
})
