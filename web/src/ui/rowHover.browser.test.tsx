import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { renderWithProviders } from '../test/render'
import { Group } from './form/Group'
import { PressableList, PressableOption, PressableRow } from './PressableRow'

const background = (element: Element) => getComputedStyle(element).backgroundColor

it.each(['light', 'dark'] as const)(
  'a hovered pressable row shows against its group card in %s',
  async (scheme) => {
    renderWithProviders(
      <Group>
        <PressableRow onPress={() => {}}>
          <span>Details</span>
        </PressableRow>
        <PressableList aria-label="Items" selectedId="b">
          <PressableOption id="a" name="Item A" onPress={() => {}}>
            <span>Item A</span>
          </PressableOption>
          <PressableOption id="b" name="Item B" onPress={() => {}}>
            <span>Item B</span>
          </PressableOption>
        </PressableList>
      </Group>,
      { scheme },
    )
    const card = page.getByRole('button', { name: 'Details' }).element().parentElement!
    const rows = [
      page.getByRole('button', { name: 'Details' }),
      page.getByRole('option', { name: 'Item A' }),
      page.getByRole('option', { name: 'Item B' }),
    ]
    for (const row of rows) {
      const element = row.element()
      await row.hover()
      await expect.poll(() => background(element)).not.toBe('rgba(0, 0, 0, 0)')
      expect(background(element)).not.toBe(background(card))
    }
  },
)
