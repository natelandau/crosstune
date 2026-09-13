import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../../auth/AuthContext'
import { createSong } from '../../commands/songs'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { routeTree } from '../../routeTree.gen'
import { SyncContext } from '../../sync/SyncProvider'
import { openTestDb } from '../../test/db'
import { fakeEngine, testSession } from '../../test/render'

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
  const router = createRouter({ routeTree, history })
  const view = render(
    <AuthProvider value={testSession}>
      <DbContext.Provider value={db}>
        <SyncContext.Provider value={fakeEngine()}>
          <RouterProvider router={router} />
        </SyncContext.Provider>
      </DbContext.Provider>
    </AuthProvider>,
  )
  return { router, unmount: view.unmount }
}

describe('SongPage', () => {
  it('leaves no duplicate history entry behind after an edit', async () => {
    const { router } = renderSongRoute()
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
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
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
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
