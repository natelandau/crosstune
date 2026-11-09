import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderWithProviders } from '../test/render'
import { RangeHandles, type RangeGrab } from './RangeHandles'
import { fire, POINTER_ID } from '../test/gestures'

const WIDTH_PX = 400
const START = 'Start'
const END = 'End'

function Range({
  initial,
  minSpan = 0.1,
  moveSpan = false,
  onChange = () => {},
  onCommit,
  onCancel,
  onPressChange,
  pointerMode = false,
}: {
  initial: [number, number]
  minSpan?: number
  moveSpan?: boolean
  onChange?: (start: number, end: number) => void
  onCommit?: (start: number, end: number) => void
  onCancel?: () => void
  onPressChange?: (grab: RangeGrab | null) => void
  /** A `pointer` press in place of a `travel` one, which takes neither `moveSpan` nor `onCancel`. */
  pointerMode?: boolean
}) {
  const [[start, end], setRange] = useState(initial)
  const drag = pointerMode ? { dragMode: 'pointer' as const } : { moveSpan, onCancel }
  return (
    <div style={{ width: WIDTH_PX, height: 44 }}>
      <RangeHandles
        start={start}
        end={end}
        minSpan={minSpan}
        {...drag}
        color={1}
        className="h-full"
        startLabel={START}
        endLabel={END}
        step={0.05}
        largeStep={0.2}
        onChange={(nextStart, nextEnd) => {
          setRange([nextStart, nextEnd])
          onChange(nextStart, nextEnd)
        }}
        onCommit={onCommit}
        onPressChange={onPressChange}
      />
    </div>
  )
}

const slider = (name: string) => page.getByRole('slider', { name })
const edge = (which: 'start' | 'end') =>
  document.querySelector<HTMLElement>(`[data-handle="${which}"]`)!
const span = () => document.querySelector<HTMLElement>('[data-range-span]')!

/** Fires a mouse press on `target` at its center, moved by each of `moves` px in turn. */
function pressAndMove(target: HTMLElement, moves: number[]) {
  const rect = target.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const at = (clientX: number) => ({ x: clientX, y: 0 })
  fire(target, 'pointerdown', at(x))
  for (const by of moves) fire(target, 'pointermove', at(x + by))
  return { release: () => fire(target, 'pointerup', at(x + (moves.at(-1) ?? 0))) }
}

const lastCall = (mock: ReturnType<typeof vi.fn>) => mock.mock.lastCall as [number, number]

it('moves one end when its grip is dragged', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Range initial={[0.2, 0.8]} onChange={onChange} />)
  await expect.element(slider(END)).toBeInTheDocument()
  pressAndMove(edge('end'), [-WIDTH_PX / 8, -WIDTH_PX / 4]).release()
  await expect.poll(() => onChange.mock.calls.length).toBe(2)
  const [start, end] = lastCall(onChange)
  expect(start).toBe(0.2)
  expect(end).toBeCloseTo(0.55, 5)
})

it('moves both ends when the span is dragged and moveSpan is set', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Range initial={[0.2, 0.5]} moveSpan onChange={onChange} />)
  await expect.element(slider(END)).toBeInTheDocument()
  pressAndMove(span(), [WIDTH_PX / 4]).release()
  await expect.poll(() => onChange.mock.calls.length).toBe(1)
  const [start, end] = lastCall(onChange)
  expect(start).toBeCloseTo(0.45, 5)
  expect(end).toBeCloseTo(0.75, 5)
  // Past the end it stops there, the span's length kept.
  pressAndMove(span(), [WIDTH_PX]).release()
  await expect.poll(() => onChange.mock.calls.length).toBe(2)
  expect(lastCall(onChange)[0]).toBeCloseTo(0.7, 5)
  expect(lastCall(onChange)[1]).toBeCloseTo(1, 5)
})

it('does not move the span when moveSpan is off', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Range initial={[0.2, 0.5]} onChange={onChange} />)
  await expect.element(slider(END)).toBeInTheDocument()
  expect(getComputedStyle(span()).pointerEvents).toBe('none')
  pressAndMove(span(), [WIDTH_PX / 4]).release()
  pressAndMove(edge('end'), [WIDTH_PX / 4]).release()
  await expect.poll(() => onChange.mock.calls.length).toBe(1)
  expect(lastCall(onChange)[0]).toBe(0.2)
})

it('springs back when a drag is cancelled', async () => {
  const onChange = vi.fn()
  const onCancel = vi.fn()
  const onCommit = vi.fn()
  renderWithProviders(
    <Range initial={[0.2, 0.8]} onChange={onChange} onCancel={onCancel} onCommit={onCommit} />,
  )
  await expect.element(slider(END)).toBeInTheDocument()
  const press = pressAndMove(edge('end'), [-WIDTH_PX / 4])
  await expect.poll(() => onChange.mock.calls.length).toBe(1)
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => onCancel.mock.calls.length).toBe(1)
  expect(lastCall(onChange)).toEqual([0.2, 0.8])
  await expect.element(slider(END)).toHaveAttribute('aria-valuenow', '0.8')
  // The press is over, so letting go writes nothing.
  press.release()
  await expect.element(slider(END)).toHaveAttribute('aria-valuenow', '0.8')
  expect(onCommit).not.toHaveBeenCalled()
})

