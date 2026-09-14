import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { addLink, removeLink } from '../../commands/links'
import { createSong } from '../../commands/songs'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecordingLink } from '../../db/types'
import { openTestDb } from '../../test/db'
import { renderApp, renderWithProviders } from '../../test/render'
import { LinkList } from '../links/LinkList'
import { PlayerDock } from './PlayerDock'
import { PlayerProvider } from './PlayerProvider'
import { usePlayer, type Player } from './usePlayer'

const routed = vi.hoisted(() => ({ linkId: '' }))

// A Play control on the catalog route loads a link from inside the real route tree.
vi.mock('../catalog/CatalogScreen', async () => {
  const { usePlayer } = await import('./usePlayer')
  return {
    CatalogScreen: function CatalogScreen() {
      const { play } = usePlayer()
      return (
        <button type="button" onClick={() => play(routed.linkId)}>
          Test play
        </button>
      )
    },
  }
})

let db: CrosstuneDb
let songId: string

beforeEach(async () => {
  db = openTestDb()
  songId = (await createSong(db, { title: 'Cluck Old Hen' }, { status: 'learning' })).songId
})

afterEach(async () => {
  await db.delete()
})

function addYouTube() {
  return addLink(db, songId, {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    provider: 'youtube',
    provider_ref: 'dQw4w9WgXcQ',
    title: 'Cluck Old Hen on YouTube',
  })
}

function addSpotify() {
  return addLink(db, songId, {
    url: 'https://open.spotify.com/track/403iATVGis7FqKA0BcTSRt',
    provider: 'spotify',
    provider_ref: 'track:403iATVGis7FqKA0BcTSRt',
    title: 'Soldiers Joy on Spotify',
  })
}

async function renderDock() {
  const seen: { current: Player | null } = { current: null }
  function Probe() {
    seen.current = usePlayer()
    return null
  }
  renderWithProviders(
    <PlayerProvider>
      <Probe />
      <PlayerDock />
    </PlayerProvider>,
    { db },
  )
  await waitFor(() => expect(seen.current).not.toBeNull())
  const player = () => {
    if (!seen.current) throw new Error('the player probe did not render')
    return seen.current
  }
  return { player }
}

function iframeIn(region: HTMLElement): HTMLIFrameElement {
  const frame = region.querySelector('iframe')
  if (!frame) throw new Error('no iframe in the player')
  return frame
}

