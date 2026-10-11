import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { renderWithProviders } from '../../test/render'
import { StatusRow } from './StatusRow'

function mount(density: 'touch' | 'pointer', onPress = vi.fn()) {
  renderWithProviders(
    <div style={{ width: 360 }}>
      <StatusRow
        title="Synced"
        detail="Last synced 2 min ago"
        action={{ label: 'Sync now', onPress }}
      />
    </div>,
    { density },
  )
  return {
    onPress,
    title: () => page.getByText('Synced', { exact: true }).element().getBoundingClientRect(),
    button: () => page.getByRole('button', { name: 'Sync now' }).element().getBoundingClientRect(),
  }
}

it('trails the text with its action on pointer', async () => {
  const { title, button, onPress } = mount('pointer')
  await expect.element(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
  expect(button().left).toBeGreaterThan(title().right)
  expect(button().top).toBeLessThan(title().bottom)
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect.poll(() => onPress).toHaveBeenCalledOnce()
})

it('runs its action full width under the text on touch', async () => {
  const { title, button } = mount('touch')
  await expect.element(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
  expect(button().top).toBeGreaterThanOrEqual(title().bottom)
  // The row's inset is 16px a side.
  expect(button().width).toBe(360 - 32)
})
