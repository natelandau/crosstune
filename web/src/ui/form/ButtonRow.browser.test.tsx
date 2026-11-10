import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { renderWithProviders } from '../../test/render'
import { ButtonRow } from './ButtonRow'
import { Group } from './Group'

function mount(density: 'touch' | 'pointer', onPress = vi.fn()) {
  renderWithProviders(
    <div style={{ width: 360 }}>
      <Group>
        <ButtonRow
          title="Synced"
          description="Last synced 2 min ago"
          button={{ label: 'Sync now', onPress }}
        />
      </Group>
    </div>,
    { density },
  )
  return {
    onPress,
    title: () => page.getByText('Synced', { exact: true }).element().getBoundingClientRect(),
    text: () =>
      page.getByText('Last synced 2 min ago').element().parentElement!.getBoundingClientRect(),
    button: () => page.getByRole('button', { name: 'Sync now' }).element().getBoundingClientRect(),
  }
}

it.each(['pointer', 'touch'] as const)(
  'puts the button at the end on pointer and below on touch, on %s',
  async (density) => {
    const { title, text, button, onPress } = mount(density)
    await expect.element(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
    if (density === 'pointer') {
      expect(button().left).toBeGreaterThan(title().right)
      // Centered on the text beside it.
      expect(button().top + button().height / 2).toBeCloseTo(text().top + text().height / 2, 0)
    } else {
      expect(button().top).toBeGreaterThanOrEqual(title().bottom)
    }
    await page.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(() => onPress).toHaveBeenCalledOnce()
  },
)

it('has exactly one button', async () => {
  renderWithProviders(
    <Group>
      <ButtonRow
        description="Save a copy of everything to a file."
        button={{ label: 'Export', onPress: () => {} }}
      />
    </Group>,
  )
  await expect.element(page.getByRole('button', { name: 'Export' })).toBeVisible()
  expect(page.getByRole('button').elements()).toHaveLength(1)
})

it("reads its description as the button's description", async () => {
  renderWithProviders(
    <Group>
      <ButtonRow
        description={
          <>
            Save a copy. <a href="https://example.com">More info</a>
          </>
        }
        button={{ label: 'Export', onPress: () => {} }}
      />
    </Group>,
  )
  const button = page.getByRole('button', { name: 'Export' })
  await expect.element(button).toHaveAccessibleDescription('Save a copy. More info')
  // The link inside the description stays its own control.
  await expect.element(page.getByRole('link', { name: 'More info' })).toBeVisible()
})

it("puts a title-only row's label at the start and its button at the end on pointer", async () => {
  renderWithProviders(
    <div style={{ width: 360 }}>
      <Group>
        <ButtonRow
          title="Location"
          button={{ label: 'Clear location', variant: 'destructive', onPress: () => {} }}
        />
      </Group>
    </div>,
    { density: 'pointer' },
  )
  const button = page.getByRole('button', { name: 'Clear location' })
  await expect.element(button).toBeVisible()
  const label = page.getByText('Location', { exact: true }).element().getBoundingClientRect()
  const box = button.element().getBoundingClientRect()
  expect(box.left).toBeGreaterThan(label.right)
  await expect.element(button).toHaveAccessibleDescription('Location')
})

it("reads its title before its description as the button's description", async () => {
  renderWithProviders(
    <Group>
      <ButtonRow
        title="Synced"
        description="Last synced 2 min ago"
        button={{ label: 'Sync now', onPress: () => {} }}
      />
    </Group>,
  )
  await expect
    .element(page.getByRole('button', { name: 'Sync now' }))
    .toHaveAccessibleDescription('Synced Last synced 2 min ago')
})
