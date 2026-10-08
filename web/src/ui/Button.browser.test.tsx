import { Plus } from 'lucide-react'
import { page, userEvent } from 'vitest/browser'
import { expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { Button } from './Button'
import { Capsule } from './Capsule'
import { removeFilterLabel } from './filterCopy'

it.each([
  ['touch', 44],
  ['pointer', 28],
] as const)('an icon button is at least the %s target', async (density, min) => {
  renderWithProviders(<Button icon={Plus} label="Add tune" iconOnly />, { density })
  const button = page.getByRole('button', { name: 'Add tune' })
  await expect.element(button).toBeVisible()
  await expect
    .poll(() => button.element().getBoundingClientRect().height)
    .toBeGreaterThanOrEqual(min)
  await expect
    .poll(() => button.element().getBoundingClientRect().width)
    .toBeGreaterThanOrEqual(min)
})

it('fills a set capsule with the slate wash', async () => {
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

it('sets a primary button in bold over the body role', async () => {
  renderWithProviders(<Button label="Save" variant="primary" />)
  const weight = () =>
    getComputedStyle(page.getByRole('button', { name: 'Save' }).element()).fontWeight
  await expect.poll(weight).toBe('700')
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
] as const)('dims %s while it is pressed', async (_, ui, name) => {
  renderWithProviders(ui)
  const button = page.getByRole('button', { name, exact: true })
  await expect.element(button).toBeVisible()
  const opacity = () => Number(getComputedStyle(button.element()).opacity)
  const fire = (type: string) =>
    button.element().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 3,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
      }),
    )
  fire('pointerdown')
  await expect.element(button).toHaveAttribute('data-pressed', 'true')
  await expect.poll(opacity).toBe(0.6)
  fire('pointerup')
  await expect.poll(opacity).toBe(1)
})

it('keeps an icon button, and its focus, when the density changes', async () => {
  renderWithProviders(<Button icon={Plus} label="Add tune" iconOnly />, { density: 'pointer' })
  const button = page.getByRole('button', { name: 'Add tune' })
  await userEvent.keyboard('{Tab}')
  await expect.element(button).toHaveFocus()
  const before = button.element()
  document.documentElement.dataset.density = 'touch'
  await expect.poll(() => getComputedStyle(before).minHeight).toBe('44px')
  expect(before.isConnected).toBe(true)
  await expect.element(button).toHaveFocus()
})
