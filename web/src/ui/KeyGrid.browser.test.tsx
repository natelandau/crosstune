import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ALL_KEYS } from '../constants'
import { ANY } from './filterCopy'
import { KEY, spokenKey, UNKNOWN_KEY } from './keyName'
import { renderWithProviders } from '../test/render'
import { KeyGrid } from './KeyGrid'

const grid = () => page.getByRole('listbox', { name: KEY })
const radio = (name: string) => grid().getByRole('option', { name, exact: true })
const names = () =>
  grid()
    .getByRole('option')
    .elements()
    .map((el) => el.getAttribute('aria-label'))

function Host({
  start = null,
  anyLabel,
  keys,
  noKey,
  onChange = () => {},
}: {
  start?: string | null
  anyLabel?: string
  keys?: readonly string[]
  noKey?: string
  onChange?: (key: string | null) => void
}) {
  const [value, setValue] = useState(start)
  return (
    <KeyGrid
      value={value}
      anyLabel={anyLabel}
      keys={keys}
      noKey={noKey}
      onChange={(key) => {
        setValue(key)
        onChange(key)
      }}
    />
  )
}

it('offers every key, each named in words, with Any leading only when asked', async () => {
  const first = renderWithProviders(<Host />)
  await expect.element(grid()).toBeVisible()
  expect(names()).toEqual(ALL_KEYS.map(spokenKey))
  await expect.element(radio('F sharp')).toHaveTextContent('F#')
  first.unmount()
  renderWithProviders(<Host anyLabel={ANY} />)
  await expect.poll(() => names()[0]).toBe(ANY)
  await expect.element(radio(ANY)).toHaveAttribute('aria-selected', 'true')
})

it('gives both spellings of a black key one hue', async () => {
  renderWithProviders(<Host />)
  const pitchOf = (name: string) => radio(name).element().querySelector('[data-pitch]')
  await expect.element(radio('A sharp')).toBeVisible()
  expect(pitchOf('A sharp')?.getAttribute('data-pitch')).toBe('10')
  expect(pitchOf('B flat')?.getAttribute('data-pitch')).toBe('10')
  expect(getComputedStyle(pitchOf('A sharp')!).backgroundColor).toBe(
    getComputedStyle(pitchOf('B flat')!).backgroundColor,
  )
})

it('chooses a key on a press, and the chosen key again clears it', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Host anyLabel={ANY} onChange={onChange} />)
  await radio('D').click()
  await expect.element(radio('D')).toHaveAttribute('aria-selected', 'true')
  await expect.element(radio(ANY)).toHaveAttribute('aria-selected', 'false')
  expect(onChange).toHaveBeenLastCalledWith('D')
  await radio('D').click()
  await expect.element(radio(ANY)).toHaveAttribute('aria-selected', 'true')
  expect(onChange).toHaveBeenLastCalledWith(null)
})

it('lets a stored key the grid lacks join it as its own pill', async () => {
  renderWithProviders(<Host start="Cb" />)
  await expect.element(radio('C flat')).toHaveAttribute('aria-selected', 'true')
  expect(names().at(-1)).toBe('C flat')
})

it('names the no-key choice in words and shows a question mark', async () => {
  renderWithProviders(<Host keys={['none', 'A', 'D']} noKey="none" anyLabel={ANY} />)
  await expect.element(radio(UNKNOWN_KEY)).toHaveTextContent('?')
  expect(names()).toEqual([ANY, UNKNOWN_KEY, 'A', 'D'])
})

it('moves with the arrows without choosing, and chooses with Enter or Space', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Host start="D" onChange={onChange} />)
  await userEvent.keyboard('{Tab}')
  await expect.element(radio('D')).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(radio('D sharp')).toHaveFocus()
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
  await expect.element(radio('C sharp')).toHaveFocus()
  await userEvent.keyboard('{End}')
  await expect.element(radio('G flat')).toHaveFocus()
  await userEvent.keyboard('{Home}')
  await expect.element(radio('A')).toHaveFocus()
  expect(onChange).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')
  await expect.element(radio('A')).toHaveAttribute('aria-selected', 'true')
  expect(onChange).toHaveBeenLastCalledWith('A')
  await userEvent.keyboard('{ArrowRight} ')
  await expect.element(radio('A sharp')).toHaveAttribute('aria-selected', 'true')
  expect(onChange).toHaveBeenLastCalledWith('A#')
})

it('finds a key by typing its name', async () => {
  renderWithProviders(<Host />)
  await userEvent.keyboard('{Tab}')
  await expect.element(radio('A')).toHaveFocus()
  await userEvent.keyboard('E')
  await expect.element(radio('E')).toHaveFocus()
})

it('joins a stored key spelled in another case to the grid’s own pill', async () => {
  renderWithProviders(<Host start="bb" />)
  await expect.element(radio('B flat')).toHaveAttribute('aria-selected', 'true')
  expect(names()).toEqual(ALL_KEYS.map(spokenKey))
})

it('leaves the chosen key alone on Escape', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Host start="D" anyLabel={ANY} onChange={onChange} />)
  await userEvent.keyboard('{Tab}')
  await expect.element(radio('D')).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(radio('D')).toHaveAttribute('aria-selected', 'true')
  expect(onChange).not.toHaveBeenCalled()
})
