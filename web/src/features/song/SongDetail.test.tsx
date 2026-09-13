import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addLink } from '../../commands/links'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { SongDetail } from './SongDetail'

let db: CrosstuneDb
let songId: string
let userSongId: string

beforeEach(async () => {
  db = openTestDb()
  const created = await createSong(
    db,
    {
      title: 'Cluck Old Hen',
      key: 'A',
      mode: 'mixolydian',
      violin_tuning: 'AEAE',
      is_crooked: true,
    },
    { status: 'learning', notes: 'Watch the B part' },
  )
  songId = created.songId
  userSongId = created.userSongId
  await addLink(db, songId, {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    provider: 'youtube',
    provider_ref: 'dQw4w9WgXcQ',
    title: 'Fiddle version',
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(async () => {
  await db.delete()
})

function renderDetail(overrides: Partial<Parameters<typeof SongDetail>[0]> = {}) {
  const props = { songId, edit: false, onEditChange: vi.fn(), onDeleted: vi.fn(), ...overrides }
  const result = renderWithProviders(<SongDetail {...props} />, { db })
  return { props, result }
}

describe('SongDetail', () => {
  it('shows facets, embeds the first youtube link, and changes status', async () => {
    renderDetail()
    expect(await screen.findByRole('heading', { name: 'Cluck Old Hen' })).toBeInTheDocument()
    expect(screen.getByText('A mixolydian')).toBeInTheDocument()
    expect(screen.getByText('AEAE')).toBeInTheDocument()
    expect(screen.getByText('Crooked')).toBeInTheDocument()
    expect(screen.getByTitle('Fiddle version')).toHaveAttribute(
      'src',
      expect.stringContaining('dQw4w9WgXcQ'),
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Known' }))
    await waitFor(async () => expect((await db.user_songs.get(userSongId))?.status).toBe('known'))
  })

  it('enters edit mode through the callback and saves changes', async () => {
    const { props, result } = renderDetail()
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(props.onEditChange).toHaveBeenCalledWith(true)
    // The route drives `edit` from search state; unmount and re-render with edit: true
    // to stand in for the navigation this callback would otherwise trigger.
    result.unmount()
    renderDetail({ edit: true })
    const title = await screen.findByRole('textbox', { name: 'Title' })
    await userEvent.clear(title)
    await userEvent.type(title, 'Cluck Old Hen (A)')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await db.songs.get(songId))?.title).toBe('Cluck Old Hen (A)'))
  })

  it('archives and deletes', async () => {
    const { props } = renderDetail()
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(async () =>
      expect((await db.user_songs.get(userSongId))?.archived_at).not.toBeNull(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(async () => expect((await db.songs.get(songId))?.deleted_at).not.toBeNull())
    expect(props.onDeleted).toHaveBeenCalled()
  })
})
