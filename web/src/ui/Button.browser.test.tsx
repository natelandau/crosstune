import { page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { emulateReducedMotion } from '../test/reducedMotion'
import { elementStill, pollStill } from '../test/stillPoll'
import { Button } from './Button'
import { DONE, WORKING } from './WorkingMark'
import type { TrackWork } from './useWorking'
import { InRow } from './inRow'
import { Capsule } from './Capsule'
import { InBar } from './inBar'
import { removeFilterLabel } from './filterCopy'
import { fire } from '../test/gestures'

it('fills a set capsule with the set filter tint', async () => {
  renderWithProviders(
    <>
      <Capsule label="Key: Any" />
      <Capsule label="Key: D" set />
    </>,
  )
  const fill = (name: string) =>
    getComputedStyle(page.getByRole('button', { name }).element()).backgroundColor
  await expect.poll(() => fill('Key: D')).not.toBe(fill('Key: Any'))
})

it("names a token's remove control", async () => {
  renderWithProviders(
    <Capsule label="Reel" set onRemove={() => {}} removeLabel={removeFilterLabel('Reel')} />,
  )
  await expect.element(page.getByRole('button', { name: removeFilterLabel('Reel') })).toBeVisible()
})

it('takes an accessible name that differs from its visible label', async () => {
  renderWithProviders(<Button label="Link" name="Link The Silver Spear" />)
  const button = page.getByRole('button', { name: 'Link The Silver Spear', exact: true })
  await expect.element(button).toBeVisible()
  await expect.element(button).toHaveTextContent('Link')
})

it('shows a focus ring on keyboard focus only', async () => {
  renderWithProviders(<Button label="Save" variant="primary" />)
  const save = () => getComputedStyle(page.getByRole('button', { name: 'Save' }).element())
  await expect.poll(() => save().outlineStyle).not.toBe('solid')
  await userEvent.keyboard('{Tab}')
  await expect.poll(() => save().outlineStyle).toBe('solid')
})

it('keeps a capsule hit area at the filter target on touch', async () => {
  renderWithProviders(<Capsule label="Key: D" />, { density: 'touch' })
  const capsule = page.getByRole('button', { name: 'Key: D' })
  await expect.element(capsule).toBeVisible()
  const hit = () => getComputedStyle(capsule.element(), '::after').height
  await expect.poll(hit).toBe('44px')
})

it('sets a primary button in semibold over the body role', async () => {
  renderWithProviders(<Button label="Save" variant="primary" />)
  const weight = () =>
    getComputedStyle(page.getByRole('button', { name: 'Save' }).element()).fontWeight
  await expect.poll(weight).toBe('600')
})

it.each([
  ['touch', 44],
  ['pointer', 24],
] as const)("a token's remove control reaches the %s target in both axes", async (density, min) => {
  renderWithProviders(
    <Capsule label="Reel" set onRemove={() => {}} removeLabel={removeFilterLabel('Reel')} />,
    {
      density,
    },
  )
  const remove = page.getByRole('button', { name: removeFilterLabel('Reel') })
  await expect.element(remove).toBeVisible()
  await expect
    .poll(() => remove.element().getBoundingClientRect().width)
    .toBeGreaterThanOrEqual(min)
  await expect
    .poll(() => parseFloat(getComputedStyle(remove.element(), '::after').height))
    .toBeGreaterThanOrEqual(min)
  const body = page
    .getByRole('button', { name: 'Reel', exact: true })
    .element()
    .getBoundingClientRect()
  expect(remove.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(body.right)
})

it.each([
  ['a capsule', <Capsule key="c" label="Key: D" />, 'Key: D'],
  [
    'a token',
    <Capsule
      key="t"
      label="Reel"
      set
      onRemove={() => {}}
      removeLabel={removeFilterLabel('Reel')}
    />,
    'Reel',
  ],
  [
    'a token remove control',
    <Capsule
      key="r"
      label="Reel"
      set
      onRemove={() => {}}
      removeLabel={removeFilterLabel('Reel')}
    />,
    removeFilterLabel('Reel'),
  ],
] as const)('squeezes %s while it is pressed', async (_, ui, name) => {
  renderWithProviders(ui)
  const button = page.getByRole('button', { name, exact: true })
  await expect.element(button).toBeVisible()
  const scale = () => getComputedStyle(button.element()).scale
  const pointer = (type: string) => fire(button.element(), type)
  pointer('pointerdown')
  await expect.element(button).toHaveAttribute('data-pressed', 'true')
  await expect.poll(scale).toMatch(/^0\.96\b/)
  pointer('pointerup')
  await expect.poll(scale).toBe('none')
})

it('rounds a labeled button to the corner radius', async () => {
  renderWithProviders(
    <>
      <Button label="Save" variant="primary" />
      <Button label="Cancel" />
    </>,
  )
  const radius = (name: string) =>
    getComputedStyle(page.getByRole('button', { name, exact: true }).element()).borderTopLeftRadius
  await expect.poll(() => radius('Save')).toBe('8px')
  expect(radius('Cancel')).toBe('8px')
})

it('keeps a labeled button round in a bar', async () => {
  renderWithProviders(
    <InBar value>
      <Button label="Done" />
    </InBar>,
  )
  await expect
    .poll(() =>
      parseFloat(
        getComputedStyle(page.getByRole('button', { name: 'Done' }).element()).borderTopLeftRadius,
      ),
    )
    .toBeGreaterThan(1000)
})

it.each([
  ['pointer', 'regular', 28],
  ['touch', 'regular', 36],
  ['pointer', 'compact', 24],
  ['touch', 'compact', 32],
  ['pointer', 'large', 36],
  ['touch', 'large', 48],
] as const)('on %s, a %s button is %ipx tall', async (density, size, height) => {
  renderWithProviders(<Button label="Save" variant="primary" size={size} />, { density })
  const button = page.getByRole('button', { name: 'Save' })
  await expect.element(button).toBeVisible()
  await expect.poll(() => button.element().getBoundingClientRect().height).toBe(height)
})

it('is compact inside a row', async () => {
  renderWithProviders(
    <InRow.Provider value>
      <Button label="Save" variant="primary" />
    </InRow.Provider>,
  )
  const button = page.getByRole('button', { name: 'Save' })
  await expect.element(button).toBeVisible()
  await expect.poll(() => button.element().getBoundingClientRect().height).toBe(24)
})

it('extends its tap area to 44 on touch', async () => {
  renderWithProviders(
    <div className="p-10">
      <Button label="Save" variant="primary" size="compact" />
    </div>,
    { density: 'touch' },
  )
  const button = page.getByRole('button', { name: 'Save' })
  await expect.element(button).toBeVisible()
  const hit = (dy: 'above' | 'below') => {
    const box = button.element().getBoundingClientRect()
    const y = dy === 'above' ? box.top - 4 : box.bottom + 4
    return document.elementFromPoint(box.left + box.width / 2, y)
  }
  await expect.poll(() => hit('above')).toBe(button.element())
  expect(hit('below')).toBe(button.element())
})

it.each(['compact', 'regular'] as const)(
  'reaches 44 in both directions with a %s touch button',
  async (size) => {
    renderWithProviders(<Button label="OK" variant="primary" size={size} />, { density: 'touch' })
    const button = page.getByRole('button', { name: 'OK' })
    await expect.element(button).toBeVisible()
    const area = () => getComputedStyle(button.element(), '::after')
    await expect.poll(() => parseFloat(area().height)).toBeGreaterThanOrEqual(44)
    expect(parseFloat(area().width)).toBeGreaterThanOrEqual(44)
  },
)

it('keeps one status region through the work, empty while idle', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    renderWithProviders(<Button label="Save" variant="primary" onPress={settleAfter(500)} />)
    await expect.element(page.getByRole('button', { name: 'Save' })).toBeVisible()
    const region = page.getByRole('button', { name: 'Save' }).element().nextElementSibling!
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
    press('Save')
    await vi.advanceTimersByTimeAsync(300)
    await pollStill(() => region.textContent).toBe(WORKING)
    await vi.advanceTimersByTimeAsync(200)
    await pollStill(() => region.textContent).toBe(DONE)
    await vi.advanceTimersByTimeAsync(1200)
    await pollStill(() => region.textContent).toBe('')
    expect(page.getByRole('button', { name: 'Save' }).element().nextElementSibling).toBe(region)
  } finally {
    vi.useRealTimers()
  }
})

