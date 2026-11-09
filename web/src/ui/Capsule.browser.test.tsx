import { createRef, useState } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { renderWithProviders } from '../test/render'
import { Capsule } from './Capsule'
import { fire } from '../test/gestures'

it('toggles a selected capsule', async () => {
  function Host() {
    const [on, setOn] = useState(false)
    return <Capsule label="0:12.3" isSelected={on} onChange={setOn} />
  }
  renderWithProviders(<Host />)
  const chip = page.getByRole('button', { name: '0:12.3' })
  await expect.element(chip).toHaveAttribute('aria-pressed', 'false')
  await chip.click()
  await expect.element(chip).toHaveAttribute('aria-pressed', 'true')
})

it('renders a capsule that navigates as a link at the compact height', async () => {
  const router = createMemoryRouter([
    { path: '/', element: <Capsule label="Session" to="/lists/1" /> },
    { path: '/lists/1', element: <p>list</p> },
  ])
  renderWithProviders(<RouterProvider router={router} />)
  const link = page.getByRole('link', { name: 'Session' })
  await expect.element(link).toBeVisible()
  await expect.poll(() => link.element().getBoundingClientRect().height).toBe(24)
  await link.click()
  await expect.element(page.getByText('list')).toBeVisible()
})

it('gives a link capsule the press motion, its name, its ref, and its props', async () => {
  const ref = createRef<HTMLElement>()
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <Capsule label="Session list" to="/lists/1" ref={ref} data-testid="capsule">
          <span aria-hidden>Session</span>
        </Capsule>
      ),
    },
    { path: '/lists/1', element: <p>list</p> },
  ])
  renderWithProviders(<RouterProvider router={router} />)
  const link = page.getByRole('link', { name: 'Session list' })
  await expect.element(link).toBeVisible()
  expect(link.element().getAttribute('href')).toBe('/lists/1')
  expect(ref.current).toBe(link.element())
  expect(link.element().getAttribute('data-testid')).toBe('capsule')
  fire(link.element(), 'pointerdown')
  await expect.element(link).toHaveAttribute('data-pressed', 'true')
  fire(link.element(), 'pointerup')
  await expect.element(page.getByText('list')).toBeVisible()
})

it('takes a press 44px tall on touch while it draws at the compact height', async () => {
  renderWithProviders(
    <div style={{ padding: 40 }}>
      <Capsule label="D" />
    </div>,
    { density: 'touch' },
  )
  const chip = page.getByRole('button', { name: 'D' })
  await expect.element(chip).toBeVisible()
  const box = () => chip.element().getBoundingClientRect()
  await expect.poll(() => box().height).toBe(32)
  const hit = (y: number) => document.elementFromPoint(box().left + box().width / 2, y)
  // The press area runs 6px past each edge.
  expect(hit(box().top - 5)).toBe(chip.element())
  expect(hit(box().bottom + 5)).toBe(chip.element())
})
