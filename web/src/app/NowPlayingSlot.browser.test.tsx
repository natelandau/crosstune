import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { NowPlayingProvider, NowPlayingSlot, useNowPlaying } from './NowPlayingSlot'

function Filler({ show }: { show: boolean }) {
  const { set } = useNowPlaying()
  useEffect(() => {
    set(show ? <p>Playing Angeline</p> : null)
  }, [set, show])
  return null
}

it('reserves nothing while empty and shows what the player docks', async () => {
  const { container, rerender } = render(
    <NowPlayingProvider>
      <Filler show={false} />
      <NowPlayingSlot />
    </NowPlayingProvider>,
  )
  expect(container.querySelector('[data-now-playing]')).toBeNull()
  await act(async () => {
    rerender(
      <NowPlayingProvider>
        <Filler show />
        <NowPlayingSlot />
      </NowPlayingProvider>,
    )
  })
  await expect.element(page.getByText('Playing Angeline')).toBeVisible()
})

it('moves the docked node to a higher slot without reloading it', async () => {
  const proto = Element.prototype as unknown as {
    moveBefore: (node: Node, child: Node | null) => void
  }
  const move = vi.spyOn(proto, 'moveBefore')
  const tree = (both: boolean) => (
    <NowPlayingProvider>
      <Filler show />
      <NowPlayingSlot />
      {both && <NowPlayingSlot priority={1} />}
    </NowPlayingProvider>
  )
  const { rerender } = render(tree(false))
  await expect.element(page.getByText('Playing Angeline')).toBeVisible()
  await act(async () => {
    rerender(tree(true))
  })
  await expect.poll(() => move.mock.calls.length).toBeGreaterThan(0)
  await expect.element(page.getByText('Playing Angeline')).toBeVisible()
})