/** The live region beside a button that says its work is running or done. */
const announced = (name: string) =>
  page.getByRole('button', { name }).element().nextElementSibling?.textContent ?? null

/** Presses without a browser action, which would move a fake clock. */
function press(name: string) {
  ;(page.getByRole('button', { name }).element() as HTMLElement).click()
}

const width = (name: string) =>
  page.getByRole('button', { name }).element().getBoundingClientRect().width

/** Real CSS transitions run beside a fake clock, so only the button's own script animations. */
const scripted = (name: string) =>
  page
    .getByRole('button', { name })
    .element()
    .getAnimations()
    .filter((a) => !(a instanceof CSSTransition))

function settleAfter<T>(ms: number, value?: T, fail = false): () => Promise<T | undefined> {
  return () =>
    new Promise((resolve, reject) => {
      setTimeout(() => (fail ? reject(new Error('Offline')) : resolve(value)), ms)
    })
}

it('shows a spinner after 300ms of work, then a check, then the label', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    renderWithProviders(<Button label="Save" variant="primary" onPress={settleAfter(1400)} />)
    const button = page.getByRole('button', { name: 'Save' })
    const label = button.getByText('Save')
    await expect.element(label).toBeVisible()
    const before = width('Save')
    press('Save')
    await vi.advanceTimersByTimeAsync(299)
    await pollStill(() => announced('Save')).toBe('')
    await pollStill(() => getComputedStyle(label.element()).opacity).toBe('1')
    await vi.advanceTimersByTimeAsync(1)
    await pollStill(() => announced('Save')).toBe(WORKING)
    expect(width('Save')).toBe(before)
    await vi.advanceTimersByTimeAsync(1100)
    await pollStill(() => announced('Save')).toBe(DONE)
    expect(width('Save')).toBe(before)
    await vi.advanceTimersByTimeAsync(1200)
    await pollStill(() => announced('Save')).toBe('')
    await pollStill(() => getComputedStyle(label.element()).opacity).toBe('1')
    expect(width('Save')).toBe(before)
  } finally {
    vi.useRealTimers()
  }
})

