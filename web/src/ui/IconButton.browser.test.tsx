import { Plus } from 'lucide-react'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { elementStill, pollStill } from '../test/stillPoll'
import { IconButton, type IconButtonProps } from './IconButton'
import { DONE, WORKING } from './WorkingMark'
import { WORKING_DELAY_MS } from './useWorking'

/** Work that runs past the working delay. */
const WORK_MS = WORKING_DELAY_MS + 150

const box = (name: string) => page.getByRole('button', { name }).element().getBoundingClientRect()

it.each([
  ['touch', 44],
  ['pointer', 44],
] as const)('is 44 on both densities at large44 (%s)', async (density, expected) => {
  renderWithProviders(<IconButton icon={Plus} label="Skip" size="large44" />, { density })
  await expect.element(page.getByRole('button', { name: 'Skip' })).toBeVisible()
  await expect.poll(() => box('Skip').width).toBe(expected)
  expect(box('Skip').height).toBe(expected)
})

function Toggle(props: Partial<IconButtonProps>) {
  const [on, setOn] = useState(false)
  return (
    <>
      <IconButton
        icon={Plus}
        label="Shuffle"
        variant="toggle"
        isSelected={on}
        onChange={setOn}
        {...props}
      />
      <button onClick={() => setOn((v) => !v)}>Flip</button>
    </>
  )
}

const iconAnimations = () =>
  page
    .getByRole('button', { name: 'Shuffle' })
    .element()
    .querySelector('svg')!
    .getAnimations()
    .filter((a) => !(a instanceof CSSTransition))

it('pops the icon when a toggle turns on and not when it turns off', async () => {
  renderWithProviders(<Toggle />)
  const toggle = page.getByRole('button', { name: 'Shuffle' })
  await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => iconAnimations().length).toBe(1)
  await expect.poll(() => iconAnimations().length).toBe(0)
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(iconAnimations()).toHaveLength(0)
})

it('keeps an aria-disabled toggle as it is when pressed', async () => {
  const onChange = vi.fn()
  renderWithProviders(
    <>
      <IconButton icon={Plus} label="Repeat" variant="toggle" aria-disabled onChange={onChange} />
      <Toggle />
    </>,
  )
  const off = page.getByRole('button', { name: 'Repeat' })
  await expect.element(off).toHaveAttribute('aria-pressed', 'false')
  ;(off.element() as HTMLElement).focus()
  ;(off.element() as HTMLElement).click()
  await expect.element(off).toHaveFocus()
  // A press on the next toggle lands after the first, so once it shows, the first has settled.
  ;(page.getByRole('button', { name: 'Shuffle' }).element() as HTMLElement).click()
  await expect
    .element(page.getByRole('button', { name: 'Shuffle' }))
    .toHaveAttribute('aria-pressed', 'true')
  expect(off.element().getAttribute('aria-pressed')).toBe('false')
  expect(onChange).not.toHaveBeenCalled()
})

it('shows a tooltip on pointer only', async () => {
  const { unmount } = renderWithProviders(<IconButton icon={Plus} label="Add tune" />, {
    density: 'pointer',
  })
  const button = page.getByRole('button', { name: 'Add tune' })
  // React Aria opens a hover tooltip only once it has seen a pointer press.
  await userEvent.click(button)
  await userEvent.unhover(button)
  await userEvent.hover(button)
  await expect.element(page.getByRole('tooltip')).toHaveTextContent('Add tune')
  unmount()
  renderWithProviders(<IconButton icon={Plus} label="Add tune" />, { density: 'touch' })
  const touch = page.getByRole('button', { name: 'Add tune' })
  await userEvent.click(touch)
  await userEvent.unhover(touch)
  await userEvent.hover(touch)
  await expect.poll(() => document.querySelector('[role="tooltip"]')).toBeNull()
})

it('keeps its focus when the density changes', async () => {
  renderWithProviders(<IconButton icon={Plus} label="Add tune" />, { density: 'pointer' })
  const button = page.getByRole('button', { name: 'Add tune' })
  await userEvent.keyboard('{Tab}')
  await expect.element(button).toHaveFocus()
  const before = button.element()
  const pointerHeight = box('Add tune').height
  document.documentElement.dataset.density = 'touch'
  await expect.poll(() => box('Add tune').height).not.toBe(pointerHeight)
  expect(before.isConnected).toBe(true)
  await expect.element(button).toHaveFocus()
})

it('reaches 44 in both directions on touch', async () => {
  renderWithProviders(<IconButton icon={Plus} label="Add tune" size="compact" />, {
    density: 'touch',
  })
  const button = page.getByRole('button', { name: 'Add tune' })
  await expect.element(button).toBeVisible()
  const area = () => getComputedStyle(button.element(), '::after')
  await expect.poll(() => parseFloat(area().height)).toBeGreaterThanOrEqual(44)
  expect(parseFloat(area().width)).toBeGreaterThanOrEqual(44)
})

it('ignores a press while aria-disabled and keeps focus', async () => {
  const onPress = vi.fn()
  renderWithProviders(<IconButton icon={Plus} label="Add tune" aria-disabled onPress={onPress} />)
  const button = page.getByRole('button', { name: 'Add tune' })
  await userEvent.keyboard('{Tab}')
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  ;(button.element() as HTMLElement).click()
  expect(onPress).not.toHaveBeenCalled()
  await expect.element(button).toHaveFocus()
})

it('shows the working state and announces it beside the button', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    renderWithProviders(
      <IconButton
        icon={Plus}
        label="Add tune"
        onPress={() => new Promise((resolve) => setTimeout(resolve, WORK_MS))}
      />,
    )
    const button = page.getByRole('button', { name: 'Add tune' })
    await elementStill(button).toBeVisible()
    const region = () => button.element().nextElementSibling!
    expect(region().getAttribute('aria-live')).toBe('polite')
    // A press without a browser action, which would move the fake clock.
    ;(button.element() as HTMLElement).click()
    await vi.advanceTimersByTimeAsync(WORKING_DELAY_MS)
    await pollStill(() => region().textContent).toBe(WORKING)
    await vi.advanceTimersByTimeAsync(WORK_MS - WORKING_DELAY_MS)
    await pollStill(() => region().textContent).toBe(DONE)
  } finally {
    vi.useRealTimers()
  }
})

it('marks itself busy while its work runs past the delay', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    renderWithProviders(
      <IconButton
        icon={Plus}
        label="Add tune"
        onPress={() => new Promise((resolve) => setTimeout(resolve, WORK_MS))}
      />,
    )
    const button = page.getByRole('button', { name: 'Add tune' })
    await elementStill(button).toBeVisible()
    ;(button.element() as HTMLElement).click()
    await vi.advanceTimersByTimeAsync(WORKING_DELAY_MS)
    await elementStill(button).toHaveAttribute('aria-busy', 'true')
  } finally {
    vi.useRealTimers()
  }
})
