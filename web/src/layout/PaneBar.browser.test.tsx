import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { renderWithProviders } from '../test/render'
import { Button } from '../ui/Button'
import { PaneBar } from './PaneBar'

const rect = (element: Element) => element.getBoundingClientRect()

it('keeps the title clear of trailing controls wider than their half of the bar', async () => {
  renderWithProviders(
    <div style={{ width: 480 }}>
      <PaneBar
        title="3 selected"
        titleAlways
        leading={<Button label="All" onPress={() => {}} />}
        trailing={['One', 'Two', 'Three', 'Done'].map((label) => (
          <Button key={label} label={label} onPress={() => {}} />
        ))}
      />
    </div>,
  )
  const one = page.getByRole('button', { name: 'One' })
  await expect.element(one).toBeVisible()
  const title = document.querySelector('[data-pane-title]')!
  const leading = page.getByRole('button', { name: 'All' }).element()
  await expect.poll(() => rect(title).right).toBeLessThanOrEqual(rect(one.element()).left)
  await expect.poll(() => rect(title).left).toBeGreaterThanOrEqual(rect(leading).right)
})

it('shows the compact title only while the full one would not fit, both ways', async () => {
  const bar = (width: number) => (
    <div style={{ width }}>
      <PaneBar
        title="12 selected"
        compactTitle="12"
        titleAlways
        leading={<Button label="All" onPress={() => {}} />}
        trailing={['One', 'Two', 'Done'].map((label) => (
          <Button key={label} label={label} onPress={() => {}} />
        ))}
      />
    </div>
  )
  const { rerender } = renderWithProviders(bar(220))
  await expect.element(page.getByText('12', { exact: true })).toBeVisible()
  rerender(bar(640))
  await expect.element(page.getByText('12 selected', { exact: true })).toBeVisible()
  rerender(bar(220))
  await expect.element(page.getByText('12', { exact: true })).toBeVisible()
})
