import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { renderWithProviders } from '../test/render'
import { ErrorLine } from './ErrorLine'

it('renders nothing without an error, and an alert with one', async () => {
  const { rerender } = renderWithProviders(<ErrorLine error={null} place="bar" />)
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  rerender(<ErrorLine error="Could not save" place="bar" id="why" />)
  await expect.element(page.getByRole('alert')).toHaveTextContent('Could not save')
  await expect.element(page.getByRole('alert')).toHaveAttribute('id', 'why')
})

it('opens its own space and fades in as an error appears', async () => {
  const { rerender } = renderWithProviders(<ErrorLine error={null} place="inline" />)
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  rerender(<ErrorLine error="Could not save" place="inline" />)
  const reveal = page.getByRole('alert').element().parentElement!.parentElement!
  const moving = reveal
    .getAnimations()
    .map((animation) => (animation as CSSTransition).transitionProperty)
    .sort()
  expect(moving).toEqual(['grid-template-rows', 'opacity'])
  await expect.element(page.getByRole('alert')).toHaveTextContent('Could not save')
})
