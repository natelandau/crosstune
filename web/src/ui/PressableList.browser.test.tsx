import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderWithProviders } from '../test/render'
import { Group } from './form/Group'
import { PressableList, PressableOption } from './PressableRow'

const ITEMS = ['One', 'Two', 'Three']

function mount(onPick = vi.fn(), selected: string | null = 'Two') {
  function Host() {
    const [chosen, setChosen] = useState(selected)
    return (
      <Group>
        <PressableList aria-label="Items" selectedId={chosen}>
          {ITEMS.map((item) => (
            <PressableOption
              key={item}
              id={item}
              name={`Use ${item}`}
              isDisabled={item === 'Three'}
              onPress={() => {
                onPick(item)
                setChosen(item)
              }}
            >
              <span className="flex-1">{item}</span>
            </PressableOption>
          ))}
        </PressableList>
      </Group>
    )
  }
  renderWithProviders(<Host />)
  return onPick
}

const option = (name: string) => page.getByRole('option', { name, exact: true })

it('is a named listbox of options, each with its name, and the chosen one selected', async () => {
  mount()
  await expect.element(page.getByRole('listbox', { name: 'Items' })).toBeVisible()
  await expect.element(option('Use One')).toHaveAttribute('aria-selected', 'false')
  await expect.element(option('Use Two')).toHaveAttribute('aria-selected', 'true')
  await expect.element(option('Use Three')).toHaveAttribute('aria-disabled', 'true')
})

it('calls the handler on a click, and again on the chosen option', async () => {
  const onPick = mount()
  await option('Use One').click()
  await expect.poll(() => onPick.mock.calls).toEqual([['One']])
  await expect.element(option('Use One')).toHaveAttribute('aria-selected', 'true')
  await option('Use One').click()
  await expect.poll(() => onPick.mock.calls).toEqual([['One'], ['One']])
})

it('moves between options with the arrow keys and picks with Enter', async () => {
  const onPick = mount()
  ;(option('Use Two').element() as HTMLElement).focus()
  await expect.element(option('Use Two')).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}')
  await expect.element(option('Use One')).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => onPick.mock.calls).toEqual([['One']])
})
