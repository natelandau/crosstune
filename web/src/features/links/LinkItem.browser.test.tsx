import { IonList } from '@ionic/react'
import { Trash2 } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { forceTouch } from '../../test/pointer'
import { fakePlayer } from '../../test/providers'
import { linkRow } from '../../test/rows'
import type { RowAction } from '../../ui/Row'
import type { Player } from '../player/usePlayer'
import { playName } from '../recordings/recordingNames'
import { LinkItem } from './LinkItem'
import { closeLinkName, openLinkName } from './linkNames'

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
    await page.getByRole('button', { name: playName('Jam session'), exact: false }).click()
    await expect.poll(() => player.play).toHaveBeenCalledWith({ kind: 'link', id: 'l1' })
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
      .element(page.getByRole('button', { name: closeLinkName('Jam session'), exact: true }))
      .toBeVisible()
    await page.getByRole('button', { name: closeLinkName('Jam session'), exact: true }).click()
    await expect.poll(() => player.close).toHaveBeenCalled()
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
    await expect.poll(() => anchor.element().textContent).toBe('Spotify')
    // The row says the provider in the link and nowhere else.
    await expect.poll(() => page.getByText('Spotify', { exact: true }).elements()).toHaveLength(1)
  })

  it('falls back to the host when the link has no title', async () => {
    const link = linkRow('l1', 's1', {
      url: 'https://open.spotify.com/track/abc',
      provider: 'spotify',
      title: null,
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

  it('opens the provider from the row itself when there is nothing to embed', async () => {
    const player = fakePlayer()
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const link = linkRow('l1', 's1', {
      url: 'https://example.com/x',
      provider: 'other',
      title: 'Jam session',
    })
    show(link, { player })
    await page.getByRole('button', { name: openLinkName('Jam session'), exact: true }).click()
    await expect
      .poll(() => opened)
      .toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer')
    expect(player.play).not.toHaveBeenCalled()
    opened.mockRestore()
  })

  it('offers no way to open a link that is not a web address', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const link = linkRow('l1', 's1', {
      url: 'javascript:alert(1)',
      provider: 'other',
      title: 'Jam session',
    })
    show(link)
    await expect.element(page.getByText('Jam session')).toBeVisible()
    expect(
      page.getByRole('button', { name: openLinkName('Jam session'), exact: true }).elements(),
    ).toEqual([])
    expect(page.getByRole('link').elements()).toEqual([])
    expect(opened).not.toHaveBeenCalled()
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
    await expect.poll(() => anchor.element().textContent).toBe('Open')
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
    await expect.poll(() => onPress).toHaveBeenCalledOnce()
  })
})