it('shows only the check when work ends under 300ms', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    renderWithProviders(<Button label="Save" variant="primary" onPress={settleAfter(200)} />)
    const button = page.getByRole('button', { name: 'Save' })
    await expect.element(button).toBeVisible()
    press('Save')
    await vi.advanceTimersByTimeAsync(200)
    await pollStill(() => announced('Save')).toBe(DONE)
    await vi.advanceTimersByTimeAsync(400)
    expect(announced('Save')).toBe(DONE)
  } finally {
    vi.useRealTimers()
  }
})

it('returns the label and shakes on failure', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const onFailed = vi.fn()
    renderWithProviders(
      <Button
        label="Save"
        variant="primary"
        onPress={settleAfter(500, undefined, true)}
        onFailed={onFailed}
      />,
    )
    const button = page.getByRole('button', { name: 'Save' })
    await expect.element(button).toBeVisible()
    press('Save')
    await vi.advanceTimersByTimeAsync(500)
    await pollStill(() => onFailed).toHaveBeenCalledTimes(1)
    expect(onFailed.mock.calls[0]![0]).toBeInstanceOf(Error)
    await pollStill(() => announced('Save')).toBe('')
    expect(scripted('Save')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(announced('Save')).toBe('')
    await pollStill(() => getComputedStyle(button.getByText('Save').element()).opacity).toBe('1')
  } finally {
    vi.useRealTimers()
  }
})

it('ignores presses while working', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const work = vi.fn(settleAfter(1000))
    renderWithProviders(<Button label="Save" variant="primary" onPress={work} />)
    await expect.element(page.getByRole('button', { name: 'Save' })).toBeVisible()
    press('Save')
    await vi.advanceTimersByTimeAsync(400)
    press('Save')
    await pollStill(() => work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(work).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('skips the check when showDone is false', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const work = vi.fn(settleAfter(500))
    renderWithProviders(<Button label="Save" variant="primary" showDone={false} onPress={work} />)
    const button = page.getByRole('button', { name: 'Save' })
    await expect.element(button).toBeVisible()
    press('Save')
    await vi.advanceTimersByTimeAsync(300)
    await pollStill(() => announced('Save')).toBe(WORKING)
    await vi.advanceTimersByTimeAsync(200)
    await pollStill(() => announced('Save')).toBe('')
    expect(announced('Save')).toBe('')
    press('Save')
    await pollStill(() => work).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})

it('clears its timers when unmounted mid-work', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const error = vi.spyOn(console, 'error')
  try {
    const { unmount } = renderWithProviders(
      <Button label="Save" variant="primary" onPress={settleAfter(1400)} />,
    )
    await expect.element(page.getByRole('button', { name: 'Save' })).toBeVisible()
    press('Save')
    await vi.advanceTimersByTimeAsync(500)
    unmount()
    await vi.advanceTimersByTimeAsync(3000)
    expect(error).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    error.mockRestore()
    vi.useRealTimers()
  }
})

it('shakes and does not press when blocked', async () => {
  const onPress = vi.fn()
  renderWithProviders(<Button label="Save" variant="primary" isBlocked onPress={onPress} />)
  await expect.element(page.getByRole('button', { name: 'Save' })).toBeVisible()
  press('Save')
  await expect.poll(() => scripted('Save')).toHaveLength(1)
  expect(onPress).not.toHaveBeenCalled()
})

