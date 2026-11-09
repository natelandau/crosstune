import { MotionConfig } from 'motion/react'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { elementStill, pollStill } from '../test/stillPoll'
import { Stepper } from './Stepper'
import { fire, POINTER_ID } from '../test/gestures'

const format = (n: number) => (n < 0 ? `−${-n}` : n > 0 ? `+${n}` : '0')

function Harness({
  start = 0,
  min = -12,
  max = 12,
  onChange,
}: {
  start?: number
  min?: number
  max?: number
  onChange?: (n: number) => void
}) {
  const [value, setValue] = useState(start)
  return (
    <Stepper
      label="Semitones"
      value={value}
      min={min}
      max={max}
      format={format}
      decrementLabel="Down"
      incrementLabel="Up"
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

const group = () => page.getByRole('group', { name: 'Semitones' })
const up = () => page.getByRole('button', { name: 'Up' })
const down = () => page.getByRole('button', { name: 'Down' })
const reading = () => group().element().querySelector('output')!

const startTransform = () => {
  const effect = reading().getAnimations({ subtree: true })[0]?.effect as KeyframeEffect
  return effect.getKeyframes()[0]?.transform
}

const pointer = (target: Element, type: string, pointerType: 'mouse' | 'touch' = 'mouse') =>
  fire(target, type, undefined, pointerType)

const hold = (name: string) => pointer(page.getByRole('button', { name }).element(), 'pointerdown')
const release = (name: string) => {
  const button = page.getByRole('button', { name }).element() as HTMLElement
  pointer(button, 'pointerup')
  // The click a real pointer sequence ends with.
  button.click()
}

async function withFakeTimers(run: () => Promise<void>) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await run()
  } finally {
    vi.useRealTimers()
  }
}

it('steps on press', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness onChange={onChange} />)
  await elementStill(group()).toBeVisible()
  ;(up().element() as HTMLElement).click()
  await pollStill(() => onChange.mock.calls).toEqual([[1]])
  await elementStill(page.getByRole('status', { name: 'Semitones' })).toHaveTextContent('+1')
  ;(down().element() as HTMLElement).click()
  await pollStill(() => reading().textContent).toBe('0')
  ;(down().element() as HTMLElement).click()
  await pollStill(() => reading().textContent).toBe('−1')
})

it('repeats while held and speeds up', async () => {
  await withFakeTimers(async () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)
    await elementStill(group()).toBeVisible()
    hold('Up')
    expect(onChange).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(449)
    expect(onChange).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(onChange).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(109)
    expect(onChange).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(onChange).toHaveBeenCalledTimes(3)
    // Five repeats at 110ms after the first, then 50ms apart.
    await vi.advanceTimersByTimeAsync(110 * 3)
    expect(onChange).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(110)
    expect(onChange).toHaveBeenCalledTimes(7)
    await vi.advanceTimersByTimeAsync(49)
    expect(onChange).toHaveBeenCalledTimes(7)
    await vi.advanceTimersByTimeAsync(1)
    expect(onChange).toHaveBeenCalledTimes(8)
    release('Up')
    await vi.advanceTimersByTimeAsync(500)
    expect(onChange).toHaveBeenCalledTimes(8)
  })
})

it('stops repeating at a limit', async () => {
  await withFakeTimers(async () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness start={10} onChange={onChange} />)
    await elementStill(group()).toBeVisible()
    hold('Up')
    await vi.advanceTimersByTimeAsync(450)
    await pollStill(() => reading().textContent).toBe('+12')
    const calls = onChange.mock.calls.length
    expect(calls).toBe(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onChange).toHaveBeenCalledTimes(calls)
    release('Up')
  })
})

