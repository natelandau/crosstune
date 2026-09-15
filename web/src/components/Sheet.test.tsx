import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet'

describe('Sheet', () => {
  it('shows a dialog named by its title while open', () => {
    render(
      <Sheet open title="Set status for 3 songs" onClose={vi.fn()}>
        <button type="button">Known</button>
      </Sheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Set status for 3 songs' })
    expect(dialog).toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Known' })).toBeInTheDocument()
  })

  it('hides its content while closed', () => {
    render(
      <Sheet open={false} title="Set status" onClose={vi.fn()}>
        <button type="button">Known</button>
      </Sheet>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Known' })).toBeNull()
  })

  it('reports a close that did not come from its open prop', () => {
    const onClose = vi.fn()
    render(
      <Sheet open title="Set status" onClose={onClose}>
        <p>Body</p>
      </Sheet>,
    )
    ;(screen.getByRole('dialog') as HTMLDialogElement).close()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when its open prop turns off', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Sheet open title="Set status" onClose={onClose}>
        <p>Body</p>
      </Sheet>,
    )
    rerender(
      <Sheet open={false} title="Set status" onClose={onClose}>
        <p>Body</p>
      </Sheet>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders no backdrop form when it is not dismissible', () => {
    render(
      <Sheet open title="Save recording" onClose={vi.fn()} dismissible={false}>
        <p>Body</p>
      </Sheet>,
    )
    expect(document.querySelector('form.modal-backdrop')).toBeNull()
  })

  it('stays open through Escape when it is not dismissible', () => {
    const onClose = vi.fn()
    render(
      <Sheet open title="Save recording" onClose={onClose} dismissible={false}>
        <p>Body</p>
      </Sheet>,
    )
    const dialog = screen.getByRole('dialog') as HTMLDialogElement
    const event = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(dialog).toHaveAttribute('open')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets Escape close a dismissible sheet', () => {
    render(
      <Sheet open title="Set status" onClose={vi.fn()}>
        <p>Body</p>
      </Sheet>,
    )
    const dialog = screen.getByRole('dialog') as HTMLDialogElement
    const event = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
