import { createMemoryHistory } from '@tanstack/react-router'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/render'

let db: CrosstuneDb
let songId: string

beforeEach(async () => {
  db = openTestDb()
  songId = (await createSong(db, { title: 'Cluck Old Hen' }, { status: 'learning' })).songId
})

afterEach(async () => {
  await db.delete()
})

function renderSongRoute(history = createMemoryHistory({ initialEntries: [`/songs/${songId}`] })) {
  return renderApp({ db, history })
}

// jsdom cannot open a popover, so the menu's items are reached while hidden.
async function pick(action: string) {
  await userEvent.click(await screen.findByRole('menuitem', { name: action, hidden: true }))
}

describe('SongPage', () => {
  it('leaves no duplicate history entry behind after an edit', async () => {
    const { router } = renderSongRoute()
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })

    await pick('Edit')
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ edit: true })
    })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(router.state.location.search).toEqual({})
    })
    expect(router.state.location.pathname).toBe(`/songs/${songId}`)
    expect(router.history.canGoBack()).toBe(false)
  })

  it('goes back on cancel after a reload of the edit entry it pushed', async () => {
    const history = createMemoryHistory({ initialEntries: [`/songs/${songId}`] })
    const first = renderSongRoute(history)
    await pick('Edit')
    await waitFor(() => {
      expect(first.router.state.location.search).toEqual({ edit: true })
    })
    first.unmount()

    // A reload keeps the history entries and their state but starts a fresh component tree.
    const { router } = renderSongRoute(history)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(router.state.location.search).toEqual({})
    })
    expect(router.history.canGoBack()).toBe(false)
  })

  it('replaces to the clean URL on cancel when edit mode was deep-linked', async () => {
    const { router } = renderSongRoute(
      createMemoryHistory({ initialEntries: [`/songs/${songId}?edit=true`] }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(router.state.location.search).toEqual({})
    })
    expect(router.state.location.pathname).toBe(`/songs/${songId}`)
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })
  })
})
