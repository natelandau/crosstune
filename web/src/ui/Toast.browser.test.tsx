import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { renderHookWithProviders, renderWithProviders } from '../test/render'
import { Button } from './Button'
import { UNDO, useToast } from './Toast'

const undoButton = () => page.getByRole('button', { name: UNDO })

it('drops Undo from the toast it names', async () => {
  const { result } = renderHookWithProviders(() => useToast())
  let id = 0
  act(() => {
    id = result.current.show("Added Soldier's Joy", () => {})
  })
  await expect.element(undoButton()).toBeVisible()
  act(() => result.current.dropUndo(id))
  await expect.element(page.getByText("Added Soldier's Joy")).toBeVisible()
  await expect.element(undoButton()).not.toBeInTheDocument()
})

it('leaves a newer toast alone', async () => {
  const { result } = renderHookWithProviders(() => useToast())
  let old = 0
  act(() => {
    old = result.current.show('a', () => {})
  })
  act(() => void result.current.show('b', () => {}))
  act(() => result.current.dropUndo(old))
  await expect.element(page.getByText('b')).toBeVisible()
  await expect.element(undoButton()).toBeVisible()
})

it('keeps focus out of a dropped Undo', async () => {
  let toast: ReturnType<typeof useToast> | undefined
  function Host() {
    toast = useToast()
    return <Button label="Origin" onPress={() => {}} />
  }
  renderWithProviders(<Host />)
  const origin = page.getByRole('button', { name: 'Origin' }).element() as HTMLElement
  origin.focus()
  let id = 0
  act(() => {
    id = toast!.show('Added', vi.fn())
  })
  await expect.element(undoButton()).toBeVisible()
  act(() => (undoButton().element() as HTMLElement).focus())
  await expect.element(undoButton()).toHaveFocus()
  act(() => toast!.dropUndo(id))
  await expect.element(undoButton()).not.toBeInTheDocument()
  await expect.poll(() => document.activeElement).toBe(origin)
})
