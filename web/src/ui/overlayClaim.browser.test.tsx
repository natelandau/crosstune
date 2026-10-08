import { useEffect, useState } from 'react'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { readBackEntries } from '../app/backEntries'
import { renderWithProviders } from '../test/render'
import { Picker } from './form/Picker'
import { SuggestField } from './form/SuggestField'
import { renderHookWithProviders } from '../test/render'
import { useOnTop, useOverlayClaim, useShellCovered } from './overlayClaim'

const close = () => {}

/** Shows a claimed overlay, and hands `onHide` the way to take it off the page. */
function ClaimHost({ onHide }: { onHide: (hide: () => void) => void }) {
  const [shown, setShown] = useState(true)
  useEffect(() => onHide(() => setShown(false)), [onHide])
  return shown ? <Claimed /> : null
}

function Claimed() {
  useOverlayClaim({ coversShell: true, close })
  return <div role="dialog" aria-label="Claimed" />
}

it('lets go in the same commit that takes the overlay off the page', async () => {
  let hide = () => {}
  renderWithProviders(<ClaimHost onHide={(handed) => (hide = handed)} />)
  await expect.element(page.getByRole('dialog', { name: 'Claimed' })).toBeInTheDocument()
  await expect.poll(() => readBackEntries().length).toBe(1)
  // A mutation observer runs as soon as the commit's task ends, before React's passive effects,
  // which a busy page can run later. Anything that reads the stack in that gap, such as a key
  // listener, must already see the overlay gone.
  const heldAfterRemoval = new Promise<number>((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.querySelector('[aria-label="Claimed"]')) return
      observer.disconnect()
      resolve(readBackEntries().length)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
  // From a timer, so the update is not a discrete one, whose effects React flushes at once.
  setTimeout(() => hide())
  expect(await heldAfterRemoval).toBe(0)
})

it('is on top only while it is the latest claim still held', async () => {
  const under = renderHookWithProviders(() => useOverlayClaim({ coversShell: true, close }))
  await expect.poll(() => under.result.current()).toBe(true)

  const over = renderHookWithProviders(
    ({ active }: { active: boolean }) => useOverlayClaim({ active, close }),
    {
      initialProps: { active: true },
    },
  )
  await expect.poll(() => over.result.current()).toBe(true)
  await expect.poll(() => under.result.current()).toBe(false)

  over.rerender({ active: false })
  await expect.poll(() => over.result.current()).toBe(false)
  await expect.poll(() => under.result.current()).toBe(true)

  under.unmount()
  await expect.poll(() => under.result.current()).toBe(false)
})

it('keeps its place under a later claim when it stops covering the shell', async () => {
  const under = renderHookWithProviders(
    ({ coversShell }: { coversShell: boolean }) => ({
      isTop: useOverlayClaim({ coversShell, close }),
      covered: useShellCovered(),
    }),
    { initialProps: { coversShell: true } },
  )
  const over = renderHookWithProviders(() => useOverlayClaim({ close }))
  await expect.poll(() => over.result.current()).toBe(true)

  under.rerender({ coversShell: false })
  await expect.poll(() => under.result.current.covered).toBe(false)
  await expect.poll(() => under.result.current.isTop()).toBe(false)
  await expect.poll(() => over.result.current()).toBe(true)
})

it('reports being on top as state, so an overlay can wait for one stacked over it', async () => {
  const under = renderHookWithProviders(() => {
    const isTop = useOverlayClaim({ close })
    return useOnTop(isTop)
  })
  await expect.poll(() => under.result.current).toBe(true)

  const over = renderHookWithProviders(() => useOverlayClaim({ close }))
  await expect.poll(() => under.result.current).toBe(false)

  over.unmount()
  await expect.poll(() => under.result.current).toBe(true)
})

const overlayEntries = () => readBackEntries().filter((entry) => entry.layer === 'overlay').length

it('claims only while a picker or suggest field shows its list', async () => {
  renderWithProviders(
    <>
      <Picker
        label="Type"
        value={null}
        options={[{ id: 'reel', label: 'reel' }]}
        emptyLabel="Any"
        onChange={() => {}}
      />
      <SuggestField label="Composer" value="" suggestions={['Ed Haley']} onChange={() => {}} />
    </>,
  )
  await expect.element(page.getByRole('combobox', { name: 'Composer' })).toBeVisible()
  await expect.poll(overlayEntries).toBe(0)

  await page.getByRole('button', { name: /Type/ }).click()
  await expect.element(page.getByRole('option', { name: 'reel' })).toBeVisible()
  await expect.poll(overlayEntries).toBe(1)
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('option', { name: 'reel' })).not.toBeInTheDocument()
  await expect.poll(overlayEntries).toBe(0)

  await page.getByRole('combobox', { name: 'Composer' }).click()
  await expect.element(page.getByRole('option', { name: 'Ed Haley' })).toBeVisible()
  await expect.poll(overlayEntries).toBe(1)
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('option', { name: 'Ed Haley' })).not.toBeInTheDocument()
  await expect.poll(overlayEntries).toBe(0)
})
