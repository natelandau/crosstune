import { IonList } from '@ionic/react'
import { Trash2 } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { MOUSE_QUERY } from '../../platform/pointer'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { linkRow } from '../../test/rows'
import type { RowAction } from '../../ui/Row'
import type { Player } from '../player/usePlayer'
import { LinkItem } from './LinkItem'

const realMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = realMatchMedia
})

/** On touch the row lays its own open control over the body, which the link sits above. */
function forceTouch() {
  window.matchMedia = (query: string) =>
    query === MOUSE_QUERY
      ? ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : realMatchMedia.call(window, query)
}

function fakePlayer(overrides: Partial<Player> = {}): Player {
  return {
    item: null,
    play: vi.fn(),
    close: vi.fn(),
    returnFocus: vi.fn(),
    ...overrides,
  }
}

function show(
  link: ReturnType<typeof linkRow>,
  opts: { actions?: readonly RowAction[]; player?: Player } = {},
) {
  renderIonic(
    <IonList>
      <LinkItem link={link} actions={opts.actions} />
    </IonList>,
    { db: openTestDb(), player: opts.player },
  )
}

describe('LinkItem', () => {
  it('plays a link from a button named for it and calls the player with its kind and id', async () => {
    const player = fakePlayer()
    const link = linkRow('l1', 's1', {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: 'Jam session',
    })
    show(link, { player })
    await page.getByRole('button', { name: 'Play Jam session', exact: false }).click()
    expect(player.play).toHaveBeenCalledWith({ kind: 'link', id: 'l1' })
  })

  it('closes the loaded link from a button named for its player', async () => {
    const player = fakePlayer({ item: { kind: 'link', id: 'l1' } })
    const link = linkRow('l1', 's1', {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: 'Jam session',
    })
    show(link, { player })
    await expect
      .element(page.getByRole('button', { name: 'Close Jam session player', exact: true }))
      .toBeVisible()
    await page.getByRole('button', { name: 'Close Jam session player', exact: true }).click()
    expect(player.close).toHaveBeenCalled()
  })

  it('names the provider once, in the link under the title', async () => {
    const link = linkRow('l1', 's1', {
      url: 'https://open.spotify.com/track/abc',
      provider: 'spotify',
      title: 'Jam session',
    })
    show(link)
    const anchor = page.getByRole('link', { name: 'Open Jam session on Spotify' })
    await expect.element(anchor).toBeVisible()
    expect(anchor.element().textContent).toBe('Spotify')
    // The row says the provider in the link and nowhere else.
    expect(page.getByText('Spotify', { exact: true }).elements()).toHaveLength(1)
  })

  it('titles an unresolved link by what the musician called it, said once', async () => {
    const link = linkRow('l1', 's1', {
      url: 'https://open.spotify.com/track/abc',
      provider: 'spotify',
      title: null,
      label: 'slow version',
    })
    show(link)
    await expect
      .element(page.getByRole('heading', { name: 'slow version', level: 3 }))
      .toBeVisible()
    // Standing in as the title, the label is not repeated under it.
    expect(page.getByText('slow version', { exact: true }).elements()).toHaveLength(1)
  })

  it('falls back to the host when the link has neither name', async () => {
    const link = linkRow('l1', 's1', {
      url: 'https://open.spotify.com/track/abc',
      provider: 'spotify',
      title: null,
      label: null,
    })
    show(link)
    await expect
      .element(page.getByRole('heading', { name: 'open.spotify.com', level: 3 }))
      .toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Open open.spotify.com on Spotify' }))
      .toBeVisible()
  })

  it('offers an anchor that opens the link elsewhere and does not also open the player', async () => {
    const player = fakePlayer()
    const link = linkRow('l1', 's1', {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: 'Jam session',
    })
    show(link, { player })
    const anchor = page.getByRole('link', { name: 'Open Jam session on YouTube' })
    await expect.element(anchor).toBeVisible()
    const element = anchor.element() as HTMLAnchorElement
    expect(element.href).toBe('https://youtu.be/dQw4w9WgXcQ')
    expect(element.target).toBe('_blank')
    expect(element.rel).toBe('noreferrer')
    // Cancels the browser's own navigation without touching the row's open control, so a real
    // click can prove the anchor sits above it instead of only reading its attributes.
    element.addEventListener('click', (event) => event.preventDefault(), { once: true })
    await anchor.click()
    expect(player.play).not.toHaveBeenCalled()
  })

  it('keeps a resolved title and leaves the label the musician typed off the row', async () => {
    const link = linkRow('l1', 's1', {
      url: 'https://open.spotify.com/track/abc',
      provider: 'spotify',
      title: 'Jam session',
      label: 'slow version',
    })
    show(link)
    await expect
      .element(page.getByRole('link', { name: 'Open Jam session on Spotify' }))
      .toBeVisible()
    expect(page.getByText('slow version').elements()).toHaveLength(0)
  })

  it('opens the provider from the row itself when there is nothing to embed', async () => {
    const player = fakePlayer()
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const link = linkRow('l1', 's1', {
      url: 'https://example.com/x',
      provider: 'other',
      title: 'Jam session',
    })
    show(link, { player })
    await page.getByRole('button', { name: 'Open Jam session', exact: true }).click()
    expect(opened).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer')
    expect(player.play).not.toHaveBeenCalled()
    opened.mockRestore()
  })

  it('reads the link out as Open when the provider has no name of its own', async () => {
    const link = linkRow('l1', 's1', {
      url: 'https://example.com/x',
      provider: 'other',
      title: 'Jam session',
    })
    show(link)
    const anchor = page.getByRole('link', { name: 'Open Jam session on Link' })
    await expect.element(anchor).toBeVisible()
    expect(anchor.element().textContent).toBe('Open')
  })

  it('lets the link take its own tap on touch, where the row is the play control', async () => {
    forceTouch()
    const player = fakePlayer()
    const link = linkRow('l1', 's1', {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: 'Jam session',
    })
    show(link, { player })
    const anchor = page.getByRole('link', { name: 'Open Jam session on YouTube' })
    await expect.element(anchor).toBeVisible()
    const element = anchor.element() as HTMLAnchorElement
    element.addEventListener('click', (event) => event.preventDefault(), { once: true })
    await anchor.click()
    expect(player.play).not.toHaveBeenCalled()
  })

  it('names a passed-in Remove action for this link', async () => {
    const onPress = vi.fn()
    const link = linkRow('l1', 's1', {
      url: 'https://example.com/x',
      provider: 'other',
      title: 'Jam session',
    })
    const actions: RowAction[] = [{ label: 'Remove', icon: Trash2, tone: 'error', onPress }]
    show(link, { actions })
    const remove = page.getByRole('button', { name: 'Remove Jam session' })
    await expect.element(remove).toBeVisible()
    await remove.click()
    expect(onPress).toHaveBeenCalledOnce()
  })
})