it('stops repeating when the pointer leaves', async () => {
  await withFakeTimers(async () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)
    await elementStill(group()).toBeVisible()
    hold('Up')
    await vi.advanceTimersByTimeAsync(450)
    expect(onChange).toHaveBeenCalledTimes(2)
    // React derives a leave from pointerout.
    up()
      .element()
      .dispatchEvent(
        new PointerEvent('pointerout', {
          bubbles: true,
          pointerId: POINTER_ID,
          pointerType: 'mouse',
          relatedTarget: document.body,
        }),
      )
    await vi.advanceTimersByTimeAsync(1000)
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

it('stops repeating when the press is cancelled', async () => {
  await withFakeTimers(async () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)
    await elementStill(group()).toBeVisible()
    hold('Up')
    pointer(up().element(), 'pointercancel')
    await vi.advanceTimersByTimeAsync(1000)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

it('shakes and keeps focus when pressed at a limit', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness start={12} onChange={onChange} />)
  await elementStill(group()).toBeVisible()
  await expect.element(up()).toHaveAttribute('aria-disabled', 'true')
  ;(up().element() as HTMLElement).focus()
  ;(up().element() as HTMLElement).click()
  await pollStill(() => group().element().getAnimations()).toHaveLength(1)
  await elementStill(up()).toHaveFocus()
  expect(onChange).not.toHaveBeenCalled()
})

it('slides the new value in from the pressed side', async () => {
  renderWithProviders(<Harness />)
  await elementStill(group()).toBeVisible()
  const from = async (button: () => ReturnType<typeof up>) => {
    ;(button().element() as HTMLElement).click()
    await pollStill(() => reading().getAnimations({ subtree: true }).length).toBeGreaterThan(0)
    return startTransform()
  }
  expect(await from(up)).toContain('translateY(70%)')
  await pollStill(() => reading().getAnimations({ subtree: true })).toHaveLength(0)
  expect(await from(down)).toContain('translateY(-70%)')
})

it('only fades the value under reduced motion', async () => {
  renderWithProviders(
    <MotionConfig reducedMotion="always">
      <Harness />
    </MotionConfig>,
  )
  await elementStill(group()).toBeVisible()
  ;(up().element() as HTMLElement).click()
  await pollStill(() => reading().getAnimations({ subtree: true }).length).toBeGreaterThan(0)
  expect(startTransform()).toBe('none')
})

it('changes the value with arrow keys', async () => {
  renderWithProviders(<Harness />)
  await elementStill(group()).toBeVisible()
  ;(up().element() as HTMLElement).focus()
  await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowDown}')
  await elementStill(page.getByRole('status', { name: 'Semitones' })).toHaveTextContent('+1')
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowRight}')
  await pollStill(() => reading().textContent).toBe('0')
})

it('keeps its width as the value changes', async () => {
  renderWithProviders(<Harness />)
  await elementStill(group()).toBeVisible()
  const width = () => group().element().getBoundingClientRect().width
  ;(up().element() as HTMLElement).focus()
  const start = width()
  for (const key of Array(12).fill('{ArrowUp}')) {
    await userEvent.keyboard(key)
  }
  await pollStill(() => reading().textContent).toBe('+12')
  expect(width()).toBe(start)
})

it.each([
  [72, 'Up', 75],
  [72, 'Down', 70],
  [70, 'Up', 75],
  [70, 'Down', 65],
])('steps %i %s onto the grid measured from min', async (start, button, expected) => {
  const onChange = vi.fn()
  renderWithProviders(
    <Stepper
      label="Speed"
      value={start}
      min={50}
      max={150}
      step={5}
      format={String}
      decrementLabel="Down"
      incrementLabel="Up"
      onChange={onChange}
    />,
  )
  ;(page.getByRole('button', { name: button }).element() as HTMLElement).click()
  await pollStill(() => onChange.mock.calls).toEqual([[expected]])
})

it('steps a touch on release, so a scroll that cancels the press changes nothing', async () => {
  await withFakeTimers(async () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)
    await elementStill(group()).toBeVisible()
    const button = up().element()
    pointer(button, 'pointerdown', 'touch')
    pointer(button, 'pointercancel', 'touch')
    await vi.advanceTimersByTimeAsync(1000)
    expect(onChange).not.toHaveBeenCalled()
    pointer(button, 'pointerdown', 'touch')
    expect(onChange).not.toHaveBeenCalled()
    pointer(button, 'pointerup', 'touch')
    ;(button as HTMLElement).click()
    await pollStill(() => onChange.mock.calls).toEqual([[1]])
  })
})