describe('PlayerDock', () => {
  it('renders nothing while nothing is loaded', async () => {
    const { player } = await renderDock()
    expect(player().linkId).toBeNull()
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('shows the title, a close button, and an autoplaying player after play', async () => {
    const linkId = await addYouTube()
    const { player } = await renderDock()
    act(() => player().play(linkId))

    const region = await screen.findByRole('region', { name: 'Player' })
    expect(within(region).getByText('Cluck Old Hen on YouTube')).toBeInTheDocument()
    const close = within(region).getByRole('button', { name: 'Close player' })
    expect(close).toHaveClass('min-h-11', 'min-w-11')
    const frame = iframeIn(region)
    expect(frame.src).toContain('autoplay=1')
    expect(frame).toHaveAttribute('title', 'Cluck Old Hen on YouTube')
    expect(frame).toHaveAttribute('height', '200')
  })

  it('sizes and sandboxes an Apple Music player from its embed', async () => {
    const linkId = await addLink(db, songId, {
      url: 'https://music.apple.com/us/album/roaring-river/148243382?i=148243927',
      provider: 'apple_music',
      title: 'Roaring River',
    })
    const { player } = await renderDock()
    act(() => player().play(linkId))

    const frame = iframeIn(await screen.findByRole('region', { name: 'Player' }))
    expect(frame).toHaveAttribute('height', '175')
    expect(frame.getAttribute('sandbox')).toContain('allow-storage-access-by-user-activation')
  })

  it('reserves in-flow space as tall as the docked player', async () => {
    const linkId = await addYouTube()
    const { player } = await renderDock()
    act(() => player().play(linkId))

    const region = await screen.findByRole('region', { name: 'Player' })
    const spacer = region.previousElementSibling as HTMLElement | null
    expect(spacer).not.toBeNull()
    // p-1.5 above and below, the 44px header, and the 200px video player.
    expect(region.style.height).toBe('256px')
    expect(spacer?.style.height).toBe(region.style.height)
    expect(region).toHaveClass('p-1.5')
  })

  it('keeps the dock mounted while a replacement recording is read', async () => {
    const first = await addYouTube()
    const second = await addSpotify()
    const { player } = await renderDock()
    act(() => player().play(first))
    const region = await screen.findByRole('region', { name: 'Player' })
    const spacer = region.previousElementSibling

    act(() => player().play(second))
    expect(screen.getByRole('region', { name: 'Player' })).toBe(region)

    await waitFor(() => expect(within(region).getByText('Soldiers Joy on Spotify')).toBeVisible())
    expect(within(region).queryByText('Cluck Old Hen on YouTube')).toBeNull()
    expect(screen.getByRole('region', { name: 'Player' })).toBe(region)
    expect(region.previousElementSibling).toBe(spacer)
    expect(iframeIn(region).src).toBe('https://open.spotify.com/embed/track/403iATVGis7FqKA0BcTSRt')
    expect(region.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('does not show a closed recording while the next one is read', async () => {
    const first = await addYouTube()
    const second = await addSpotify()
    const { player } = await renderDock()
    act(() => player().play(first))
    await screen.findByRole('region', { name: 'Player' })
    await userEvent.click(screen.getByRole('button', { name: 'Close player' }))

    act(() => player().play(second))
    expect(screen.queryByText('Cluck Old Hen on YouTube')).toBeNull()
    expect(
      within(await screen.findByRole('region', { name: 'Player' })).getByText(
        'Soldiers Joy on Spotify',
      ),
    ).toBeVisible()
  })

  it('mounts a fresh player when the embed changes', async () => {
    const apple = await addLink(db, songId, {
      url: 'https://music.apple.com/us/album/roaring-river/148243382?i=148243927',
      provider: 'apple_music',
      title: 'Roaring River',
    })
    const youtube = await addYouTube()
    const { player } = await renderDock()
    act(() => player().play(apple))
    const region = await screen.findByRole('region', { name: 'Player' })
    const sandboxed = iframeIn(region)

    act(() => player().play(youtube))
    await waitFor(() => expect(iframeIn(region).src).toContain('youtube-nocookie.com'))
    const video = iframeIn(region)
    expect(video).not.toBe(sandboxed)
    expect(video).not.toHaveAttribute('sandbox')
  })

  it('closes the player from its close button', async () => {
    const linkId = await addYouTube()
    const { player } = await renderDock()
    act(() => player().play(linkId))

    await userEvent.click(await screen.findByRole('button', { name: 'Close player' }))
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
    expect(player().linkId).toBeNull()
  })

  it('closes when the loaded link is removed', async () => {
    const linkId = await addYouTube()
    const { player } = await renderDock()
    act(() => player().play(linkId))
    await screen.findByRole('region', { name: 'Player' })

    await removeLink(db, linkId)
    await waitFor(() => expect(player().linkId).toBeNull())
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
  })

  it('closes when the loaded link has no player', async () => {
    const linkId = await addLink(db, songId, {
      url: 'https://example.com/cluck-old-hen',
      provider: 'other',
    })
    const { player } = await renderDock()
    act(() => player().play(linkId))

    await waitFor(() => expect(player().linkId).toBeNull())
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
  })

  it('closes when the loaded link does not exist', async () => {
    const { player } = await renderDock()
    act(() => player().play('missing'))

    await waitFor(() => expect(player().linkId).toBeNull())
  })

  it('drops the loaded recording when the database changes', async () => {
    const linkId = await addYouTube()
    const other = openTestDb()
    const swap: { current: ((next: CrosstuneDb) => void) | null } = { current: null }
    const seen: { current: Player | null } = { current: null }
    function SwappableDb({ children }: { children: ReactNode }) {
      const [current, setCurrent] = useState(db)
      swap.current = setCurrent
      return <DbContext.Provider value={current}>{children}</DbContext.Provider>
    }
    function Probe() {
      seen.current = usePlayer()
      return null
    }
    try {
      renderWithProviders(
        <SwappableDb>
          <PlayerProvider>
            <Probe />
            <PlayerDock />
          </PlayerProvider>
        </SwappableDb>,
        { db },
      )
      await waitFor(() => expect(seen.current).not.toBeNull())
      act(() => seen.current?.play(linkId))
      await screen.findByRole('region', { name: 'Player' })

      act(() => swap.current?.(other))
      expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
      expect(seen.current?.linkId).toBeNull()
    } finally {
      await other.delete()
    }
  })

  describe('focus', () => {
    async function renderWithList(linkId: string) {
      const row = await db.recording_links.get(linkId)
      if (!row) throw new Error('the link was not saved')
      const loaded = row
      const list: { set: ((links: LocalRecordingLink[]) => void) | null } = { set: null }
      function Links() {
        const [links, setLinks] = useState<LocalRecordingLink[]>([loaded])
        list.set = setLinks
        return <LinkList links={links} onRemove={vi.fn()} />
      }
      renderWithProviders(
        <PlayerProvider>
          <main tabIndex={-1}>
            <Links />
            <PlayerDock />
          </main>
        </PlayerProvider>,
        { db },
      )
      await userEvent.click(
        await screen.findByRole('button', { name: 'Play Cluck Old Hen on YouTube' }),
      )
      const region = await screen.findByRole('region', { name: 'Player' })
      const setLinks = (links: LocalRecordingLink[]) => act(() => list.set?.(links))
      return { region, setLinks }
    }

    /** Records the accessible name of each element as focus lands on it. */
    function recordFocus() {
      const landed: string[] = []
      const onFocus = (event: FocusEvent) => {
        const target = event.target as HTMLElement
        landed.push(target.getAttribute('aria-label') ?? target.tagName.toLowerCase())
      }
      document.addEventListener('focusin', onFocus)
      onTestFinished(() => document.removeEventListener('focusin', onFocus))
      return landed
    }

    it('returns focus to the opening control after Close player', async () => {
      await renderWithList(await addYouTube())

      await userEvent.click(screen.getByRole('button', { name: 'Close player' }))
      expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Play Cluck Old Hen on YouTube' })).toHaveFocus()
    })

    it('returns focus to the opening control when the player closes itself', async () => {
      const linkId = await addYouTube()
      const { region } = await renderWithList(linkId)
      act(() => within(region).getByRole('button', { name: 'Close player' }).focus())
      const landed = recordFocus()

      await removeLink(db, linkId)
      await waitFor(() => expect(landed).toEqual(['Play Cluck Old Hen on YouTube']))
      expect(screen.getByRole('button', { name: 'Play Cluck Old Hen on YouTube' })).toHaveFocus()
      expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
    })

    it('moves focus to the main region when the opening row leaves after the player closes itself', async () => {
      const frames: FrameRequestCallback[] = []
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback)
        return frames.length
      })
      const linkId = await addYouTube()
      const { region, setLinks } = await renderWithList(linkId)
      act(() => within(region).getByRole('button', { name: 'Close player' }).focus())
      const landed = recordFocus()

      await removeLink(db, linkId)
      await waitFor(() => expect(landed).toEqual(['Play Cluck Old Hen on YouTube']))
      setLinks([])
      expect(document.body).toHaveFocus()

      act(() => {
        for (const frame of frames.splice(0)) frame(performance.now())
      })
      expect(landed).toEqual(['Play Cluck Old Hen on YouTube', 'main'])
    })

    it('keeps focus on the row button when the row closes the player', async () => {
      await renderWithList(await addYouTube())

      await userEvent.click(
        screen.getByRole('button', { name: 'Close Cluck Old Hen on YouTube player' }),
      )
      expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Play Cluck Old Hen on YouTube' })).toHaveFocus()
    })

    it('leaves focus alone when the player closes while focus is elsewhere', async () => {
      const linkId = await addYouTube()
      await renderWithList(linkId)
      act(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })

      await removeLink(db, linkId)
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Player' })).toBeNull())
      expect(document.body).toHaveFocus()
    })

    it('moves focus to the main region when the opening control is gone', async () => {
      routed.linkId = await addYouTube()
      const { router } = renderApp({ db })
      await userEvent.click(await screen.findByRole('button', { name: 'Test play' }))
      await screen.findByRole('region', { name: 'Player' })
      await act(() => router.navigate({ to: '/lists' }))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Test play' })).toBeNull())

      await userEvent.click(screen.getByRole('button', { name: 'Close player' }))
      expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
      expect(screen.getByRole('main')).toHaveFocus()
    })
  })

  it('keeps a loaded player across a route change', async () => {
    routed.linkId = await addYouTube()
    const { router } = renderApp({ db })
    await userEvent.click(await screen.findByRole('button', { name: 'Test play' }))
    const frame = iframeIn(await screen.findByRole('region', { name: 'Player' }))

    await act(() => router.navigate({ to: '/lists' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/lists'))
    const region = screen.getByRole('region', { name: 'Player' })
    expect(region.closest('main')).not.toBeNull()
    expect(iframeIn(region)).toBe(frame)
  })
})
