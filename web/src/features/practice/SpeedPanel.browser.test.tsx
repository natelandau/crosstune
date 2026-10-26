import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderWithProviders } from '../../test/render'
import { FASTER, SpeedPanel } from './SpeedPanel'

function Harness({ onChange }: { onChange: (percent: number) => void }) {
  const [value, setValue] = useState(145)
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
  renderWithProviders(<Harness onChange={onChange} />)
  const faster = page.getByRole('button', { name: FASTER })
  await faster.click()
  await expect.element(faster).toHaveAttribute('aria-disabled', 'true')
  await expect.element(faster).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(faster).toHaveFocus()
  expect(onChange.mock.calls).toEqual([[150]])
})
