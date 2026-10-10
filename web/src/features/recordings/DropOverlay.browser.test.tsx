import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import { renderWithProviders } from '../../test/render'
import { DROP_TO_IMPORT, DropOverlay } from './DropOverlay'

function Overlay({ onShow }: { onShow: (show: (shown: boolean) => void) => void }) {
  const [shown, setShown] = useState(false)
  useEffect(() => onShow(setShown), [onShow])
  return <DropOverlay shown={shown} />
}

async function mounted(): Promise<(shown: boolean) => void> {
  let show: ((shown: boolean) => void) | null = null
  renderWithProviders(<Overlay onShow={(next) => (show = next)} />)
  await expect.poll(() => show).not.toBeNull()
  return (shown) => flushSync(() => show!(shown))
}

const overlay = () => document.querySelector<HTMLElement>('[data-drop-overlay]')

it('fades in when files are dragged over, rather than appearing at once', async () => {
  const show = await mounted()
  show(true)
  // Read before any frame runs, so the fade cannot have finished.
  expect(Number(getComputedStyle(overlay()!).opacity)).toBeLessThan(1)
  await expect.poll(() => getComputedStyle(overlay()!).opacity).toBe('1')
  await expect.element(page.getByText(DROP_TO_IMPORT)).toBeInTheDocument()
})

it('is gone once the drag leaves', async () => {
  const show = await mounted()
  show(true)
  await expect.poll(() => getComputedStyle(overlay()!).opacity).toBe('1')
  show(false)
  await expect.poll(overlay).toBeNull()
})
