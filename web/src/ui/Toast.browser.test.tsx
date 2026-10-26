import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { keyPlatform } from '../platform/keyPlatform'
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

const commandZ = () => {
  const command = keyPlatform() === 'mac' ? 'Meta' : 'Control'
  return userEvent.keyboard(`{${command}>}z{/${command}}`)
}

it('presses Undo on Cmd-Z or Ctrl-Z', async () => {
  const { result } = renderHookWithProviders(() => useToast())
  const undo = vi.fn()
  act(() => void result.current.show('Archived Old Joe', undo))
  await expect.element(undoButton()).toBeVisible()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await commandZ()
  await expect.poll(() => undo.mock.calls.length).toBe(1)
  await expect.element(undoButton()).not.toBeInTheDocument()
})

it('leaves Cmd-Z or Ctrl-Z to a text field', async () => {
  let toast: ReturnType<typeof useToast> | undefined
  function Host() {
    toast = useToast()
    return <input aria-label="Name" />
  }
  renderWithProviders(<Host />)
  const undo = vi.fn()
  act(() => void toast!.show('Archived Old Joe', undo))
  await expect.element(undoButton()).toBeVisible()
  const field = page.getByRole('textbox', { name: 'Name' })
  await field.fill('Kesh')
  await commandZ()
  // The field's own undo took the press.
  await expect.element(field).toHaveValue('')
  expect(undo).not.toHaveBeenCalled()
  await expect.element(undoButton()).toBeVisible()
})
