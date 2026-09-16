import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pencil, Trash2 } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { ActionMenu } from './ActionMenu'

const items = (onEdit = vi.fn(), onDelete = vi.fn()) => [
  { label: 'Edit', icon: <Pencil aria-hidden="true" className="size-4" />, onSelect: onEdit },
  {
    label: 'Delete',
    icon: <Trash2 aria-hidden="true" className="size-4" />,
    onSelect: onDelete,
    tone: 'danger' as const,
  },
]

// jsdom cannot open a popover, so the menu and its items are reached while hidden.
const menu = () => screen.getByRole('menu', { hidden: true })
const menuItems = () => screen.getAllByRole('menuitem', { hidden: true })
const item = (name: string) => screen.getByRole('menuitem', { name, hidden: true })

describe('ActionMenu', () => {
  it('anchors a menu to its button', () => {
    render(<ActionMenu label="More actions" items={items()} />)
    const button = screen.getByRole('button', { name: 'More actions' })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button.getAttribute('popovertarget')).toBe(menu().id)
    expect(button).toHaveAttribute('aria-controls', menu().id)
    expect(menu()).toHaveAttribute('popover', 'auto')
  })

  it('lists its items in order', () => {
    render(<ActionMenu label="More actions" items={items()} />)
    expect(menuItems().map((each) => each.textContent)).toEqual(['Edit', 'Delete'])
  })

  it('marks a danger item', () => {
    render(<ActionMenu label="More actions" items={items()} />)
    expect(item('Delete')).toHaveClass('text-error')
  })

  it('selects an item', async () => {
    const onEdit = vi.fn()
    render(<ActionMenu label="More actions" items={items(onEdit)} />)
    await userEvent.click(item('Edit'))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('walks the items with the arrow keys and wraps at both ends', async () => {
    render(<ActionMenu label="More actions" items={items()} />)
    item('Edit').focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(item('Delete')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(item('Edit')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(item('Delete')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(item('Edit')).toHaveFocus()
  })

  it('jumps to the first and last items with Home and End', async () => {
    render(<ActionMenu label="More actions" items={items()} />)
    item('Edit').focus()
    await userEvent.keyboard('{End}')
    expect(item('Delete')).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(item('Edit')).toHaveFocus()
  })

  it('skips a disabled item while walking', async () => {
    render(
      <ActionMenu
        label="More actions"
        items={[
          { label: 'Edit', onSelect: vi.fn() },
          { label: 'Add to list', onSelect: vi.fn(), disabled: true },
          { label: 'Delete', onSelect: vi.fn(), tone: 'danger' as const },
        ]}
      />,
    )
    expect(item('Add to list')).toBeDisabled()
    item('Edit').focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(item('Delete')).toHaveFocus()
  })
})
