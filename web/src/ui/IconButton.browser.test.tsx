import { Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { elementStill, pollStill } from '../test/stillPoll'
import { IconButton, type IconButtonProps } from './IconButton'
import { DONE, WORKING } from './WorkingMark'

const box = (name: string) => page.getByRole('button', { name }).element().getBoundingClientRect()
const style = (name: string) => getComputedStyle(page.getByRole('button', { name }).element())

it.each([
  ['touch', 36],
  ['pointer', 28],
] as const)('is the regular %s size', async (density, size) => {
  renderWithProviders(<IconButton icon={Plus} label="Add tune" />, { density })
  await expect.element(page.getByRole('button', { name: 'Add tune' })).toBeVisible()
  await expect.poll(() => box('Add tune').height).toBe(size)
  expect(box('Add tune').width).toBe(size)
})

it.each([
  ['touch', 'compact', 32],
  ['pointer', 'compact', 24],
  ['touch', 'large', 48],
  ['pointer', 'large', 36],
] as const)('on %s, a %s button is %ipx', async (density, size, expected) => {
  renderWithProviders(<IconButton icon={Plus} label="Add tune" size={size} />, { density })
  await expect.element(page.getByRole('button', { name: 'Add tune' })).toBeVisible()
  await expect.poll(() => box('Add tune').width).toBe(expected)
})

it.each([
  ['touch', 44],
  ['pointer', 44],
] as const)('is 44 on both densities at large44 (%s)', async (density, expected) => {
  renderWithProviders(<IconButton icon={Plus} label="Skip" size="large44" />, { density })
  await expect.element(page.getByRole('button', { name: 'Skip' })).toBeVisible()
  await expect.poll(() => box('Skip').width).toBe(expected)
  expect(box('Skip').height).toBe(expected)
})

it.each(['touch', 'pointer'] as const)(
  'is 64 with a 36 icon on both densities at transport (%s)',
  async (density) => {
    renderWithProviders(<IconButton icon={Plus} label="Skip" size="transport" />, { density })
    await expect.element(page.getByRole('button', { name: 'Skip' })).toBeVisible()
    await expect.poll(() => box('Skip').width).toBe(64)
    expect(box('Skip').height).toBe(64)
    const icon = page.getByRole('button', { name: 'Skip' }).element().querySelector('svg')!
    expect(icon.getBoundingClientRect().width).toBe(36)
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    const probe = document.createElement('span')
    probe.style.color = accent
    document.body.append(probe)
    onTestFinished(() => probe.remove())
    expect(getComputedStyle(page.getByRole('button', { name: 'Skip' }).element()).color).toBe(
      getComputedStyle(probe).color,
    )
  },
)

it('is 72 at feature', async () => {
  renderWithProviders(<IconButton glyph={<Play />} label="Play" variant="feature" size="feature" />)
  await expect.element(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect.poll(() => box('Play').width).toBe(72)
  expect(box('Play').height).toBe(72)
})

const SIZES = ['compact', 'regular', 'large', 'large44', 'transport', 'feature'] as const
const VARIANTS = ['plain', 'neutral', 'toggle', 'feature', 'destructive'] as const

it.each(SIZES.flatMap((size) => VARIANTS.map((variant) => [size, variant] as const)))(
  'is a circle at %s as %s, and a toggle that is on',
  async (size, variant) => {
    renderWithProviders(
      <IconButton
        icon={Plus}
        label="Add"
        size={size}
        variant={variant}
        isSelected={variant === 'toggle' ? true : undefined}
      />,
    )
    await expect.element(page.getByRole('button', { name: 'Add' })).toBeVisible()
    const radius = () => style('Add').borderTopLeftRadius
    await expect.poll(() => parseFloat(radius())).toBeGreaterThan(0)
    const rounded = radius().endsWith('%')
      ? parseFloat(radius()) === 50
      : Math.abs(parseFloat(radius()) - box('Add').width / 2) < 0.5
    expect(rounded).toBe(true)
  },
)

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

it('tints a toggle that is on and keeps its off icon at full strength', async () => {
  renderWithProviders(<Toggle />)
  const toggle = page.getByRole('button', { name: 'Shuffle' })
  await expect.element(toggle).toBeVisible()
  const off = style('Shuffle').backgroundColor
  await toggle.click()
  await expect.poll(() => style('Shuffle').backgroundColor).not.toBe(off)
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
  const probe = document.createElement('span')
  probe.style.color = 'var(--text-primary)'
  document.body.append(probe)
  const primary = getComputedStyle(probe).color
  probe.remove()
  const icon = () => getComputedStyle(toggle.element().querySelector('svg')!)
  await expect.poll(() => icon().color).toBe(primary)
  expect(icon().opacity).toBe('1')
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
  document.documentElement.dataset.density = 'touch'
  await expect.poll(() => box('Add tune').height).toBe(36)
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
  await expect.poll(() => style('Add tune').opacity).toBe('0.4')
})

it('tints a destructive icon button apart from a plain one', async () => {
  renderWithProviders(
    <>
      <IconButton icon={Trash2} label="Delete" variant="destructive" />
      <IconButton icon={Plus} label="Add" />
    </>,
  )
  await expect.element(page.getByRole('button', { name: 'Delete' })).toBeVisible()
  await expect.poll(() => style('Delete').color).not.toBe(style('Add').color)
})

it('shows the working state and announces it beside the button', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    renderWithProviders(
      <IconButton
        icon={Plus}
        label="Add tune"
        onPress={() => new Promise((resolve) => setTimeout(resolve, 450))}
      />,
    )
    const button = page.getByRole('button', { name: 'Add tune' })
    await elementStill(button).toBeVisible()
    const region = () => button.element().nextElementSibling!
    expect(region().getAttribute('aria-live')).toBe('polite')
    // A press without a browser action, which would move the fake clock.
    ;(button.element() as HTMLElement).click()
    await vi.advanceTimersByTimeAsync(300)
    await pollStill(() => region().textContent).toBe(WORKING)
    await vi.advanceTimersByTimeAsync(150)
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
        onPress={() => new Promise((resolve) => setTimeout(resolve, 450))}
      />,
    )
    const button = page.getByRole('button', { name: 'Add tune' })
    await elementStill(button).toBeVisible()
    ;(button.element() as HTMLElement).click()
    await vi.advanceTimersByTimeAsync(300)
    await elementStill(button).toHaveAttribute('aria-busy', 'true')
  } finally {
    vi.useRealTimers()
  }
})
