import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { fakeEngine, renderWithProviders } from '../../test/render'
import { AddLinkForm } from './AddLinkForm'

let db: CrosstuneDb
let songId: string

beforeEach(async () => {
  db = openTestDb()
  songId = (await createSong(db, { title: 'X' }, { status: 'known' })).songId
})

afterEach(async () => {
  await db.delete()
})

describe('AddLinkForm', () => {
  it('stores the resolved title and canonical url when the engine resolves', async () => {
    const resolveLink = vi.fn(async () => ({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: 'Cluck Old Hen - Fiddle',
      artwork_url: 'https://i.ytimg.com/x.jpg',
    }))
    renderWithProviders(<AddLinkForm songId={songId} />, {
      db,
      engine: fakeEngine({ resolveLink }),
    })
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Link' }),
      'https://youtu.be/dQw4w9WgXcQ',
    )
    await screen.findByText('Cluck Old Hen - Fiddle')
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    await waitFor(async () => expect(await db.recording_links.count()).toBe(1))
    expect((await db.recording_links.toArray())[0]).toMatchObject({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: 'Cluck Old Hen - Fiddle',
    })
  })

  it('falls back to client detection with no title when resolution returns null', async () => {
    renderWithProviders(<AddLinkForm songId={songId} />, { db, engine: fakeEngine() })
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Link' }),
      'https://open.spotify.com/track/abc',
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Label' }), 'studio')
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    await waitFor(async () => expect(await db.recording_links.count()).toBe(1))
    expect((await db.recording_links.toArray())[0]).toMatchObject({
      provider: 'spotify',
      provider_ref: 'track:abc',
      title: null,
      label: 'studio',
    })
  })

  it('shows an error and keeps the link when the write is rejected', async () => {
    renderWithProviders(<AddLinkForm songId="missing-song" />, { db, engine: fakeEngine() })
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Link' }),
      'https://open.spotify.com/track/abc',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Song not found')
    expect(await db.recording_links.count()).toBe(0)
  })
})
