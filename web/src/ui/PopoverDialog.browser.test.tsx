import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { PopoverDialog } from './PopoverDialog'

const LABEL = 'Keys'

function Harness({ onToggle }: { onToggle: (set: (open: boolean) => void) => void }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => onToggle(setOpen), [onToggle])
  return (
    <>
      <button ref={trigger} type="button" style={{ marginInlineStart: 120 }}>
        Open
      </button>
      <PopoverDialog label={LABEL} triggerRef={trigger} isOpen={open} onOpenChange={setOpen}>
        <p>Pick a key</p>
      </PopoverDialog>
    </>
  )
}

/** Mounts the harness and returns a toggle that lands before any frame can run. */
async function mounted() {
  let set: ((open: boolean) => void) | null = null
  renderWithProviders(<Harness onToggle={(next) => (set = next)} />, { density: 'pointer' })
  await expect.poll(() => set).not.toBeNull()
  return async (open: boolean) => {
    flushSync(() => set!(open))
    await Promise.resolve()
  }
}

const surface = () =>
  page.getByRole('dialog', { name: LABEL }).element().closest<HTMLElement>('.popover-surface')!

it('scales in from the point it hangs from on the trigger', async () => {
  const toggle = await mounted()
  await toggle(true)
  const popover = surface()
  expect(popover.hasAttribute('data-entering')).toBe(true)
  expect(popover.getAnimations().map((a) => (a as CSSAnimation).animationName)).toEqual([
    'popover-in',
  ])
  const anchor = popover.style.getPropertyValue('--trigger-anchor-point')
  expect(anchor).not.toBe('')
  expect(getComputedStyle(popover).transformOrigin).toBe(anchor)
})

it('scales back out on close, taking no presses while it goes', async () => {
  const toggle = await mounted()
  await toggle(true)
  await expect.element(page.getByRole('dialog', { name: LABEL })).toBeVisible()
  await expect.poll(() => surface().hasAttribute('data-entering')).toBe(false)
  const popover = surface()
  await toggle(false)
  expect(popover.hasAttribute('data-exiting')).toBe(true)
  expect(popover.getAnimations().map((a) => (a as CSSAnimation).animationName)).toEqual([
    'popover-in',
  ])
  expect(getComputedStyle(popover).pointerEvents).toBe('none')
  await expect.element(page.getByRole('dialog', { name: LABEL })).not.toBeInTheDocument()
})
