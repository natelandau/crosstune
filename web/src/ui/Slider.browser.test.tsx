import { useState } from 'react'
import { page } from 'vitest/browser'
import { afterEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { elementStill, pollStill } from '../test/stillPoll'
import { Slider } from './Slider'
import { fire } from '../test/gestures'

const format = (n: number) => `${n}%`

function Harness({ start = 65, onChange }: { start?: number; onChange?: (n: number) => void }) {
  const [value, setValue] = useState(start)
  return (
    <div style={{ width: 320 }}>
      <Slider
        label="Volume"
        value={value}
        min={0}
        max={100}
        step={5}
        largeStep={25}
        detent={50}
        snapRange={8}
        format={format}
        decrementLabel="Quieter"
        incrementLabel="Louder"
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
      />
    </div>
  )
}

const thumb = () => page.getByRole('slider', { name: 'Volume' })
const reading = () => page.getByRole('status', { name: 'Volume' })
const track = () => document.querySelector<HTMLElement>('[data-slider-track]')!
const thumbBox = () => thumb().element().closest('[data-slider-thumb]')!

afterEach(() => vi.restoreAllMocks())

// Presses the thumb, moves to each fraction of the track in turn, and releases.
function drag(...fractions: number[]) {
  const box = thumbBox().getBoundingClientRect()
  const rect = track().getBoundingClientRect()
  const y = rect.top + rect.height / 2
  fire(thumbBox(), 'pointerdown', { x: box.left + box.width / 2, y })
  for (const fraction of fractions) {
    fire(document, 'pointermove', { x: rect.left + rect.width * fraction, y })
  }
  fire(document, 'pointerup', { x: rect.left + rect.width * fractions.at(-1)!, y })
}

/** How many animations the spy saw start on the thumb, which only a snap animates. */
const pulses = (spy: { mock: { contexts: unknown[] } }) =>
  spy.mock.contexts.filter((element) => element === thumbBox()).length

it.each(['pointer', 'touch'] as const)(
  'draws its own track and thumb at %s density',
  async (density) => {
    renderWithProviders(<Harness />, { density })
    await elementStill(thumb()).toBeInTheDocument()
    const input = document.querySelector<HTMLInputElement>('input[type="range"]')!
    // React Aria hides the input in a one-pixel clipped wrapper.
    const inputBox = input.parentElement!.getBoundingClientRect()
    expect(inputBox.width * inputBox.height).toBeLessThanOrEqual(1)
    await pollStill(() => thumbBox().getBoundingClientRect().width).toBeGreaterThan(1)
    expect(thumbBox().getBoundingClientRect().height).toBeGreaterThan(1)
  },
)

it.each(['pointer', 'touch'] as const)(
  'centers the thumb on the track at %s density',
  async (density) => {
    renderWithProviders(<Harness />, { density })
    await elementStill(thumb()).toBeInTheDocument()
    const track = document.querySelector('[data-slider-track]')!.getBoundingClientRect()
    const box = thumbBox().getBoundingClientRect()
    await pollStill(() => Math.round(box.top + box.height / 2)).toBe(
      Math.round(track.top + track.height / 2),
    )
  },
)

it('snaps to the detent when dragged near it and pulses once', async () => {
  const animate = vi.spyOn(HTMLElement.prototype, 'animate')
  const onChange = vi.fn()
  renderWithProviders(<Harness onChange={onChange} />)
  await elementStill(thumb()).toBeInTheDocument()
  // 60 is outside the snap range of 8, so the drag enters the detent on the way to 55 and 53.
  drag(0.58, 0.54, 0.53)
  await pollStill(() => onChange.mock.calls.map(([v]) => v)).toEqual([60, 50])
  await elementStill(reading()).toHaveTextContent('50%')
  expect(pulses(animate)).toBe(1)
  expect(document.querySelector('[data-detent-tick]')!.getAttribute('data-snapped')).toBe('true')
})

it('does not snap away from the detent', async () => {
  renderWithProviders(<Harness />)
  await elementStill(thumb()).toBeInTheDocument()
  drag(0.8)
  await elementStill(reading()).toHaveTextContent('80%')
  expect(document.querySelector('[data-detent-tick]')!.getAttribute('data-snapped')).toBe('false')
})

it('steps through the detent with the keyboard without pulsing', async () => {
  const animate = vi.spyOn(HTMLElement.prototype, 'animate')
  const onChange = vi.fn()
  renderWithProviders(<Harness start={45} onChange={onChange} />)
  await elementStill(thumb()).toBeInTheDocument()
  const input = thumb().element() as HTMLElement
  input.focus()
  const press = (key: string) => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
  }
  press('ArrowRight')
  await elementStill(reading()).toHaveTextContent('50%')
  press('ArrowRight')
  await elementStill(reading()).toHaveTextContent('55%')
  expect(onChange.mock.calls.map(([v]) => v)).toEqual([50, 55])
  expect(pulses(animate)).toBe(0)
})

it('steps larger with Shift', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness start={40} onChange={onChange} />)
  await elementStill(thumb()).toBeInTheDocument()
  const input = thumb().element() as HTMLElement
  input.focus()
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )
  await pollStill(() => onChange.mock.calls.map(([v]) => v)).toEqual([65])
})

it.each([
  ['ArrowRight', 60],
  ['ArrowLeft', 15],
])('lands an off-grid value on the grid with Shift and %s', async (key, landed) => {
  const onChange = vi.fn()
  renderWithProviders(<Harness start={37} onChange={onChange} />)
  await elementStill(thumb()).toBeInTheDocument()
  const input = thumb().element() as HTMLElement
  input.focus()
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true, cancelable: true }),
  )
  await pollStill(() => onChange.mock.calls.map(([v]) => v)).toEqual([landed])
})

it('keeps the readout stepper and the track in step', async () => {
  renderWithProviders(<Harness start={65} />)
  await elementStill(thumb()).toBeInTheDocument()
  const left = () => thumbBox().getBoundingClientRect().left
  const before = left()
  ;(page.getByRole('button', { name: 'Louder' }).element() as HTMLElement).click()
  await elementStill(reading()).toHaveTextContent('70%')
  await pollStill(left).toBeGreaterThan(before)
  drag(0.2)
  await elementStill(reading()).toHaveTextContent('20%')
  await elementStill(thumb()).toHaveValue('20')
})

it('names one group, the slider, and keeps the stepper buttons named', async () => {
  renderWithProviders(<Harness />)
  await elementStill(thumb()).toBeInTheDocument()
  expect(page.getByRole('group', { name: 'Volume' }).elements()).toHaveLength(1)
  await elementStill(page.getByRole('button', { name: 'Louder' })).toBeVisible()
  await elementStill(page.getByRole('button', { name: 'Quieter' })).toBeVisible()
})

it('animates no readout change while dragged', async () => {
  renderWithProviders(<Harness start={65} />)
  await elementStill(thumb()).toBeInTheDocument()
  const animate = vi.spyOn(HTMLElement.prototype, 'animate')
  drag(0.2)
  await elementStill(reading()).toHaveTextContent('20%')
  const readout = reading().element()
  expect(animate.mock.contexts.filter((element) => readout.contains(element as Node))).toEqual([])
})
