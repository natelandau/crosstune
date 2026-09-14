import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { linkRow } from '../../test/rows'
import { PlayerProvider } from '../player/PlayerProvider'
import { usePlayer, type Player } from '../player/usePlayer'
import { LinkList } from './LinkList'

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

function renderList() {
  const seen: { current: Player | null } = { current: null }
  function Probe() {
    seen.current = usePlayer()
    return null
  }
  render(
    <PlayerProvider>
      <Probe />
      <LinkList links={[spotify, tidal, jam]} onRemove={vi.fn()} />
    </PlayerProvider>,
  )
  const player = () => {
    if (!seen.current) throw new Error('the player probe did not render')
    return seen.current
  }
  return { player }
}

describe('LinkList', () => {
  it('plays a link and turns its row button into Close', async () => {
    const { player } = renderList()
    await userEvent.click(screen.getByRole('button', { name: 'Play Ground Hog' }))
    expect(player().linkId).toBe('l2')

    const close = screen.getByRole('button', { name: 'Close Ground Hog player' })
    expect(close).toHaveTextContent('Close')
    expect(close).not.toHaveAttribute('aria-pressed')
    expect(screen.queryByRole('button', { name: 'Play Ground Hog' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Play Spotify version' })).toHaveTextContent('Play')
  })

  it('closes a loaded link and turns its row button back into Play', async () => {
    const { player } = renderList()
    act(() => player().play('l1'))

    await userEvent.click(screen.getByRole('button', { name: 'Close Spotify version player' }))
    expect(player().linkId).toBeNull()
    const play = screen.getByRole('button', { name: 'Play Spotify version' })
    expect(play).toHaveTextContent('Play')
    expect(play).not.toHaveAttribute('aria-pressed')
  })

  it('disables Play while offline but keeps Close enabled for the loaded link', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { player } = renderList()
    act(() => player().play('l1'))
    const play = screen.getByRole('button', { name: 'Play Ground Hog' })
    expect(play).toHaveAttribute('aria-disabled', 'true')
    expect(play).not.toBeDisabled()
    const close = screen.getByRole('button', { name: 'Close Spotify version player' })
    expect(close).toBeEnabled()
    expect(close).not.toHaveAttribute('aria-disabled')

    play.focus()
    await userEvent.keyboard('{Enter}')
    expect(player().linkId).toBe('l1')
    await userEvent.keyboard(' ')
    expect(player().linkId).toBe('l1')
    expect(play).toHaveFocus()
    await userEvent.click(play)
    expect(player().linkId).toBe('l1')
  })

  it('keeps focus on the row button after Close while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { player } = renderList()
    act(() => player().play('l1'))

    await userEvent.click(screen.getByRole('button', { name: 'Close Spotify version player' }))
    expect(player().linkId).toBeNull()
    const play = screen.getByRole('button', { name: 'Play Spotify version' })
    expect(play).toHaveFocus()
    expect(play).toHaveAttribute('aria-disabled', 'true')
  })

  it('shows only Open for a link without a player', () => {
    renderList()
    expect(screen.getByRole('link', { name: 'Open Jam recording' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Play|Close) Jam recording/ })).toBeNull()
  })

  it('gives every row control a 44px target', () => {
    const { player } = renderList()
    act(() => player().play('l1'))
    for (const control of [
      screen.getByRole('button', { name: 'Play Ground Hog' }),
      screen.getByRole('button', { name: 'Close Spotify version player' }),
      screen.getByRole('link', { name: 'Open Ground Hog' }),
      screen.getByRole('button', { name: 'Remove Ground Hog' }),
    ]) {
      expect(control).toHaveClass('min-h-11', 'min-w-11')
    }
  })
})
