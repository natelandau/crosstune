import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SwipeRow, type SwipeAction } from './SwipeRow'

function renderRow({
  open = false,
  otherOpen = false,
  disabled = false,
}: { open?: boolean; otherOpen?: boolean; disabled?: boolean } = {}) {
  const onOpenChange = vi.fn()
  const closeOpenRow = vi.fn()
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
      otherOpen={otherOpen}
      disabled={disabled}
      onOpenChange={onOpenChange}
      onSwipeStart={vi.fn()}
      closeOpenRow={closeOpenRow}
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
  return { onOpenChange, closeOpenRow, onEdit, onLink }
}

// jsdom ignores inert, so these buttons stay queryable; browsers act on the attribute.
const editButton = () => screen.getByRole('button', { name: "Edit Soldier's Joy" })

describe('SwipeRow', () => {
  it('keeps the actions inert while closed', () => {
    renderRow()
    expect(editButton().parentElement).toHaveAttribute('inert')
  })

  it('hides the actions while the row rests closed, so their color cannot edge its corners', () => {
    renderRow()
    expect(editButton().parentElement).toHaveStyle({ opacity: '0' })
  })

  it('makes the actions usable while open', async () => {
    renderRow({ open: true })
    expect(editButton().parentElement).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: "Archive Soldier's Joy" })).toBeInTheDocument()
    await waitFor(() => expect(editButton().parentElement).toHaveStyle({ opacity: '1' }))
  })

  it('passes a tap on a closed row through to the link', async () => {
    const { onLink, onOpenChange } = renderRow()
    await userEvent.click(screen.getByRole('link', { name: "Soldier's Joy" }))
    expect(onLink).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes an open row on tap without following the link', async () => {
    const { onLink, closeOpenRow } = renderRow({ open: true })
    await userEvent.click(screen.getByRole('link', { name: "Soldier's Joy" }))
    expect(onLink).not.toHaveBeenCalled()
    expect(closeOpenRow).toHaveBeenCalledTimes(1)
  })

  it('closes the open row instead of following the link when another row is open', async () => {
    const { onLink, closeOpenRow } = renderRow({ otherOpen: true })
    await userEvent.click(screen.getByRole('link', { name: "Soldier's Joy" }))
    expect(onLink).not.toHaveBeenCalled()
    expect(closeOpenRow).toHaveBeenCalledTimes(1)
  })

  it('runs an action and closes the row', async () => {
    const { onEdit, onOpenChange } = renderRow({ open: true })
    await userEvent.click(editButton())
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('rests closed with inert actions while disabled, even when told it is open', () => {
    renderRow({ open: true, disabled: true })
    expect(editButton().parentElement).toHaveAttribute('inert')
    expect(editButton().parentElement).toHaveStyle({ opacity: '0' })
  })

  it('passes a tap through while disabled, even when another row is open', async () => {
    const { onLink, closeOpenRow } = renderRow({ otherOpen: true, disabled: true })
    await userEvent.click(screen.getByRole('link', { name: "Soldier's Joy" }))
    expect(onLink).toHaveBeenCalledTimes(1)
    expect(closeOpenRow).not.toHaveBeenCalled()
  })
})
