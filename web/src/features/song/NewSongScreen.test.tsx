import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activeItems, createList } from '../../commands/lists'
import { appendChunk, beginCapture, finishCapture } from '../../commands/recordings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/render'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

describe('NewSongScreen', () => {
  it('fills the title from the search param', async () => {
    renderApp({ db, path: `/songs/new?title=${encodeURIComponent('Soldier')}` })
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('Soldier')
  })

  it('starts with a blank title without the search param', async () => {
    renderApp({ db, path: '/songs/new' })
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('')
  })

  it('attaches the recording it was opened for to the new song', async () => {
    const recordingId = 'rec_1'
    await beginCapture(db, recordingId, { songId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, recordingId, 0, new Blob(['audio'], { type: 'audio/mp4' }))
    await finishCapture(db, recordingId, {
      songId: null,
      mime: 'audio/mp4',
      durationMs: 1000,
      recordedAt: new Date().toISOString(),
    })
    const { router } = renderApp({ db, path: `/songs/new?attach=${recordingId}` })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Title' }), 'Angeline')
    await userEvent.click(screen.getByRole('button', { name: 'Add song' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/songs\/(?!new)/))
    const [song] = await db.songs.toArray()
    expect((await db.recordings.get(recordingId))?.song_id).toBe(song!.id)
  })

  it('adds the new song to the list it was opened for', async () => {
    const listId = await createList(db, 'Tuesday jam')
    const { router } = renderApp({ db, path: `/songs/new?title=Angeline&list=${listId}` })
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('Angeline')
    await userEvent.click(screen.getByRole('button', { name: 'Add song' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/songs\/(?!new)/))
    const [item] = await activeItems(db, listId)
    const [userSong] = await db.user_songs.toArray()
    expect(item?.user_song_id).toBe(userSong!.id)
  })

  it('still opens the new song and says so when the list is gone', async () => {
    const { router } = renderApp({ db, path: '/songs/new?list=missing' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Title' }), 'Angeline')
    await userEvent.click(screen.getByRole('button', { name: 'Add song' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/songs\/(?!new)/))
    expect(await screen.findByText('The song could not be added to the list.')).toBeInTheDocument()
    expect(await db.songs.count()).toBe(1)
  })

  it('still opens the new song and says so when the recording cannot be attached', async () => {
    const { router } = renderApp({ db, path: '/songs/new?attach=missing' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Title' }), 'Angeline')
    await userEvent.click(screen.getByRole('button', { name: 'Add song' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/songs\/(?!new)/))
    expect(
      await screen.findByText('The recording could not be added to this song.'),
    ).toBeInTheDocument()
    expect(await db.songs.count()).toBe(1)
  })
})
