import { Gauge, Music2 } from 'lucide-react'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { ToolPopover } from './ToolPopover'

function Toolbar({ changed = false }: { changed?: boolean }) {
  const [count, setCount] = useState(0)
  return (
    <div className="flex gap-2 p-10">
      <ToolPopover icon={Gauge} label="Rate" value={String(count)} changed={changed}>
        <button type="button" onClick={() => setCount((n) => n + 1)}>
          Add one
        </button>
      </ToolPopover>
      <ToolPopover icon={Music2} label="Tone" value="Plain">
        <p>Tone controls</p>
      </ToolPopover>
      <button type="button">Elsewhere</button>
    </div>
  )
}

const rate = () => page.getByRole('button', { name: /^Rate/ })
const dialog = () => page.getByRole('dialog', { name: 'Rate' })

it('is named by its tool and value, and opens a dialog named by the tool', async () => {
  renderWithProviders(<Toolbar />)
  await expect.element(page.getByRole('button', { name: 'Rate 0', exact: true })).toBeVisible()
  await expect.element(rate()).toHaveAttribute('aria-expanded', 'false')
  await rate().click()
  await expect.element(dialog()).toBeVisible()
  await expect.element(rate()).toHaveAttribute('aria-expanded', 'true')
  await expect.element(dialog().getByRole('heading', { name: 'Rate' })).toBeVisible()
})

it('moves focus into the popover and back to its button on Escape', async () => {
  renderWithProviders(<Toolbar />)
  await rate().click()
  await expect.poll(() => dialog().element().contains(document.activeElement)).toBe(true)
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(rate()).toHaveFocus()
  await expect.element(rate()).toHaveAttribute('aria-expanded', 'false')
})

it('closes from its button and from a press outside', async () => {
  renderWithProviders(<Toolbar />)
  await rate().click()
  await expect.element(dialog()).toBeVisible()
  // The open popover makes the page behind it inert, so the press lands as a real pointer would.
  await rate().click({ force: true })
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(rate()).toHaveAttribute('aria-expanded', 'false')

  await rate().click()
  await expect.element(dialog()).toBeVisible()
  await userEvent.click(document.body, { position: { x: 5, y: 5 } })
  await expect.element(dialog()).not.toBeInTheDocument()
})

it('shows one popover at a time', async () => {
  renderWithProviders(<Toolbar />)
  await rate().click()
  await expect.element(dialog()).toBeVisible()
  await userEvent.click(document.body, { position: { x: 5, y: 5 } })
  await page.getByRole('button', { name: /^Tone/ }).click()
  await expect.element(page.getByRole('dialog', { name: 'Tone' })).toBeVisible()
  await expect.poll(() => page.getByRole('dialog').elements()).toHaveLength(1)
})

it("updates its value from the popover's controls", async () => {
  renderWithProviders(<Toolbar />)
  await rate().click()
  await dialog().getByRole('button', { name: 'Add one' }).click()
  await expect.element(page.getByRole('button', { name: 'Rate 1', exact: true })).toBeVisible()
})

it('marks a changed value apart from an unchanged one', async () => {
  renderWithProviders(<Toolbar changed />)
  await expect.element(rate()).toHaveAttribute('data-changed', 'true')
  await expect
    .element(page.getByRole('button', { name: /^Tone/ }))
    .not.toHaveAttribute('data-changed')
})