it('steps with arrow keys and Shift', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Range initial={[0.2, 0.8]} onChange={onChange} />)
  await slider(START).click()
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => onChange.mock.calls.length).toBe(1)
  expect(lastCall(onChange)[0]).toBeCloseTo(0.25, 5)
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
  await expect.poll(() => onChange.mock.calls.length).toBe(2)
  expect(lastCall(onChange)[0]).toBeCloseTo(0.45, 5)
  await slider(END).click()
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(() => onChange.mock.calls.length).toBe(3)
  expect(lastCall(onChange)[1]).toBeCloseTo(0.75, 5)
})

it('never lets the span shrink under minSpan', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Range initial={[0.2, 0.8]} minSpan={0.2} onChange={onChange} />)
  await slider(START).click()
  // Two large steps reach the shortest span; the third stays put, so the step back starts there.
  await userEvent.keyboard('{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}{ArrowLeft}')
  await expect.poll(() => onChange.mock.calls.length).toBe(3)
  expect(onChange.mock.calls[1]![0]).toBeCloseTo(0.6, 5)
  expect(lastCall(onChange)[0]).toBeCloseTo(0.55, 5)
  pressAndMove(edge('end'), [-WIDTH_PX]).release()
  await expect.poll(() => onChange.mock.calls.length).toBe(4)
  expect(lastCall(onChange)[1]).toBeCloseTo(0.75, 5)
})

it('commits once when a drag lets go', async () => {
  const onCommit = vi.fn()
  renderWithProviders(<Range initial={[0.2, 0.8]} onCommit={onCommit} />)
  await expect.element(slider(END)).toBeInTheDocument()
  pressAndMove(edge('end'), [-WIDTH_PX / 8, -WIDTH_PX / 4]).release()
  await expect.poll(() => onCommit.mock.calls.length).toBe(1)
  expect(onCommit.mock.lastCall![0]).toBe(0.2)
  expect(onCommit.mock.lastCall![1]).toBeCloseTo(0.55, 5)
})

it('leaves nothing listening once it unmounts mid-press', async () => {
  const onChange = vi.fn()
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  const travel = renderWithProviders(
    <Range initial={[0.2, 0.8]} onChange={onChange} onCommit={onCommit} onCancel={onCancel} />,
  )
  await expect.element(slider(END)).toBeInTheDocument()
  pressAndMove(edge('end'), [-WIDTH_PX / 4])
  await expect.poll(() => onChange.mock.calls.length).toBe(1)
  await travel.unmount()

  const pointer = renderWithProviders(
    <Range initial={[0.2, 0.8]} onChange={onChange} onCommit={onCommit} pointerMode />,
  )
  await expect.element(slider(END)).toBeInTheDocument()
  pressAndMove(edge('end'), [-WIDTH_PX / 4])
  await expect.poll(() => onChange.mock.calls.length).toBe(2)
  await pointer.unmount()

  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: POINTER_ID }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  // Mount and step a fresh range, so the calls below are known to have landed after the events.
  renderWithProviders(<Range initial={[0.2, 0.8]} />)
  await slider(START).click()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(slider(START)).not.toHaveAttribute('aria-valuenow', '0.2')
  expect(onChange).toHaveBeenCalledTimes(2)
  expect(onCommit).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
})

it('puts a pointer edge where the pointer is and ends the press on any pointerup', async () => {
  const onChange = vi.fn()
  const onPressChange = vi.fn()
  renderWithProviders(
    <Range initial={[0.2, 0.8]} onChange={onChange} onPressChange={onPressChange} pointerMode />,
  )
  await expect.element(slider(END)).toBeInTheDocument()
  const track = document.querySelector<HTMLElement>('[data-range-track]')!.getBoundingClientRect()
  const target = edge('end')
  const move = (type: string, at: number) =>
    fire(target, type, { x: track.left + at * track.width, y: 0 })
  // Pressed off the line, the edge still lands under the pointer, with no threshold to cross.
  move('pointerdown', 0.81)
  await expect.poll(() => onPressChange.mock.lastCall).toEqual(['end'])
  move('pointermove', 0.805)
  await expect.poll(() => onChange.mock.calls.length).toBe(1)
  expect(lastCall(onChange)[1]).toBeCloseTo(0.805, 5)
  move('pointermove', 0.5)
  await expect.poll(() => onChange.mock.calls.length).toBe(2)
  expect(lastCall(onChange)[1]).toBeCloseTo(0.5, 5)

  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9 }))
  await expect.poll(() => onPressChange.mock.lastCall).toEqual([null])
  move('pointermove', 0.7)
  await slider(START).click()
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => onChange.mock.calls.length).toBe(3)
  expect(lastCall(onChange)).toEqual([expect.closeTo(0.25, 5), expect.closeTo(0.5, 5)])
})
