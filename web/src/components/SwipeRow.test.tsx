import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SwipeRow, type SwipeAction } from './SwipeRow'

function renderRow({ open = false }: { open?: boolean } = {}) {
  const onOpenChange = vi.fn()
  const onEdit = vi.fn()
  const onLink = vi.fn()
  const actions: [SwipeAction, SwipeAction] = [
    { label: 'Edit', tone: 'neutral', onPress: onEdit },
    { label: 'Archive', tone: 'warning', onPress: vi.fn() },
  ]
  render(
    <SwipeRow
      name="Soldier's Joy"
      actions={actions}
      open={open}
      onOpenChange={onOpenChange}
      onSwipeStart={vi.fn()}
    >
      <a
        href="#song"
        onClick={(event) => {
          event.preventDefault()
          onLink()
        }}
      >
        Soldier's Joy
      </a>
    </SwipeRow>,
  )
  return { onOpenChange, onEdit, onLink }
}

// jsdom ignores inert, so these buttons stay queryable; browsers act on the attribute.
const editButton = () => screen.getByRole('button', { name: "Edit Soldier's Joy" })

describe('SwipeRow', () => {
  it('keeps the actions inert while closed', () => {
    renderRow()
    expect(editButton().parentElement).toHaveAttribute('inert')
  })

  it('makes the actions usable while open', () => {
    renderRow({ open: true })
    expect(editButton().parentElement).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: "Archive Soldier's Joy" })).toBeInTheDocument()
  })

  it('passes a tap on a closed row through to the link', async () => {
    const { onLink, onOpenChange } = renderRow()
    await userEvent.click(screen.getByRole('link', { name: "Soldier's Joy" }))
    expect(onLink).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes an open row on tap without following the link', async () => {
    const { onLink, onOpenChange } = renderRow({ open: true })
    await userEvent.click(screen.getByRole('link', { name: "Soldier's Joy" }))
    expect(onLink).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('runs an action and closes the row', async () => {
    const { onEdit, onOpenChange } = renderRow({ open: true })
    await userEvent.click(editButton())
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
