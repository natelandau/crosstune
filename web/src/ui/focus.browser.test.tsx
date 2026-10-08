import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { Button } from './Button'
import { Row } from './Row'
import { RowList } from './RowList'
import { Sheet } from './Sheet'

const outline = (element: Element) => getComputedStyle(element).outlineStyle

function Opener() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button label="Edit tune" onPress={() => setOpen(true)} />
      <Sheet isOpen={open} onOpenChange={setOpen} title="Edit tune">
        <p>Body</p>
      </Sheet>
    </>
  )
}

it.each(['touch', 'pointer'] as const)(
  'rings no %s sheet surface opened from the keyboard',
  async (density) => {
    renderWithProviders(<Opener />, { density })
    await userEvent.keyboard('{Tab}')
    await expect.element(page.getByRole('button', { name: 'Edit tune' })).toHaveFocus()
    await expect.poll(() => outline(document.activeElement!)).toBe('solid')
    await userEvent.keyboard('{Enter}')
    const dialog = page.getByRole('dialog', { name: 'Edit tune' })
    await expect.element(dialog).toHaveFocus()
    expect(outline(dialog.element())).toBe('none')
  },
)

it('rings a row focused from the keyboard', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="Soldier's Joy"
        title="Soldier's Joy"
        actions={[{ id: 'edit', label: 'Edit', icon: Pencil, onAction() {} }]}
      />
    </RowList>,
  )
  await userEvent.keyboard('{Tab}')
  const row = page.getByRole('row', { name: /Soldier's Joy/ })
  await expect.element(row).toHaveFocus()
  await expect.poll(() => outline(row.element())).toBe('solid')
  expect(outline(page.getByRole('grid').element())).toBe('none')
})

it.each(['touch', 'pointer'] as const)(
  'leaves room in a %s sheet for the ring of a field at the top of its body',
  async (density) => {
    renderWithProviders(
      <Sheet isOpen onOpenChange={() => {}} title="Find">
        <input aria-label="Find" />
      </Sheet>,
      { density },
    )
    const field = page.getByRole('textbox', { name: 'Find' })
    await expect.element(field).toBeVisible()
    const input = field.element()
    let body = input.parentElement!
    while (getComputedStyle(body).overflowY !== 'auto') body = body.parentElement!
    // The ring is 2px wide and 2px outside the field.
    await expect
      .poll(() => input.getBoundingClientRect().top - body.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(4)
    // The room comes out of the header's padding below, which matches its padding above, so
    // the body starts where it always did.
    const header = page.getByRole('dialog').element().querySelector('header')!
    const padding = (element: Element, side: 'Top' | 'Bottom') =>
      parseFloat(getComputedStyle(element)[`padding${side}`])
    await expect
      .poll(() => padding(header, 'Bottom') + padding(body, 'Top'))
      .toBe(padding(header, 'Top'))
  },
)
