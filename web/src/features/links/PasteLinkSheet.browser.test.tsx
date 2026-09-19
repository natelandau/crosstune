import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ResolveResponse } from '../../api/types'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { PasteLinkSheet } from './PasteLinkSheet'

function Host({ songId, onClose = () => {} }: { songId: string | null; onClose?: () => void }) {
  const [current, setCurrent] = useState(songId)
  return (
    <PasteLinkSheet
      songId={current}
      onClose={() => {
        onClose()
        setCurrent(null)
      }}
    />
  )
}

const sheetOpen = () => document.querySelector('ion-modal:not(.overlay-hidden)') !== null

async function song(db: CrosstuneDb) {
  const { songId } = await createSong(db, { title: 'Reel' }, { status: 'known' })
  return songId
}

function show(
  songId: string,
  opts: { db?: CrosstuneDb; engine?: SyncEngine; onClose?: () => void } = {},
) {
  const db = opts.db ?? openTestDb()
  renderIonic(<Host songId={songId} onClose={opts.onClose} />, { db, engine: opts.engine })
  return db
}

describe('PasteLinkSheet', () => {
  it('shows the title, fields, and placeholders', async () => {
    const db = openTestDb()
    const songId = await song(db)
    show(songId, { db })
    await expect.element(page.getByText('Paste link')).toBeVisible()
    await expect.element(page.getByLabelText('Link')).toBeVisible()
    await expect
      .element(page.getByPlaceholder('Paste a YouTube, Spotify, or other link'))
      .toBeVisible()
    await expect.element(page.getByLabelText('Label')).toBeVisible()
    await expect.element(page.getByPlaceholder('slow version, jam recording, …')).toBeVisible()
  })

  it('adds a link with the provider and ref a YouTube url detects', async () => {
    const db = openTestDb()
    const songId = await song(db)
    show(songId, { db })
    await page.getByLabelText('Link').fill('https://youtu.be/dQw4w9WgXcQ')
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await vi.waitFor(async () => expect(await db.recording_links.count()).toBe(1))
    const [link] = await db.recording_links.toArray()
    expect(link?.provider).toBe('youtube')
    expect(link?.provider_ref).toBe('dQw4w9WgXcQ')
  })

  it('still adds a url this client cannot parse into a known provider, as other', async () => {
    const db = openTestDb()
    const songId = await song(db)
    show(songId, { db })
    await page.getByLabelText('Link').fill('https://example.com/some-recording')
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await vi.waitFor(async () => expect(await db.recording_links.count()).toBe(1))
    const [link] = await db.recording_links.toArray()
    expect(link?.provider).toBe('other')
    expect(link?.provider_ref).toBeNull()
  })

  it('fills the title from the resolver when it answers', async () => {
    const db = openTestDb()
    const songId = await song(db)
    const resolved: ResolveResponse = {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: 'Resolved title',
      artwork_url: null,
    }
    show(songId, { db, engine: fakeEngine({ resolveLink: async () => resolved }) })
    await page.getByLabelText('Link').fill('https://youtu.be/dQw4w9WgXcQ')
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await vi.waitFor(async () => expect(await db.recording_links.count()).toBe(1))
    const [link] = await db.recording_links.toArray()
    expect(link?.title).toBe('Resolved title')
  })

  it('still adds the link when the resolver does not answer', async () => {
    const db = openTestDb()
    const songId = await song(db)
    show(songId, { db, engine: fakeEngine({ resolveLink: async () => null }) })
    await page.getByLabelText('Link').fill('https://youtu.be/dQw4w9WgXcQ')
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await vi.waitFor(async () => expect(await db.recording_links.count()).toBe(1))
    const [link] = await db.recording_links.toArray()
    expect(link?.title).toBeNull()
  })

  it('refuses a blank url with a message under the field', async () => {
    const db = openTestDb()
    const songId = await song(db)
    show(songId, { db })
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Paste a link to add it')
    expect(await db.recording_links.count()).toBe(0)
  })

  it('adds one link from two submits in the same tick', async () => {
    const db = openTestDb()
    const songId = await song(db)
    show(songId, { db })
    await page.getByLabelText('Link').fill('https://youtu.be/dQw4w9WgXcQ')
    const form = document.querySelector('ion-modal form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(sheetOpen()).toBe(false))
    expect(await db.recording_links.count()).toBe(1)
  })

  it('closes once per dismissal', async () => {
    const db = openTestDb()
    const songId = await song(db)
    const onClose = vi.fn()
    show(songId, { db, onClose })
    await page.getByLabelText('Link').fill('https://youtu.be/dQw4w9WgXcQ')
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await vi.waitFor(() => expect(sheetOpen()).toBe(false))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('discards a half-typed link on Cancel and reports the close once', async () => {
    const db = openTestDb()
    const songId = await song(db)
    const onClose = vi.fn()
    show(songId, { db, onClose })
    await page.getByLabelText('Link').fill('https://youtu.be/dQw4w9WgXcQ')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await vi.waitFor(() => expect(sheetOpen()).toBe(false))
    expect(onClose).toHaveBeenCalledOnce()
    expect(await db.recording_links.count()).toBe(0)
  })

  it('refuses a backdrop tap or a swipe gesture while a link is half typed, keeping it', async () => {
    const db = openTestDb()
    const songId = await song(db)
    const onClose = vi.fn()
    show(songId, { db, onClose })
    await page.getByLabelText('Link').fill('https://youtu.be/dQw4w9WgXcQ')
    const modal = document.querySelector('ion-modal') as HTMLIonModalElement
    const canDismiss = modal.canDismiss as (data?: unknown, role?: string) => Promise<boolean>
    expect(await canDismiss(undefined, 'gesture')).toBe(false)
    const backdrop = modal.shadowRoot!.querySelector('ion-backdrop')!
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    // Long enough for a tap the backdrop should have refused to have dismissed the sheet.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(sheetOpen()).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    await expect.element(page.getByLabelText('Link')).toHaveValue('https://youtu.be/dQw4w9WgXcQ')
  })

  it('reopens for the same song after Cancel', async () => {
    const db = openTestDb()
    const songId = await song(db)

    function ReopenHost() {
      const [current, setCurrent] = useState<string | null>(songId)
      return (
        <>
          <button type="button" onClick={() => setCurrent(songId)}>
            Reopen
          </button>
          <PasteLinkSheet songId={current} onClose={() => setCurrent(null)} />
        </>
      )
    }

    renderIonic(<ReopenHost />, { db })
    await expect.element(page.getByText('Paste link')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await vi.waitFor(() => expect(sheetOpen()).toBe(false))
    await page.getByRole('button', { name: 'Reopen', exact: true }).click()
    await expect.element(page.getByText('Paste link')).toBeVisible()
    await expect.element(page.getByLabelText('Link')).toHaveValue('')
  })
})
