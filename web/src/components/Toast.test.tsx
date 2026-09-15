import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from './Toast'
import { TOAST_MS, useToast } from './toastContext'

function Harness({ undo }: { undo?: () => Promise<void> }) {
  const toast = useToast()
  return (
    <main tabIndex={-1}>
      <button type="button" onClick={() => toast.show({ message: 'Archived 3 songs', undo })}>
        Archive
      </button>
      <button type="button" onClick={() => toast.show({ message: 'Edited 2 songs' })}>
        Edit
      </button>
    </main>
  )
}

function renderHarness(undo?: () => Promise<void>) {
  render(
    <ToastProvider>
      <Harness undo={undo} />
    </ToastProvider>,
  )
}

const toastBox = () => screen.getByRole('status').parentElement!

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Toast', () => {
  it('announces the message and closes after eight seconds', () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(screen.getByRole('status')).toHaveTextContent('Archived 3 songs')
    expect(toastBox()).toHaveAttribute('data-state', 'open')
    act(() => vi.advanceTimersByTime(TOAST_MS - 1))
    expect(toastBox()).toHaveAttribute('data-state', 'open')
    act(() => vi.advanceTimersByTime(1))
    expect(toastBox()).toHaveAttribute('data-state', 'closed')
    act(() => vi.advanceTimersByTime(0))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('keeps the message until the exit transition has run', () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    toastBox().style.transitionDuration = '400ms'
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    act(() => vi.advanceTimersByTime(399))
    expect(screen.getByRole('status')).toHaveTextContent('Archived 3 songs')
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('keeps the live region out of the inert part while closed', () => {
    renderHarness()
    expect(screen.getByRole('status').closest('[inert]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByRole('status').closest('[inert]')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Dismiss', hidden: true }).closest('[inert]'),
    ).not.toBeNull()
  })

  it('pauses its timer while hovered', () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.mouseEnter(toastBox())
    act(() => vi.advanceTimersByTime(TOAST_MS * 2))
    expect(toastBox()).toHaveAttribute('data-state', 'open')
    fireEvent.mouseLeave(toastBox())
    act(() => vi.advanceTimersByTime(TOAST_MS))
    expect(toastBox()).toHaveAttribute('data-state', 'closed')
  })

  it('pauses its timer while it holds focus', () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    act(() => screen.getByRole('button', { name: 'Dismiss' }).focus())
    act(() => vi.advanceTimersByTime(TOAST_MS * 2))
    expect(toastBox()).toHaveAttribute('data-state', 'open')
  })

  it('replaces the current toast with a new one', () => {
    renderHarness(vi.fn().mockResolvedValue(undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('status')).toHaveTextContent('Edited 2 songs')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('runs undo once and closes', async () => {
    const undo = vi.fn().mockResolvedValue(undefined)
    renderHarness(undo)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await act(async () => {})
    expect(undo).toHaveBeenCalledTimes(1)
    expect(toastBox()).toHaveAttribute('data-state', 'closed')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('shows the error when undo fails', async () => {
    renderHarness(vi.fn().mockRejectedValue(new Error('Song not found')))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await act(async () => {})
    expect(screen.getByRole('status')).toHaveTextContent('Song not found')
    expect(toastBox()).toHaveAttribute('data-state', 'open')
  })

  it('closes from the dismiss button', () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(toastBox()).toHaveAttribute('data-state', 'closed')
  })

  it('stays open while it has hover or focus', () => {
    renderHarness(vi.fn().mockResolvedValue(undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.mouseEnter(toastBox())
    act(() => screen.getByRole('button', { name: 'Undo' }).focus())
    fireEvent.mouseLeave(toastBox())
    act(() => vi.advanceTimersByTime(TOAST_MS * 2))
    expect(toastBox()).toHaveAttribute('data-state', 'open')
    fireEvent.blur(screen.getByRole('button', { name: 'Undo' }))
    act(() => vi.advanceTimersByTime(TOAST_MS))
    expect(toastBox()).toHaveAttribute('data-state', 'closed')
  })

  it('closes later toasts on time after Undo is tapped while focused', async () => {
    renderHarness(vi.fn().mockResolvedValue(undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    act(() => screen.getByRole('button', { name: 'Undo' }).focus())
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    act(() => vi.advanceTimersByTime(TOAST_MS))
    expect(toastBox()).toHaveAttribute('data-state', 'closed')
  })

  it('closes on time when a replacement removes the focused Undo button', () => {
    renderHarness(vi.fn().mockResolvedValue(undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    act(() => screen.getByRole('button', { name: 'Undo' }).focus())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    act(() => vi.advanceTimersByTime(TOAST_MS))
    expect(toastBox()).toHaveAttribute('data-state', 'closed')
  })

  it('moves focus to the page when the toast hides while holding it', () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    act(() => dismiss.focus())
    fireEvent.click(dismiss)
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })
})
