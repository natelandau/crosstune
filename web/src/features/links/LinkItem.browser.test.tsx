import { IonList } from '@ionic/react'
import { Trash2 } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { linkRow } from '../../test/rows'
import type { RowAction } from '../../ui/Row'
import type { Player } from '../player/usePlayer'
import { LinkItem } from './LinkItem'

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

  it('shows the provider word from display.ts', async () => {
    const link = linkRow('l1', 's1', {
      url: 'https://open.spotify.com/track/abc',
      provider: 'spotify',
      title: 'Jam session',
    })
    show(link)
    // Waits for hydration before the synchronous DOM read below.
    await expect
      .element(page.getByRole('link', { name: 'Open Jam session on Spotify' }))
      .toBeVisible()
    const meta = document.querySelector('p.type-subheadline')
    expect(meta?.textContent).toBe('Spotify')
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
    // Standing in as the title, the label does not also ride the meta line.
    expect(document.querySelector('p.type-subheadline')?.textContent).toBe('Spotify')
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
    expect(document.querySelector('p.type-subheadline')?.textContent).toBe('Spotify')
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

  it('keeps a resolved title and folds the label into the meta line beside the provider', async () => {
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
    const meta = document.querySelector('p.type-subheadline')
    expect(meta?.textContent).toBe('slow version · Spotify')
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