it('outlines a disabled filled button', async () => {
  renderWithProviders(<Button label="Save" variant="primary" isDisabled />)
  const button = page.getByRole('button', { name: 'Save' })
  await expect.element(button).toBeDisabled()
  const style = () => getComputedStyle(button.element())
  await expect.poll(() => style().backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(style().boxShadow).not.toBe('none')
})

it('keeps the label cross-fade under reduced motion', async () => {
  await emulateReducedMotion()
  renderWithProviders(<Button label="Save" variant="primary" />)
  const label = page.getByRole('button', { name: 'Save' }).getByText('Save')
  await expect.element(label).toBeVisible()
  const fade = getComputedStyle(document.documentElement).getPropertyValue('--dur-fade').trim()
  expect(fade).toBe('250ms')
  await expect.poll(() => getComputedStyle(label.element()).transitionDuration).toBe('0.25s')
})

it('shows nothing while the person decides, then the spinner once confirmed work runs', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    let answer!: () => void
    const asked = new Promise<void>((resolve) => (answer = resolve))
    let finish!: () => void
    const onPress = (track: TrackWork) => {
      void asked.then(() => track(new Promise<void>((resolve) => (finish = resolve))))
    }
    renderWithProviders(<Button label="Save" variant="primary" onPress={onPress} />)
    await expect.element(page.getByRole('button', { name: 'Save' })).toBeVisible()
    press('Save')
    await vi.advanceTimersByTimeAsync(2000)
    expect(announced('Save')).toBe('')
    expect(
      page.getByRole('button', { name: 'Save' }).element().querySelector('.button-spinner'),
    ).toBeNull()
    answer()
    await vi.advanceTimersByTimeAsync(300)
    await pollStill(() => announced('Save')).toBe(WORKING)
    finish()
    await pollStill(() => announced('Save')).toBe(DONE)
  } finally {
    vi.useRealTimers()
  }
})

function holdDown(element: Element) {
  fire(element, 'pointerdown')
  onTestFinished(() => fire(element, 'pointerup'))
}

it('keeps its scale while pressed under reduced motion', async () => {
  await emulateReducedMotion()
  renderWithProviders(<Button label="Save" variant="text" />)
  const button = page.getByRole('button', { name: 'Save' })
  await expect.element(button).toBeVisible()
  holdDown(button.element())
  await expect.element(button).toHaveAttribute('data-pressed', 'true')
  await expect.poll(() => button.element().getAnimations()).toHaveLength(0)
  expect(getComputedStyle(button.element()).scale).toMatch(/^(none|1)$/)
})

it('fades a hover color at Instant, and at Quick under reduced motion', async () => {
  renderWithProviders(<Button label="Save" variant="primary" />)
  const button = page.getByRole('button', { name: 'Save' })
  await expect.element(button).toBeVisible()
  const timing = (property: string) => {
    const style = getComputedStyle(button.element())
    const index = style.transitionProperty.split(', ').indexOf(property)
    return [
      style.transitionDuration.split(', ')[index],
      style.transitionTimingFunction.split(/,\s(?![^(]*\))/)[index],
    ]
  }
  await expect.poll(() => timing('background-color')).toEqual(['0.1s', 'linear'])
  expect(timing('color')).toEqual(['0.1s', 'linear'])
  await emulateReducedMotion()
  await expect.poll(() => timing('background-color')[0]).toBe('0.15s')
  expect(timing('color')[0]).toBe('0.15s')
  expect(timing('opacity')[0]).toBe('0.15s')
})

it('ignores presses while aria-disabled and keeps its focus', async () => {
  const onPress = vi.fn()
  renderWithProviders(<Button label="Reset" aria-disabled onPress={onPress} />)
  const button = page.getByRole('button', { name: 'Reset' })
  await expect.element(button).toHaveAttribute('aria-disabled', 'true')
  ;(button.element() as HTMLElement).focus()
  ;(button.element() as HTMLElement).click()
  await userEvent.keyboard('{Enter}')
  await expect.element(button).toHaveFocus()
  expect(onPress).not.toHaveBeenCalled()
  await expect.element(button).not.toHaveAttribute('aria-busy')
})

it('marks itself busy while its work runs past the delay', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    renderWithProviders(<Button label="Save" variant="primary" onPress={settleAfter(500)} />)
    const button = page.getByRole('button', { name: 'Save' })
    await elementStill(button).toBeVisible()
    press('Save')
    await vi.advanceTimersByTimeAsync(300)
    await elementStill(button).toHaveAttribute('aria-busy', 'true')
    await vi.advanceTimersByTimeAsync(1400)
    await elementStill(button).not.toHaveAttribute('aria-busy')
  } finally {
    vi.useRealTimers()
  }
})