it('repeats a touch hold after the first delay, and steps no more on release', async () => {
  await withFakeTimers(async () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)
    await elementStill(group()).toBeVisible()
    const button = up().element()
    pointer(button, 'pointerdown', 'touch')
    await vi.advanceTimersByTimeAsync(449)
    expect(onChange).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(110)
    expect(onChange).toHaveBeenCalledTimes(2)
    pointer(button, 'pointerup', 'touch')
    ;(button as HTMLElement).click()
    await vi.advanceTimersByTimeAsync(500)
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

it('stops repeating when it unmounts mid-hold', async () => {
  await withFakeTimers(async () => {
    const onChange = vi.fn()
    const { unmount } = renderWithProviders(<Harness onChange={onChange} />)
    await elementStill(group()).toBeVisible()
    hold('Up')
    expect(onChange).toHaveBeenCalledTimes(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

it('animates no value change that came from outside', async () => {
  function Outside() {
    const [value, setValue] = useState(0)
    return (
      <>
        <button onClick={() => setValue((v) => v + 1)}>Outside</button>
        <Stepper
          label="Semitones"
          value={value}
          min={-12}
          max={12}
          format={format}
          decrementLabel="Down"
          incrementLabel="Up"
          onChange={setValue}
        />
      </>
    )
  }
  renderWithProviders(<Outside />)
  await elementStill(group()).toBeVisible()
  ;(page.getByRole('button', { name: 'Outside' }).element() as HTMLElement).click()
  await pollStill(() => reading().textContent).toBe('+1')
  expect(reading().getAnimations({ subtree: true })).toHaveLength(0)
})

it('steps on from the last value it sent while the parent catches up', async () => {
  await withFakeTimers(async () => {
    const onChange = vi.fn()
    // A parent that takes the change but never renders it, as one waiting on a write does.
    renderWithProviders(
      <Stepper
        label="Semitones"
        value={0}
        min={-12}
        max={12}
        format={format}
        decrementLabel="Down"
        incrementLabel="Up"
        onChange={onChange}
      />,
    )
    await elementStill(group()).toBeVisible()
    hold('Up')
    await vi.advanceTimersByTimeAsync(450 + 110)
    release('Up')
    expect(onChange.mock.calls).toEqual([[1], [2], [3]])
  })
})

it('steps a fractional step without drifting off the grid', async () => {
  const onChange = vi.fn()
  renderWithProviders(
    <Stepper
      label="Gain"
      value={0.3}
      min={0}
      max={1}
      step={0.1}
      format={String}
      decrementLabel="Down"
      incrementLabel="Up"
      onChange={onChange}
    />,
  )
  ;(page.getByRole('button', { name: 'Up' }).element() as HTMLElement).click()
  await pollStill(() => onChange.mock.calls.length).toBe(1)
  expect(onChange.mock.calls[0]![0]).toBeCloseTo(0.4, 10)
})

it('leaves an arrow key held with a modifier to the browser', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness onChange={onChange} />)
  await elementStill(group()).toBeVisible()
  ;(up().element() as HTMLElement).focus()
  await userEvent.keyboard(
    '{Meta>}{ArrowUp}{/Meta}{Alt>}{ArrowUp}{/Alt}{Control>}{ArrowUp}{/Control}',
  )
  await userEvent.keyboard('{ArrowUp}')
  await pollStill(() => onChange.mock.calls).toEqual([[1]])
})

it('rings the whole block, not the focused button inside it', async () => {
  renderWithProviders(<Harness />)
  await elementStill(group()).toBeVisible()
  await userEvent.keyboard('{Tab}')
  await elementStill(down()).toHaveFocus()
  const button = down().element()
  await pollStill(() => getComputedStyle(group().element()).outlineStyle).toBe('solid')
  expect(getComputedStyle(button).outlineStyle).toBe('none')
})

it('forgets a step the parent declines', async () => {
  const onChange = vi.fn()
  function Declines() {
    const [value, setValue] = useState(0)
    return (
      <>
        <button onClick={() => setValue(5)}>Reset</button>
        <Stepper
          label="Semitones"
          value={value}
          min={-12}
          max={12}
          format={format}
          decrementLabel="Down"
          incrementLabel="Up"
          onChange={onChange}
        />
      </>
    )
  }
  renderWithProviders(<Declines />)
  await elementStill(group()).toBeVisible()
  ;(up().element() as HTMLElement).click()
  await pollStill(() => onChange.mock.calls).toEqual([[1]])
  ;(up().element() as HTMLElement).click()
  await pollStill(() => onChange.mock.calls).toEqual([[1], [1]])
  ;(page.getByRole('button', { name: 'Reset' }).element() as HTMLElement).click()
  await pollStill(() => reading().textContent).toBe('+5')
  expect(reading().getAnimations({ subtree: true })).toHaveLength(0)
  ;(up().element() as HTMLElement).focus()
  await userEvent.keyboard('{ArrowUp}')
  await pollStill(() => onChange.mock.calls).toEqual([[1], [1], [6]])
})
