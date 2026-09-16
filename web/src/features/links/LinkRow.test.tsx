import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SwipeRowState } from '../../components/swipe'
import type { LocalRecordingLink } from '../../db/types'
import { linkRow } from '../../test/rows'
import { PlayerProvider } from '../player/PlayerProvider'
import { usePlayer, type Player } from '../player/usePlayer'
import { LinkRow } from './LinkRow'

const closedRow: SwipeRowState = {
  open: false,
  otherOpen: false,
  onOpenChange: () => {},
  onSwipeStart: () => {},
  closeOpenRow: () => {},
}

function Rows({
  links,
  onRemove,
}: {
  links: LocalRecordingLink[]
  onRemove: (id: string) => void
}) {
  return (
    <ul>
      {links.map((link) => (
        <LinkRow key={link.id} link={link} onRemove={onRemove} {...closedRow} />
      ))}
    </ul>
  )
}

const spotify = linkRow('l1', 's1', {
  url: 'https://open.spotify.com/track/403iATVGis7FqKA0BcTSRt',
  provider: 'spotify',
  provider_ref: 'track:403iATVGis7FqKA0BcTSRt',
  title: 'Spotify version',
})
const tidal = linkRow('l2', 's1', {
  url: 'https://tidal.com/track/45670321',
  provider: 'tidal',
  provider_ref: 'track:45670321',
  title: 'Ground Hog',
  position: 1,
})
const jam = linkRow('l3', 's1', {
  url: 'https://example.com/tune.mp3',
  provider: 'other',
  title: 'Jam recording',
  position: 2,
})

/** Hands the player out through a ref so tests can drive it from outside the tree. */
function Probe({ seenRef }: { seenRef: { current: Player | null } }) {
  const player = usePlayer()
  useEffect(() => {
    seenRef.current = player
  })
  return null
}

function renderList() {
  const seenRef: { current: Player | null } = { current: null }
  const onRemove = vi.fn()
  render(
    <PlayerProvider>
      <Probe seenRef={seenRef} />
      <Rows links={[spotify, tidal, jam]} onRemove={onRemove} />
    </PlayerProvider>,
  )
  const player = () => {
    if (!seenRef.current) throw new Error('the player probe did not render')
    return seenRef.current
  }
  return { player, onRemove }
}

describe('LinkRow', () => {
  it('plays a link and turns its row button into Close', async () => {
    const { player } = renderList()
    await userEvent.click(screen.getByRole('button', { name: 'Play Ground Hog' }))
    expect(player().item?.id).toBe('l2')

    const close = screen.getByRole('button', { name: 'Close Ground Hog player' })
    expect(close).not.toHaveAttribute('aria-pressed')
    expect(screen.queryByRole('button', { name: 'Play Ground Hog' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Play Spotify version' })).toBeInTheDocument()
  })

  it('closes a loaded link and turns its row button back into Play', async () => {
    const { player } = renderList()
    act(() => player().play({ kind: 'link', id: 'l1' }))

    await userEvent.click(screen.getByRole('button', { name: 'Close Spotify version player' }))
    expect(player().item).toBeNull()
    const play = screen.getByRole('button', { name: 'Play Spotify version' })
    expect(play).not.toHaveAttribute('aria-pressed')
  })

  it('disables Play while offline but keeps Close enabled for the loaded link', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { player } = renderList()
    act(() => player().play({ kind: 'link', id: 'l1' }))
    const play = screen.getByRole('button', { name: 'Play Ground Hog' })
    expect(play).toHaveAttribute('aria-disabled', 'true')
    expect(play).not.toBeDisabled()
    const close = screen.getByRole('button', { name: 'Close Spotify version player' })
    expect(close).toBeEnabled()
    expect(close).not.toHaveAttribute('aria-disabled')

    play.focus()
    await userEvent.keyboard('{Enter}')
    expect(player().item?.id).toBe('l1')
    await userEvent.keyboard(' ')
    expect(player().item?.id).toBe('l1')
    expect(play).toHaveFocus()
    await userEvent.click(play)
    expect(player().item?.id).toBe('l1')
  })

  it('keeps focus on the row button after Close while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { player } = renderList()
    act(() => player().play({ kind: 'link', id: 'l1' }))

    await userEvent.click(screen.getByRole('button', { name: 'Close Spotify version player' }))
    expect(player().item).toBeNull()
    const play = screen.getByRole('button', { name: 'Play Spotify version' })
    expect(play).toHaveFocus()
    expect(play).toHaveAttribute('aria-disabled', 'true')
  })

  it('names the service on the open button and shows only that for a link without a player', () => {
    renderList()
    const open = screen.getByRole('link', { name: 'Open Ground Hog on TIDAL' })
    expect(open).toHaveTextContent('TIDAL')
    expect(open).toHaveAttribute('href', 'https://tidal.com/track/45670321')
    expect(screen.getByRole('link', { name: 'Open Jam recording on Link' })).toHaveTextContent(
      'Open',
    )
    expect(screen.queryByRole('button', { name: /^(Play|Close) Jam recording/ })).toBeNull()
  })

  it('removes a link from its swipe action', async () => {
    const { onRemove } = renderList()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ground Hog' }))
    expect(onRemove).toHaveBeenCalledWith('l2')
  })

  it('gives every row control at least a 44px target', () => {
    const { player } = renderList()
    act(() => player().play({ kind: 'link', id: 'l1' }))
    expect(screen.getByRole('button', { name: 'Play Ground Hog' })).toHaveClass('min-h-14')
    expect(screen.getByRole('button', { name: 'Close Spotify version player' })).toHaveClass(
      'min-h-14',
    )
    expect(screen.getByRole('link', { name: 'Open Ground Hog on TIDAL' })).toHaveClass('min-h-11')
  })
})
