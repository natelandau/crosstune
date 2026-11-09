import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderWithProviders } from '../../test/render'
import { RESET } from './panel'
import { FASTER, SLOWER, SPEED, SpeedPanel } from './SpeedPanel'

function Harness({ initial, onChange }: { initial: number; onChange: (percent: number) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <SpeedPanel
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

it('keeps focus on a stepper that turns itself off, and ignores it while off', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness initial={145} onChange={onChange} />)
  const faster = page.getByRole('button', { name: FASTER })
  await faster.click()
  await expect.element(faster).toHaveAttribute('aria-disabled', 'true')
  await expect.element(faster).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(faster).toHaveFocus()
  expect(onChange.mock.calls).toEqual([[150]])
})

it('steps by 5% and stops at 50% and 150%', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness initial={140} onChange={onChange} />)
  const faster = page.getByRole('button', { name: FASTER })
  await faster.click()
  await expect.element(page.getByRole('status', { name: SPEED })).toHaveTextContent('145%')
  await faster.click()
  await expect.element(page.getByRole('status', { name: SPEED })).toHaveTextContent('150%')
  ;(faster.element() as HTMLElement).click()
  expect(onChange.mock.calls.map(([v]) => v)).toEqual([145, 150])
  await expect.element(faster).toHaveAttribute('aria-disabled', 'true')
  await expect.element(page.getByRole('slider', { name: SPEED })).toHaveValue('150')
})

it('steps down to 50% and no further', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness initial={55} onChange={onChange} />)
  const slower = page.getByRole('button', { name: SLOWER })
  await slower.click()
  await expect.element(page.getByRole('status', { name: SPEED })).toHaveTextContent('50%')
  ;(slower.element() as HTMLElement).click()
  expect(onChange.mock.calls.map(([v]) => v)).toEqual([50])
  await expect.element(slower).toHaveAttribute('aria-disabled', 'true')
})

it('jumps to a preset and marks it chosen', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness initial={100} onChange={onChange} />)
  await page.getByRole('radio', { name: '75%' }).click()
  expect(onChange).toHaveBeenLastCalledWith(75)
  await expect.element(page.getByRole('radio', { name: '75%' })).toBeChecked()
  await expect.element(page.getByRole('radio', { name: '100%' })).not.toBeChecked()
})

it('moves with the slider keys and resets to 100%', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness initial={100} onChange={onChange} />)
  const slider = page.getByRole('slider', { name: SPEED })
  ;(slider.element() as HTMLElement).focus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(page.getByRole('status', { name: SPEED })).toHaveTextContent('105%')
  await userEvent.keyboard('{End}')
  expect(onChange).toHaveBeenLastCalledWith(150)
  await page.getByRole('button', { name: RESET }).click()
  expect(onChange).toHaveBeenLastCalledWith(100)
  await expect
    .element(page.getByRole('button', { name: RESET }))
    .toHaveAttribute('aria-disabled', 'true')
})

it.each([
  [72, FASTER, 75],
  [72, SLOWER, 70],
])('steps %i%% onto the 5%% grid with %s', async (initial, name, expected) => {
  const onChange = vi.fn()
  renderWithProviders(<Harness initial={initial} onChange={onChange} />)
  await page.getByRole('button', { name }).click()
  expect(onChange.mock.calls).toEqual([[expected]])
})
